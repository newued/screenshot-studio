// 管线状态机（V1.1 设计文档第 3 节）
// 状态枚举：PENDING → AWAIT_CONFIRM → CONFIRMED → DONE
// 步骤顺序：SCRIPT → VOICEOVER → TIMELINE → SEMANTIC → RENDER
// 仅当前步 CONFIRMED 后解锁下一步；current_step 可回退。
// 真相源：localStorage 中的 pipeline_state 对象 + 各步骤产物。
// 会话中断/重开均从 localStorage 恢复。

export const STEP_ORDER = ['SCRIPT', 'VOICEOVER', 'TIMELINE', 'SEMANTIC', 'RENDER']

export const STEP_STATUS = {
  PENDING: 'PENDING',
  AWAIT_CONFIRM: 'AWAIT_CONFIRM',
  CONFIRMED: 'CONFIRMED',
  DONE: 'DONE',
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

// 步骤产物文件名（对应设计文档目录结构中的 artifacts/）
export const STEP_ARTIFACTS = {
  SCRIPT: 'script.json',
  VOICEOVER: 'voiceover.json',
  TIMELINE: 'timeline.json',
  SEMANTIC: 'effects.json',
  RENDER: 'final.mp4',
}

/**
 * 初始化管线状态
 * @param {string} projectId - 项目唯一 ID
 * @param {string} mode - 'single' | 'group'
 * @returns {object} 初始 pipeline_state
 */
export function initState(projectId = '', mode = 'single') {
  return {
    project_id: projectId,
    mode,
    current_step: 'SCRIPT',
    steps: {
      SCRIPT:    { status: STEP_STATUS.AWAIT_CONFIRM, artifact: null, edited: false },
      VOICEOVER: { status: STEP_STATUS.PENDING,       artifact: null, edited: false },
      TIMELINE:  { status: STEP_STATUS.PENDING,       artifact: null, edited: false },
      SEMANTIC:  { status: STEP_STATUS.PENDING,       artifact: null, edited: false },
      RENDER:    { status: STEP_STATUS.PENDING,       artifact: null, edited: false },
    },
  }
}

/**
 * 从 localStorage 加载管线状态
 * @param {string} key - 存储键（如 pipeline:wechat:single）
 * @returns {object|null} 管线状态，或 null（无存档）
 */
export function loadState(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const state = JSON.parse(raw)
    // 校验基本结构
    if (!state.steps || !state.current_step) return null
    return state
  } catch {
    return null
  }
}

/**
 * 保存管线状态到 localStorage
 * @param {string} key - 存储键
 * @param {object} state - 管线状态
 */
export function saveState(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* 存储满时忽略 */
  }
}

/**
 * 确认当前步骤，推进到下一步
 * - 当前步 → CONFIRMED
 * - 下一步 → AWAIT_CONFIRM
 * - 若已是最后一步 → DONE
 * @param {object} state - 当前状态（不可变，返回新对象）
 * @param {object} artifact - 本步产物
 * @returns {object} 新状态
 */
export function confirmStep(state, artifact = null) {
  const newSteps = { ...state.steps }
  const current = state.current_step
  newSteps[current] = {
    ...newSteps[current],
    status: STEP_STATUS.CONFIRMED,
    artifact: artifact || newSteps[current].artifact,
    edited: false,
  }

  const idx = STEP_ORDER.indexOf(current)
  let nextStep = current
  if (idx < STEP_ORDER.length - 1) {
    nextStep = STEP_ORDER[idx + 1]
    newSteps[nextStep] = {
      ...newSteps[nextStep],
      status: STEP_STATUS.AWAIT_CONFIRM,
    }
  } else {
    // 最后一步确认 → DONE
    newSteps[current] = { ...newSteps[current], status: STEP_STATUS.DONE }
  }

  return {
    ...state,
    current_step: nextStep,
    steps: newSteps,
  }
}

/**
 * 回退到指定步骤
 * - 目标步骤 → AWAIT_CONFIRM
 * - 其后续步骤 → PENDING（产物保留但状态重置）
 * @param {object} state - 当前状态
 * @param {string} stepName - 目标步骤名
 * @returns {object} 新状态
 */
export function backToStep(state, stepName) {
  const newSteps = { ...state.steps }
  const targetIdx = STEP_ORDER.indexOf(stepName)
  if (targetIdx < 0) return state

  // 目标步骤回 AWAIT_CONFIRM
  newSteps[stepName] = {
    ...newSteps[stepName],
    status: STEP_STATUS.AWAIT_CONFIRM,
    edited: true,
  }

  // 后续步骤回 PENDING（保留产物以供参考，但状态重置）
  for (let i = targetIdx + 1; i < STEP_ORDER.length; i++) {
    const s = STEP_ORDER[i]
    newSteps[s] = {
      ...newSteps[s],
      status: STEP_STATUS.PENDING,
    }
  }

  return {
    ...state,
    current_step: stepName,
    steps: newSteps,
  }
}

/**
 * 编辑某步骤产物（状态回 AWAIT_CONFIRM，标记 edited）
 * 如果该步骤已 CONFIRMED，需重新确认
 * @param {object} state - 当前状态
 * @param {string} stepName - 被编辑的步骤
 * @returns {object} 新状态
 */
export function editArtifact(state, stepName) {
  const newSteps = { ...state.steps }
  const stepIdx = STEP_ORDER.indexOf(stepName)
  if (stepIdx < 0) return state

  // 该步骤及后续步骤状态回退
  newSteps[stepName] = {
    ...newSteps[stepName],
    status: STEP_STATUS.AWAIT_CONFIRM,
    edited: true,
  }
  for (let i = stepIdx + 1; i < STEP_ORDER.length; i++) {
    const s = STEP_ORDER[i]
    newSteps[s] = {
      ...newSteps[s],
      status: STEP_STATUS.PENDING,
    }
  }

  return {
    ...state,
    current_step: stepName,
    steps: newSteps,
  }
}

/**
 * 更新某步骤产物（不改变状态，仅更新 artifact）
 * 用于在 AWAIT_CONFIRM 阶段生成/导入产物
 */
export function setArtifact(state, stepName, artifact) {
  const newSteps = { ...state.steps }
  newSteps[stepName] = {
    ...newSteps[stepName],
    artifact,
  }
  return { ...state, steps: newSteps }
}

/**
 * 获取状态摘要文本（用于 /status 显示）
 */
export function getStatusSummary(state) {
  if (!state) return '无管线状态'
  const lines = [`项目: ${state.project_id || '(未命名)'}  模式: ${state.mode}`]
  lines.push(`当前步骤: ${STEP_LABELS[state.current_step] || state.current_step}`)
  lines.push('')
  for (const step of STEP_ORDER) {
    const s = state.steps[step]
    if (!s) continue
    const label = STEP_LABELS[step]
    const status = s.status
    const edited = s.edited ? ' [已编辑]' : ''
    const hasArtifact = s.artifact ? ' ✓' : ''
    lines.push(`  ${label}: ${status}${edited}${hasArtifact}`)
  }
  return lines.join('\n')
}

/**
 * 检查某步骤是否已确认
 */
export function isStepConfirmed(state, stepName) {
  return state?.steps?.[stepName]?.status === STEP_STATUS.CONFIRMED ||
         state?.steps?.[stepName]?.status === STEP_STATUS.DONE
}

/**
 * 检查某步骤是否有产物
 */
export function hasArtifact(state, stepName) {
  return !!state?.steps?.[stepName]?.artifact
}

/**
 * 获取第一个未确认的步骤（即当前应处理的步骤）
 */
export function getFirstUnconfirmedStep(state) {
  for (const step of STEP_ORDER) {
    if (!isStepConfirmed(state, step)) return step
  }
  return STEP_ORDER[STEP_ORDER.length - 1] // 全部已确认
}
