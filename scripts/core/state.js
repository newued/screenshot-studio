// scripts/core/state.js
// 真相源 IO（从 agent-bridge.mjs 抽出，解决反馈⑤：职责拆分）
// 仅负责 pipeline_state.json 的读写与 Project Entity 路径约定；不含任何编排逻辑。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  STEP_ORDER,
  STEP_ARTIFACTS,
  PROJECT_STATUS,
  projectDirName,
} from '../../src/lib/pipelineContract.js'

// ---- 真相源读写 ----
export function readState(statePath) {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

export function writeState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
  return state
}

export function patchState(statePath, patch) {
  const s = readState(statePath) || {}
  const next = { ...s, ...patch, updated_at: new Date().toISOString() }
  writeState(statePath, next)
  return next
}

// ---- Project Entity 种子（反馈⑦） ----
// 项目目录：<root>/projects/<projectId>/
// 产物文件：<root>/projects/<projectId>/artifacts/<step>.json
export function projectDir(root, projectId) {
  return join(root, 'projects', projectDirName(projectId))
}

export function artifactDir(root, projectId) {
  return join(projectDir(root, projectId), 'artifacts')
}

export function artifactPath(root, projectId, step) {
  const file = STEP_ARTIFACTS[step]
  if (!file) throw new Error(`未知步骤产物：${step}`)
  return join(artifactDir(root, projectId), file)
}

export { STEP_ORDER, STEP_ARTIFACTS, PROJECT_STATUS }
