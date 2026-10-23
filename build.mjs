import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 把 engine/ 下的四个上游源文件内联进 client.tpl.js，产出 client.js
const dir = path.dirname(fileURLToPath(import.meta.url))
const ENGINE = ['rings.js', 'emotions.js', 'ball.js', 'engine.js']

const parts = ENGINE.map((f) => {
  const code = fs.readFileSync(path.join(dir, 'engine', f), 'utf8')
  const bar = '─'.repeat(Math.max(4, 56 - f.length))
  return `    // ── ${f} ${bar}\n    (function () {\n${code}\n    })();\n`
})

const tpl = fs.readFileSync(path.join(dir, 'client.tpl.js'), 'utf8')
const out = tpl.replace('    /*__ENGINE__*/', parts.join('\n'))
if (out === tpl) throw new Error('placeholder /*__ENGINE__*/ not found')

fs.writeFileSync(path.join(dir, 'client.js'), out, 'utf8')
const size = fs.statSync(path.join(dir, 'client.js')).size
console.log(`client.js written: ${size} bytes (${(size / 1024).toFixed(1)} KB)`)
