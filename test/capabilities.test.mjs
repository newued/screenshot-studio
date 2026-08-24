import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { detectCapabilities } from '../scripts/core/capabilities.js'

function probe(cmd) {
  const p = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`
  try { execSync(p, { stdio: 'ignore' }); return true } catch { return false }
}

test('detectCapabilities 返回完整 boolean 能力对象', () => {
  const c = detectCapabilities()
  for (const k of ['chat_image', 'chat_video', 'asr', 'semantic', 'ffmpeg', 'python', 'render']) {
    assert.equal(typeof c[k], 'boolean', `字段 ${k} 应为 boolean`)
  }
})

test('chat_image 与 semantic 始终就绪（不依赖外部依赖）', () => {
  const c = detectCapabilities()
  assert.equal(c.chat_image, true)
  assert.equal(c.semantic, true)
})

test('ffmpeg/python 探测结果必须与直接 probe 一致（防 --version 回归 #5）', () => {
  const c = detectCapabilities()
  // 若有人把探测改回 `ffmpeg --version`，此处 detectCapabilities.ffmpeg 会=false，但 probe(where) =true → 断言失败，立即暴露回归
  assert.equal(c.ffmpeg, probe('ffmpeg'))
  assert.equal(c.python, probe('python') || probe('python3'))
  assert.equal(c.render, c.ffmpeg)
  assert.equal(c.chat_video, c.ffmpeg)
})
