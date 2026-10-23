// dsh-aora-ball — host 侧
//
// 职责：把 DSH 的会话事件翻译成 Emotion Ball 的 emotionId，交给本地状态服务，
// 客户端插件轮询后驱动球。
//
// 状态服务现在由本插件自带（node:http，127.0.0.1:8778）：
//   * 端口可用 → 自己监听，事件直接写内存，零网络往返；
//   * 端口已被占用（例如你另有 python 版服务在跑）→ 降级为 POST 到既有服务。
// 两种模式下 client 侧看到的东西完全一样：GET /state。
//
// 为什么走 HTTP 而不是 host↔client RPC：
//   * 可以手动 curl 调试，也能被 dsh-hooks 或别的脚本喂状态；
//   * 客户端只需要 fetch，零 RPC 契约，DSH 升级不会断链；
//   * 服务不在时全部静默失败，不影响 DSH 任何功能。

import http from 'node:http'

const name = 'dsh-aora-ball'
const HOST = '127.0.0.1'
const PORT = 8778
const ENDPOINT = `http://${HOST}:${PORT}/state`

const state = { emotionId: '02', tips: '', ts: 0 }
let ownsServer = false
let server = null

let pending = null
let lastId = ''

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
}

function reply(res, code, obj) {
  cors(res)
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function handle(req, res) {
  const path = (req.url || '/').split('?')[0]
  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    res.end()
    return
  }
  if (path !== '/state') return reply(res, 404, { ok: false, error: 'not found' })

  if (req.method === 'GET') {
    const ageMs = state.ts ? Date.now() - state.ts : null
    return reply(res, 200, { ...state, ageMs })
  }
  if (req.method === 'POST') {
    let raw = ''
    req.on('data', (chunk) => {
      if (raw.length < 100000) raw += chunk
    })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(raw || '{}')
        if (parsed.emotionId !== undefined) state.emotionId = String(parsed.emotionId).slice(0, 8)
        if (parsed.tips !== undefined) state.tips = String(parsed.tips).slice(0, 200)
        state.ts = Date.now()
      } catch {
        return reply(res, 400, { ok: false, error: 'bad json' })
      }
      reply(res, 200, { ok: true, state: { ...state } })
    })
    return
  }
  return reply(res, 405, { ok: false, error: 'method not allowed' })
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer(handle)
    srv.once('error', () => resolve(null))
    srv.listen(PORT, HOST, () => {
      ownsServer = true
      server = srv
      if (srv.unref) srv.unref()
      resolve(srv)
    })
  })
}

function push(emotionId, tips) {
  const id = String(emotionId)
  if (id === lastId && !pending) return
  lastId = id

  if (ownsServer) {
    // 自己就是服务，直接写内存
    state.emotionId = id
    state.tips = tips || ''
    state.ts = Date.now()
    return
  }

  const body = JSON.stringify({ emotionId: id, tips: tips || '', ts: Date.now() })
  try {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(1500),
    }).catch(() => {})
  } catch {
    /* 服务没开就算了 */
  }
}

function later(emotionId, tips, ms) {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    push(emotionId, tips)
  }, ms)
  if (pending.unref) pending.unref()
}

function apply(ctx) {
  startServer().catch(() => {})

  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        if (pending) clearTimeout(pending)
        if (server) {
          try {
            server.close()
          } catch {
            /* already closed */
          }
          server = null
          ownsServer = false
        }
      },
      'aora-ball: state server'
    )
  }

  // 会话事件：turn/start、tool/call、tool/result、step/end、turn/end、
  // approval/asked、user/message …（event.type 取值见 DSH 会话日志）
  ctx.on('session/event', (session, event) => {
    const type = event && event.type
    switch (type) {
      case 'user/message':
        push('31', '收到消息')
        break
      case 'turn/start':
        push('31', '接收任务')
        later('30', '思考中', 900)
        break
      case 'tool/call':
        push('32', '处理中')
        break
      case 'tool/result':
        later('30', '思考中', 260)
        break
      case 'step/end':
        later('30', '思考中', 200)
        break
      case 'approval/asked':
        push('35', '等待确认')
        break
      case 'turn/end':
        push('33', '任务完成')
        later('02', '', 7000)
        break
      default:
        break
    }
  })

  ctx.on('agent/error', () => push('34', '出错'))
}

export { apply, name }
