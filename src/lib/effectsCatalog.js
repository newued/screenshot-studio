// 特效词表（V1.1 设计文档第 6 节）
// 渲染器单一事实源：三类特效（sticker / motion / transition）
// LLM 决策契约：输出仅引用此词表中的 kind，不臆造词表外特效。

// ========== 贴纸（sticker）==========
// 每项含 kind + 资源路径 + 可选动画
const STICKERS = [
  { kind: 'laugh',   label: '哈哈大笑', file: 'happy_01.png',     anim: 'pop',    pos: 'br' },
  { kind: 'cry',     label: '伤心哭泣', file: 'sad_01.png',       anim: 'float',  pos: 'br' },
  { kind: 'shock',   label: '震惊惊讶', file: 'surprise_01.png',  anim: 'pop',    pos: 'br' },
  { kind: 'angry',   label: '愤怒生气', file: 'angry_01.png',     anim: 'shake',  pos: 'br' },
  { kind: 'heart',   label: '心动喜欢', file: '我爱你.jpg',        anim: 'float',  pos: 'br' },
  { kind: 'fire',    label: '火爆燃炸', file: '狂飙-给爷死.jpg',    anim: 'zoom',   pos: 'br' },
  { kind: 'question',label: '疑问不解', file: '怀疑人生.jpg',      anim: 'float',  pos: 'br' },
  { kind: 'watch',   label: '吃瓜围观', file: '吃瓜-强势围观.jpg',  anim: 'pop',    pos: 'br' },
  { kind: 'speechless', label: '无语了', file: '动态小表情-无语了.gif', anim: 'float', pos: 'br' },
  { kind: 'awesome', label: '太优秀了', file: '懂了，优秀.gif',     anim: 'pop',    pos: 'br' },
]

// ========== 气泡动效（motion）==========
// 作用于消息气泡的入场/强调动画
const MOTIONS = [
  { kind: 'pop',          label: '弹入',     desc: '缩放弹出，适合强调/疑问' },
  { kind: 'shake',        label: '抖动',     desc: '左右抖动，适合冲突/愤怒' },
  { kind: 'zoom',         label: '放大',     desc: '快速放大，适合震惊/强调' },
  { kind: 'flash',        label: '闪烁',     desc: '透明度闪烁，适合转折' },
  { kind: 'float',        label: '漂浮',     desc: '轻柔漂浮，适合抒情/心动' },
  { kind: 'glitch',       label: '故障',     desc: '数字故障效果，适合冲突' },
  { kind: 'fade_in',      label: '渐显',     desc: '默认入场，柔和淡入' },
  { kind: 'slide_in_left', label: '左滑入',  desc: '从左滑入，B 方消息' },
  { kind: 'slide_in_right',label: '右滑入',  desc: '从右滑入，A 方消息' },
]

// ========== 场景转场（transition）==========
// 作用于场景切换处（speaker_change / scene_cut）
const TRANSITIONS = [
  { kind: 'fade',       label: '淡入淡出', duration: 0.4 },
  { kind: 'slide',      label: '滑动切换', duration: 0.5 },
  { kind: 'zoom_blur',  label: '缩放模糊', duration: 0.6 },
  { kind: 'spin',       label: '旋转切换', duration: 0.5 },
  { kind: 'glitch',     label: '故障切换', duration: 0.4 },
]

// ========== 导出 ==========

export const EFFECTS_CATALOG = {
  sticker: STICKERS,
  motion: MOTIONS,
  transition: TRANSITIONS,
}

// 获取所有贴纸 kind 列表
export function getStickerKinds() {
  return STICKERS.map(s => s.kind)
}

// 获取所有动效 kind 列表
export function getMotionKinds() {
  return MOTIONS.map(m => m.kind)
}

// 获取所有转场 kind 列表
export function getTransitionKinds() {
  return TRANSITIONS.map(t => t.kind)
}

// 根据 kind 查找贴纸
export function findSticker(kind) {
  return STICKERS.find(s => s.kind === kind) || null
}

// 根据 kind 查找动效
export function findMotion(kind) {
  return MOTIONS.find(m => m.kind === kind) || null
}

// 根据 kind 查找转场
export function findTransition(kind) {
  return TRANSITIONS.find(t => t.kind === kind) || null
}

// 验证 kind 是否在词表中
export function isValidKind(layer, kind) {
  const cat = EFFECTS_CATALOG[layer]
  if (!cat) return false
  return cat.some(item => item.kind === kind)
}

// 构建给 LLM 的词表摘要（用于决策提示词）
export function buildCatalogSummary() {
  return {
    sticker: STICKERS.map(s => ({ kind: s.kind, label: s.label })),
    motion: MOTIONS.map(m => ({ kind: m.kind, label: m.label, desc: m.desc })),
    transition: TRANSITIONS.map(t => ({ kind: t.kind, label: t.label })),
  }
}
