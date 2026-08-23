// 统一管线契约（解决反馈①⑧⑦：双状态词表 + Project Entity 种子）
//
// 设计意图：
// - 浏览器(localStorage 向导)与 agent(pipeline_state.json 运行时)共用同一套「步骤 / 状态词表」，
//   消除此前两套互不相通的状态词汇（UI 用 AWAIT_CONFIRM，agent 用 running/aligned）。
// - 本文件为「纯模块」，不引入 node:path 等仅服务端可用的依赖，浏览器与 CLI 均可安全 import。
// - Project Entity 的种子（产物布局 / 项目目录约定）也在此声明，供后续落地 artifacts/ 目录模型。

export const STEP_ORDER = ['SCRIPT', 'VOICEOVER', 'TIMELINE', 'SEMANTIC', 'RENDER']

// 单一工作流契约（反馈：消除 SKILL/AGENTS/Planner 中多份 Workflow 定义漂移）
// 这是「步骤顺序 + 每步工具 + 依赖」的唯一真相源；planner 的 PRODUCTION_PLAN 必须由此派生，
// 不得再硬编码一份步骤列表（此前 TIMELINE 在 planner 中被漏掉即此问题）。
// - tool:       该步对应的 MCP 工具（null 表示由上游步骤产出、无独立工具）
// - needsReview: 该步可能产出 AI 语义交接包（交由 agent 仲裁）
// - derived:    true 表示该步不独立执行，其产物由上游步骤（producedBy）生成
// - producedBy: derived 步骤的实际产出步骤
export const WORKFLOW_STEPS = {
  SCRIPT:    { tool: 'parseScript', needsReview: false },
  VOICEOVER: { tool: 'alignDP', needsReview: true },
  TIMELINE:  { derived: true, producedBy: 'VOICEOVER', note: '时间轴由 alignDP 的 mapping 产出，确认门在 UI/agent 审阅对齐结果' },
  SEMANTIC:  { tool: 'aiReview', optional: true, needsReview: true },
  RENDER:    { tool: 'render', needsReview: false },
}

// 由单一契约派生「执行计划」（planner 使用，保证与 STEP_ORDER 永远一致）
export function buildProductionPlan() {
  return STEP_ORDER.map((key) => ({
    key,
    tool: WORKFLOW_STEPS[key].tool || null,
    derived: !!WORKFLOW_STEPS[key].derived,
    producedBy: WORKFLOW_STEPS[key].producedBy || null,
    needsReview: !!WORKFLOW_STEPS[key].needsReview,
    optional: !!WORKFLOW_STEPS[key].optional,
    artifact: STEP_ARTIFACTS[key] || null,
  }))
}

export const STEP_LABELS = {
  SCRIPT: '脚本',
  VOICEOVER: '配音',
  TIMELINE: '时间轴',
  SEMANTIC: '语义',
  RENDER: '渲染',
}

export const STEP_DESCRIPTIONS = {
  SCRIPT: '提示词 → AI 生成脚本 → 用户确认/编辑',
  VOICEOVER: '配音提示词确认 + 配音生成/选择 + ASR 对齐',
  TIMELINE: '时间轴确认 + 动效确认（可 nudge/shift 微调）',
  SEMANTIC: '语义决策：贴纸/动效/转场审阅与修改',
  RENDER: '最终视频生成（预览 + 导出）',
}

// UI 向导状态（用户确认门，原 pipelineState.js）
export const UI_STATUS = {
  PENDING: 'PENDING',
  AWAIT_CONFIRM: 'AWAIT_CONFIRM',
  CONFIRMED: 'CONFIRMED',
  DONE: 'DONE',
}

// 生产状态（agent / 后端运行时，原散落在 agent-bridge 的 running/aligned/...）
// 任一步骤可能因上游变更而 STALE，需重新确认。
export const PROJECT_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  WAITING_USER: 'WAITING_USER',
  WAITING_AGENT: 'WAITING_AGENT',
  VALIDATING: 'VALIDATING',
  FAILED: 'FAILED',
  STALE: 'STALE',
  CANCELLED: 'CANCELLED',
  SUCCEEDED: 'SUCCEEDED',
}

// 步骤对应的产物文件名（artifacts/ 目录约定，见 issue⑦）
export const STEP_ARTIFACTS = {
  SCRIPT: 'script.json',
  VOICEOVER: 'voiceover.json',
  TIMELINE: 'timeline.json',
  SEMANTIC: 'effects.json',
  RENDER: 'final.mp4',
}

// 把步骤名映射到生产状态（用于把 UI 确认门投影到统一运行时状态）
export function projectStatusFromStep(stepStatus) {
  switch (stepStatus) {
    case UI_STATUS.CONFIRMED:
    case UI_STATUS.DONE:
      return PROJECT_STATUS.SUCCEEDED
    case UI_STATUS.AWAIT_CONFIRM:
      return PROJECT_STATUS.WAITING_USER
    default:
      return PROJECT_STATUS.PENDING
  }
}

// 后续步骤因上游编辑而失效 → STALE（对应原 backToStep/editArtifact 的「后续回 PENDING」语义）
export function markStaleAfter(steps, fromStep) {
  const idx = STEP_ORDER.indexOf(fromStep)
  if (idx < 0) return steps
  const next = { ...steps }
  for (let i = idx + 1; i < STEP_ORDER.length; i++) {
    const s = STEP_ORDER[i]
    next[s] = { ...next[s], status: UI_STATUS.PENDING, project_status: PROJECT_STATUS.STALE }
  }
  return next
}

// 项目目录与产物路径约定（node 端使用；浏览器不调用，故不在此引入 node:path）
export const PROJECT_ROOT_REL = 'projects'
export function projectDirName(projectId) {
  return projectId || 'default'
}
