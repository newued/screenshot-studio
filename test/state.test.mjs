import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { STATE_PATH, readState, writeState, patchState } from '../scripts/core/state.js'

test('STATE_PATH 指向 skill 根目录的 pipeline_state.json（不在 scripts/ 内）', () => {
  assert.ok(STATE_PATH.endsWith('pipeline_state.json'), 'basename 应为 pipeline_state.json')
  assert.ok(!STATE_PATH.split(/[\\/]/).includes('scripts'), '不应落在 scripts 目录内（回归 #2）')
  const root = dirname(STATE_PATH)
  assert.ok(existsSync(join(root, 'mcp-server')), 'skill 根应包含 mcp-server')
  assert.ok(existsSync(join(root, 'src')), 'skill 根应包含 src')
})

test('writeState/readState/patchState 往返（临时文件，不污染真实状态）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-test-'))
  const p = join(dir, 'pipeline_state.json')
  try {
    const written = writeState(p, { page_confirmed: true, audio_path: '/x.mp3', messages: [{ id: 0 }] })
    assert.equal(written.page_confirmed, true)
    const r1 = readState(p)
    assert.equal(r1.audio_path, '/x.mp3')
    const r2 = patchState(p, { current_step: 'VOICEOVER' })
    assert.equal(r2.page_confirmed, true, 'patch 应合并保留原字段（回归 #3）')
    assert.equal(r2.current_step, 'VOICEOVER')
    assert.equal(readState(p).current_step, 'VOICEOVER')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readState 对不存在/损坏文件返回 null（不抛）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-test-'))
  const p = join(dir, 'missing.json')
  try {
    assert.equal(readState(p), null)
    writeFileSync(p, '{ this is not json')
    assert.equal(readState(p), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
