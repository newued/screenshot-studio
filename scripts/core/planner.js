// scripts/core/planner.js
// 生产计划（反馈②：把 Planner 提升为一等公民）
//
// 此前编排逻辑散在 agent-bridge.mjs 的 cmdRun/cmdRunPage 内联调用中。
// 现抽象为：
//   - PRODUCTION_PLAN：有序步骤 + 工具 + 产物 + 约束（needsReview 等）
//   - runProductionPlan：确定性执行器，驱动 SCRIPT→VOICEOVER→SEMANTIC→RENDER，
//     每步产物落盘为不可变 artifact（反馈⑦），needs_review 时交还 AI 交接包。

import { callTool } from './client.js'
import { patchState, persistArtifact } from './state.js'
import { PROJECT_STATUS } from '../../src/lib/pipelineContract.js'
import { buildProject, buildScriptText } from './project.js'

// 计划定义（决策 Schema / 约束集中在此，而非散落 prompt）
export const PRODUCTION_PLAN = [
  { key: 'SCRIPT', tool: 'parseScript', artifact: 'SCRIPT', needsAudio: false },
  { key: 'VOICEOVER', tool: 'alignDP', artifact: 'VOICEOVER', needsReview: true },
  { key: 'SEMANTIC', tool: 'aiReview', artifact: 'SEMANTIC', optional: true },
  { key: 'RENDER', tool: 'render', artifact: 'RENDER' },
]

// 运行生产计划（人机协同）。输入已解析好的素材。
// 每步进入 RUNNING；失败则把当前步标记为 FAILED 并记录 error（反馈⑧：生产级状态机）。
// 返回：
//   { done:true, output }  |  { skipped:true }  |  { needsReview:true, handoff }
export async function runProductionPlan({
  statePath,
  projectId = 'default',
  audioPath,
  scriptText,
  messages = [],
  members = [],
  platform = 'wechat',
  mode = 'single',
  out,
  skipRender = false,
}) {
  if (!audioPath) throw new Error('runProductionPlan 需要 audioPath')
  if (!scriptText) throw new Error('runProductionPlan 需要 scriptText')

  let activeStep = 'SCRIPT'
  try {
    // 1) SCRIPT：解析脚本
    activeStep = 'SCRIPT'
    patchState(statePath, { current_step: 'SCRIPT', status: PROJECT_STATUS.RUNNING, project_id: projectId, platform, mode })
    const parse = await callTool('parseScript', { scriptText, platform, mode })
    const msgs = parse.messages || []
    parse.messages = msgs
    patchState(statePath, { current_step: 'SCRIPT', status: PROJECT_STATUS.SUCCEEDED, script_messages: msgs, script_text: scriptText, project_id: projectId, platform, mode })
    await persistArtifact(statePath, projectId, 'SCRIPT', { messages: msgs, script_text: scriptText, platform, mode })

    // 2) VOICEOVER：ASR + 节拍网格 + DP 对齐
    activeStep = 'VOICEOVER'
    patchState(statePath, { current_step: 'VOICEOVER', status: PROJECT_STATUS.RUNNING })
    const align = await callTool('alignDP', { audioPath, scriptText, model: 'small', hopLength: 512 })
    patchState(statePath, {
      current_step: 'VOICEOVER',
      status: PROJECT_STATUS.SUCCEEDED,
      alignment_mode: align.alignment_mode,
      asr_quality_score: align.asr_quality_score,
      mapping_meta: align.mapping_meta,
      beat_grid_len: (align.beat_grid || []).length,
    })
    await persistArtifact(statePath, projectId, 'VOICEOVER', align)

    // 3) 需要 AI 语义干预？
    if (align.mapping_meta?.needs_review) {
      const handoff = await callTool('aiReview', {
        scriptText,
        beatGrid: align.beat_grid,
        rawSegments: align.asr_segments || [],
        mapping: align.mapping,
      })
      patchState(statePath, {
        current_step: 'SEMANTIC',
        status: PROJECT_STATUS.WAITING_AGENT,
        needs_review: true,
        ai_handoff: handoff,
        align_result: align,
        script_text: scriptText,
        project_id: projectId,
        platform,
        mode,
        audio_path: audioPath,
      })
      return {
        needsReview: true,
        handoff: { align_result: align, handoff },
        statePath,
      }
    }

    // 4) 跳过渲染（仅对齐）
    if (skipRender) {
      patchState(statePath, { current_step: 'TIMELINE', status: PROJECT_STATUS.SUCCEEDED, align_result: align })
      return { skipped: true, statePath }
    }

    // 5) RENDER：合成成片
    activeStep = 'RENDER'
    patchState(statePath, { current_step: 'RENDER', status: PROJECT_STATUS.RUNNING })
    const project = buildProject({ parse: { messages: msgs }, align, opts: { platform, mode, audio: audioPath, script: scriptText, members } })
    const r = await callTool('render', { project, audioPath, outputPath: out })
    if (!r.success) throw new Error('render 失败: ' + JSON.stringify(r))
    patchState(statePath, { current_step: 'RENDER', status: PROJECT_STATUS.SUCCEEDED, output: out })
    await persistArtifact(statePath, projectId, 'RENDER', { output: out, frameCount: r.frameCount, duration: r.duration })

    return { done: true, output: out, statePath }
  } catch (e) {
    // 生产级失败状态：标记当前步 FAILED，记录错误，后续步骤保持 PENDING（可由用户重跑）
    patchState(statePath, { current_step: activeStep, status: PROJECT_STATUS.FAILED, error: e.message, error_at: new Date().toISOString() })
    throw e
  }
}

// 取消当前生产计划（反馈⑧：CANCELLED 流转）
export function cancelProductionPlan(statePath, step = null) {
  patchState(statePath, { current_step: step || 'RENDER', status: PROJECT_STATUS.CANCELLED, cancelled_at: new Date().toISOString() })
  return true
}

// 把 messages 还原成脚本文本（供 run-page 缺少 scriptText 时复用）
export { buildScriptText }
