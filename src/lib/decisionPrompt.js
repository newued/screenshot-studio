// 决策提示词生成器（V1.1 第 6 节）：使用特效词表构建 LLM 决策契约
// 输入脚本 + 词表 → 输出仅引用词表 kind 的决策提示词
// 与原 VideoPipelinePanel 中的 buildDecisionPrompt 不同：
//   ① 使用 V1.1 effectsCatalog 三层词表（sticker/motion/transition）
//   ② 约束 LLM 只引用词表 kind，不臆造词表外特效
//   ③ 附 few-shot 示例

import { EFFECTS_CATALOG } from './effectsCatalog'

/**
 * 构建给 AI 的决策提示词（V1.1 特效词表版）
 * @param {Array} messages - 消息列表
 * @param {object} catalogSummary - 词表摘要（可选，默认用 effectsCatalog）
 * @returns {string} 提示词文本
 */
export function buildDecisionPromptForCatalog(messages = [], catalogSummary = null) {
  const summary = catalogSummary || {
    sticker: EFFECTS_CATALOG.sticker.map(s => ({ kind: s.kind, label: s.label })),
    motion: EFFECTS_CATALOG.motion.map(m => ({ kind: m.kind, label: m.label, desc: m.desc })),
  }

  const list = messages.map((m, i) => ({
    index: i,
    speaker: m.speaker || 'A',
    content: m.content || m.text || '',
  }))

  return `你是一个短视频贴纸与入场动画决策助手。给定聊天对话（每条含 speaker 与 content）以及可用的特效词表，请为每条消息判断：
- emotion：情绪标签，取值 neutral / happy / sad / angry / surprise
- sticker：从贴纸词表中选一个最贴合消息语义的 kind；若没有合适的，填空字符串 ""
- effect：从动效词表中选一个入场动画 kind

约束：
① 只在语义节点插入（笑点→laugh+pop，冲突→shake，转折→其他 motion）
② 不臆造词表外特效
③ 输出仅引用词表中的 kind 字符串

贴纸词表（sticker kind → 含义）：
${JSON.stringify(summary.sticker, null, 2)}

动效词表（motion kind → 含义）：
${JSON.stringify(summary.motion, null, 2)}

对话：
${JSON.stringify(list, null, 2)}

只输出一个 JSON 数组，元素顺序与输入消息一一对应，不要任何解释、不要 markdown 代码块。

输出格式示例：
[{"emotion":"angry","sticker":"angry","effect":"shake"},{"emotion":"happy","sticker":"laugh","effect":"pop"}]`
}

/**
 * 将 AI 决策（kind 形式）映射回渲染器需要的文件名/效果名
 * AI 可能返回 sticker kind（如 "laugh"）而非文件名（如 "happy_01.png"）
 * 需要统一映射
 * @param {Array} decisions - AI 生成的决策数组
 * @returns {Array} 映射后的决策数组（与原 decideSemantics 格式一致）
 */
export function mapCatalogDecisions(decisions = []) {
  const stickerMap = {}
  for (const s of EFFECTS_CATALOG.sticker) {
    stickerMap[s.kind] = s.file
  }

  return decisions.map(d => {
    // sticker: 如果是 kind（如 "laugh"），映射为文件名；如果已经是文件名，保持不变
    let sticker = d.sticker || ''
    if (sticker && stickerMap[sticker]) {
      sticker = stickerMap[sticker]
    }
    // effect: 如果是 motion kind（如 "pop"），映射为渲染器 effect（如 "pop_in"）
    let effect = d.effect || 'fade_in'
    const motionMap = {
      pop: 'pop_in',
      shake: 'fade_in',     // 渲染器无 shake，降级
      zoom: 'pop_in',       // 渲染器无 zoom，降级
      flash: 'fade_in',
      float: 'fade_in',
      glitch: 'fade_in',
      fade_in: 'fade_in',
      slide_in_left: 'slide_in_left',
      slide_in_right: 'slide_in_right',
    }
    effect = motionMap[effect] || effect

    return {
      emotion: d.emotion || 'neutral',
      sticker,
      sfx: d.sfx || '',
      effect,
    }
  })
}
