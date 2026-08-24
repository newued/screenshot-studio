// scripts/core/state.js
// 真相源 IO（从 agent-bridge.mjs 抽出，解决反馈⑤：职责拆分）
// 仅负责 pipeline_state.json 的读写与 Project Entity 路径约定；不含任何编排逻辑。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import {
  STEP_ORDER,
  STEP_ARTIFACTS,
  PROJECT_STATUS,
  projectDirName,
} from '../../src/lib/pipelineContract.js'

// 真相源默认路径（与 agent-bridge.mjs / registry.js 的 STATE_PATH 一致：<root>/pipeline_state.json）
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const STATE_PATH = join(ROOT, 'pipeline_state.json')

// ---- 真相源读写 ----
export function readState(statePath = STATE_PATH) {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

export function writeState(statePath = STATE_PATH, state) {
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
  return state
}

export function patchState(statePath = STATE_PATH, patch) {
  const s = readState(statePath) || {}
  const next = { ...s, ...patch, updated_at: new Date().toISOString() }
  writeState(statePath, next)
  return next
}

// ---- Project Entity 种子（反馈⑦） ----
// 项目目录默认落在用户数据目录，脱离技能源码树（避免污染 git / 技能更新被清）；可用 PROJECTS_DIR 覆盖。
// 产物文件：<base>/<projectId>/artifacts/<step>/vN.json（版本化，不可变）
export function projectsBase() {
  if (process.env.PROJECTS_DIR) return process.env.PROJECTS_DIR
  return join(homedir(), '.screenshot-studio', 'projects')
}
export function projectDir(projectId) {
  return join(projectsBase(), projectDirName(projectId))
}

export function artifactDir(projectId) {
  return join(projectDir(projectId), 'artifacts')
}

export function artifactPath(projectId, step) {
  const file = STEP_ARTIFACTS[step]
  if (!file) throw new Error(`未知步骤产物：${step}`)
  return join(artifactDir(projectId), file)
}

// 把某步产物作为不可变 artifact 落盘（反馈③：版本化，而非覆盖）。
// 布局：<base>/<id>/artifacts/<step>/v1.json, v2.json, ...
// 同时把最新一份路径登记进 pipeline_state.json.artifacts[step]（保持浏览器轮询入口不变），
// 并把全部版本记录到 artifacts_versions[step]，支持 revertArtifact 回滚。
export async function persistArtifact(statePath, projectId, step, data) {
  const dir = join(artifactDir(projectId), step) // <base>/<id>/artifacts/<step>/
  mkdirSync(dir, { recursive: true })

  const s = readState(statePath) || {}
  const versions = (s.artifacts_versions && s.artifacts_versions[step]) || []
  const n = versions.length + 1
  const file = join(dir, `v${n}.json`)
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8')
  versions.push(file)

  s.artifacts = s.artifacts || {}
  s.artifacts[step] = file
  s.artifacts_versions = s.artifacts_versions || {}
  s.artifacts_versions[step] = versions
  s.updated_at = new Date().toISOString()
  writeState(statePath, s)
  return file
}

// 回滚某步到指定版本（默认最新）。返回回滚后的文件路径。
export async function revertArtifact(statePath, projectId, step, version) {
  const s = readState(statePath) || {}
  const versions = (s.artifacts_versions && s.artifacts_versions[step]) || []
  const target = version ? join(artifactDir(projectId), step, `v${version}.json`) : versions[versions.length - 1]
  const idx = versions.indexOf(target)
  if (idx < 0) throw new Error(`artifact 回滚失败：步骤 ${step} 无版本 ${version || 'latest'}`)
  s.artifacts = s.artifacts || {}
  s.artifacts[step] = versions[idx]
  s.updated_at = new Date().toISOString()
  writeState(statePath, s)
  return versions[idx]
}

export { STEP_ORDER, STEP_ARTIFACTS, PROJECT_STATUS }
