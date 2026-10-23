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
//
// 32 个 emotionId 全覆盖（见 ../engine/emotions.js）：
//   00 睡眠 01 唤醒 02 待机 03 好奇 04 发呆 05 加载苏醒 06 休眠 07 抖动唤醒
//   10 开心 11 疑惑 12 失落 13 惊讶 14 害羞 15 疲惫 16 专注 17 慌张 18 无奈
//   19 满意 20 困惑 21 生气
//   30 思考 31 接收 32 忙碌 33 完成 34 出错 35 等待输入 36 联网加载 37 复述回忆
//   38 拒绝受限 39 输出回复 40 检索资料 41 停止终止

import http from 'node:http'

const name = 'dsh-aora-ball'
const HOST = '127.0.0.1'
const PORT = 8778
const ENDPOINT = `http://${HOST}:${PORT}/state`

const state = { emotionId: '02', tips: '', ts: 0, tool: '' }
let ownsServer = false
let server = null

let lastKey = ''
const timers = new Set()

// 节奏统计：用来把「连续失败」「工具太密」翻成情绪
let failStreak = 0
let steps = 0
let turnTools = 0
const recentCalls = []

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

function push(emotionId, tips, tool) {
  const id = String(emotionId)
  const key = id + '|' + (tips || '') + '|' + (tool || '')
  if (key === lastKey) return
  lastKey = key
  state.tool = tool || ''

  if (ownsServer) {
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

function later(emotionId, tips, ms, tool) {
  const t = setTimeout(() => {
    timers.delete(t)
    push(emotionId, tips, tool)
  }, ms)
  timers.add(t)
  if (t.unref) t.unref()
  return t
}

function clearTimers() {
  for (const t of timers) clearTimeout(t)
  timers.clear()
}

// ── 事件字段提取：不同 DSH 版本字段名不完全一致，逐个候选试 ──────────
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return ''
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

function toolNameOf(ev) {
  const direct = pick(ev, ['tool', 'toolName', 'name', 'tool_name'])
  if (direct) return direct
  const nested =
    pick(ev.call, ['tool', 'toolName', 'name']) ||
    pick(ev.payload, ['tool', 'toolName', 'name']) ||
    pick(ev.data, ['tool', 'toolName', 'name'])
  return nested
}

// 工具 → 表情：读类走「检索资料」，写/跑类走「专注」，联网走「联网加载」
function emotionForTool(tool) {
  const t = String(tool || '').toLowerCase()
  if (!t) return ['32', '处理中']
  if (/^(web_fetch|websearch|web_search|fetch|http|ego_|browser)/.test(t)) return ['36', '联网加载']
  if (/(session_search|memory|openviking|remember|recall)/.test(t)) return ['37', '翻找记忆']
  if (/(read|grep|glob|list|ls|search|find|read_pdf|pdf)/.test(t)) return ['40', '检索资料']
  if (/(write|edit|str_replace|create|apply_patch|bash|shell|pwsh|powershell|node|python|git|format)/.test(t))
    return ['16', '专心干活']
  return ['32', '处理中']
}

function emotionForError(ev) {
  let blob = ''
  try {
    blob = JSON.stringify(ev || {})
  } catch {
    blob = ''
  }
  const s = blob.toLowerCase()
  if (/(429|rate.?limit|quota|too many)/.test(s)) return ['18', '被限流了']
  if (/(403|401|forbidden|unauthor|permission|denied|not allowed)/.test(s)) return ['38', '被挡住了']
  if (/(timeout|etimedout|econnrefused|enotfound|econnreset|fetch failed|network|502|503|504)/.test(s))
    return ['36', '网络出岔子']
  if (/(abort|cancel|interrupt|sigint)/.test(s)) return ['41', '已停止']
  return ['34', '出错了']
}

function resetTurn() {
  steps = 0
  turnTools = 0
  failStreak = 0
  recentCalls.length = 0
}

function apply(ctx) {
  startServer().catch(() => {})

  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        clearTimers()
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

  ctx.on('session/event', (session, event) => {
    const type = event && event.type

    switch (type) {
      // ── 用户与回合 ─────────────────────────────────────────
      case 'user/message':
        clearTimers()
        resetTurn()
        push('31', '收到消息')
        break

      case 'turn/start':
        clearTimers()
        resetTurn()
        push('31', '接收任务')
        later('30', '思考中', 900)
        break

      case 'step/start':
        steps += 1
        push('30', '思考中')
        break

      case 'turn/end': {
        const aborted =
          /abort|cancel|interrupt|stop/i.test(String((event && (event.reason || event.status)) || '')) ||
          (event && event.aborted === true)
        clearTimers()
        if (aborted) {
          push('41', '已停止')
          later('12', '有点失落', 2200)
          later('02', '', 6000)
          break
        }
        push('39', '输出回复')
        if (steps >= 8) later('19', '干得漂亮', 900)
        else if (turnTools === 0) later('10', '聊得开心', 900)
        else later('33', '任务完成', 900)
        later('02', '', 8000)
        break
      }

      // ── 工具调用 ───────────────────────────────────────────
      case 'tool/call': {
        turnTools += 1
        const tool = toolNameOf(event)
        const now = Date.now()
        recentCalls.push(now)
        while (recentCalls.length && now - recentCalls[0] > 2000) recentCalls.shift()
        // 2 秒内第 3 次及以上：节奏太赶，慌张
        if (recentCalls.length >= 3) {
          push('17', '忙不过来', tool)
          break
        }
        const [id, tip] = emotionForTool(tool)
        push(id, tip, tool)
        break
      }

      case 'tool/result': {
        const failed =
          (event && (event.ok === false || event.error || event.isError === true)) || false
        if (failed) {
          failStreak += 1
          // 一错疑惑，再错困惑，三错生气
          if (failStreak >= 3) push('21', '烦了', state.tool)
          else if (failStreak === 2) push('20', '不太对劲', state.tool)
          else push('11', '诶？', state.tool)
        } else {
          failStreak = 0
          later('30', '思考中', 260)
        }
        break
      }

      case 'step/end':
        later('30', '思考中', 200)
        break

      // ── 审批与错误 ─────────────────────────────────────────
      case 'approval/asked':
        push('35', '等你确认')
        break

      case 'approval/decided':
        later('30', '继续', 150)
        break

      case 'session/created':
        push('13', '新会话')
        later('02', '', 2500)
        break

      case 'session/title':
        push('37', '记一下')
        later('02', '', 2000)
        break

      case 'agent/error': {
        const [id, tip] = emotionForError(event)
        push(id, tip)
        later('30', '再试一次', 2600)
        break
      }

      case 'agent/status': {
        const s = pick(event, ['status', 'state'])
        if (s === 'running' || s === 'busy') push('30', '思考中')
        else if (s === 'idle') later('02', '', 1200)
        break
      }

      default:
        break
    }
  })

  ctx.on('agent/error', () => {
    const [id, tip] = emotionForError({})
    push(id, tip)
  })
}

export { apply, name }
