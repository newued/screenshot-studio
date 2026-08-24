// scripts/core/decisions.js
// 创意决策处理（从 agent-bridge.mjs 抽出，解决反馈⑤）
// 1) applyDecisionsToMessages：把 agent 产出的 [{emotion,sticker,effect}] 合并进消息数组
// 2) tagStickers：确定性情绪兜底标注（阈值过滤，agent 的 LLM 层可覆盖）

import { EFFECTS_CATALOG } from '../../src/lib/effectsCatalog.js'

// 动效词表 kind → 渲染器入场枚举（canvasChat ENTER_SET 支持的值）
const EFFECT_MAP = {
  pop: 'pop_in',
  zoom: 'zoom_in',
  shake: 'bounce_in',
  flash: 'flip_in',
  float: 'slide_in_top',
  glitch: 'flip_in',
  fade_in: 'fade_in',
  slide_in_left: 'slide_in_left',
  slide_in_right: 'slide_in_right',
}

// 把 LLM 决策（sticker 可为 kind 或文件名；effect 可为 motion kind 或渲染器枚举）合并进消息数组
export function applyDecisionsToMessages(messages, decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) return messages
  const kindToFile = {}
  for (const s of (EFFECTS_CATALOG.sticker || [])) kindToFile[s.kind] = s.file
  return messages.map((m, i) => {
    const d = decisions[i]
    if (!d) return m
    let sticker = d.sticker || ''
    if (sticker && kindToFile[sticker]) sticker = kindToFile[sticker] // kind→文件名（如 laugh→happy_01.png）
    let effect = d.effect || m.effect || 'random'
    if (EFFECT_MAP[effect]) effect = EFFECT_MAP[effect] // motion kind→渲染器枚举；已是渲染器枚举则保持
    return { ...m, emotion: d.emotion || m.emotion || 'neutral', sticker, effect }
  })
}

// ---- 语义贴纸标注（确定性兜底） ----
const STICKER_THRESHOLD = 0.4

export function scoreEmotion(speaker, content) {
  const c = content || ''
  let s = 0.2
  const hits = [
    [/(扣.*绩效|滚|闭嘴|你算哪根葱|别惹我|你还要我怎样|我说了算|改红色|必须|赶紧)/, 0.7],
    [/(你慢点放屁|不存在的|小牛马|职场如戏|你清醒一点|你就是个|你算哪根)/, 0.6],
    [/(早这样多好|非要吵|活该|活该你|就该)/, 0.55],
    [/(扣吧|随便|无所谓|也行|蓝色就蓝色|那.*就.*吧)/, 0.3],
    [/(不改|设计稿|不该|不行|不要)/, 0.3],
  ]
  for (const [re, v] of hits) if (re.test(c)) s = Math.max(s, v)
  return Math.min(1, s)
}

export function pickSticker(score, content) {
  if (score < STICKER_THRESHOLD) return null
  const c = content || ''
  if (/扣.*绩效|愤怒|滚|闭嘴/.test(c)) return 'angry_01.png'
  if (/我说了算|改红色|必须|赶紧|你还要我怎样/.test(c)) return '你还要我怎样.jpg'
  if (/你算哪根葱|别惹我|你清醒一点/.test(c)) return '你算哪根葱.jpg'
  if (/你慢点放屁|不存在的|小牛马|职场如戏/.test(c)) return '你就是个小牛马.webp'
  if (/早这样多好|非要吵/.test(c)) return '你就是个小牛马.webp'
  if (score >= 0.8) return 'angry_01.png'
  return '你就是个小牛马.webp'
}

export { STICKER_THRESHOLD }
