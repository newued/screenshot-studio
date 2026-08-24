// 特效词表（V1.1 设计文档第 6 节）
// 渲染器单一事实源：三类特效（sticker / motion / transition）
// LLM 决策契约：输出仅引用此词表中的 kind，不臆造词表外特效。
//
// 现状（A1 选型后）：气泡动效共 61 种，其中 8 种由 ctx.filter 真出（blur_in/blur_out/glow/
// neon/invert/sepia/bloom/glitch 色偏），其余为变换驱动；cube/dissolve/ink_out/wipe_*/fan_expand
// dissolve_out 仍属 transform 近似占位（C 轮做像素级 warp）。新增 kind 必须同步在 animations.js 注册。

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
// 作用于消息气泡；kind 与 animations.js 引擎注册表一一对应（单一真相源）。
// 一、入场 / 二、出场 / 三、组合 / 四、循环 / 补充，详见 animations.js。
const MOTIONS = [
  // 一、入场（20）
  { kind: 'fade_in', label: '渐显', desc: '柔和淡入' },
  { kind: 'zoom_in', label: '放大', desc: '由小放大出现' },
  { kind: 'shrink_in', label: '缩小', desc: '由大缩小归位' },
  { kind: 'slide_in_right', label: '向右滑入', desc: '从右侧滑入' },
  { kind: 'slide_in_left', label: '向左滑入', desc: '从左侧滑入' },
  { kind: 'slide_in_top', label: '向上滑入', desc: '从上方滑入' },
  { kind: 'slide_in_bottom', label: '向下滑入', desc: '从下方滑入' },
  { kind: 'dynamic_zoom', label: '动感放大', desc: '带回弹的放大' },
  { kind: 'rebound', label: '回弹', desc: '先大后回弹归位' },
  { kind: 'bounce_in', label: '弹跳', desc: '弹跳弹出' },
  { kind: 'spin_in', label: '旋转入场', desc: '旋转 360 进入' },
  { kind: 'wipe_right', label: '向右擦除', desc: '近似：右滑+淡入' },
  { kind: 'wipe_left', label: '向左擦除', desc: '近似：左滑+淡入' },
  { kind: 'fade_zoom', label: '渐隐放大', desc: '淡入同时放大' },
  { kind: 'cube', label: '立方体', desc: '近似：透视翻入' },
  { kind: 'blur_in', label: '模糊显现', desc: '真模糊：由模糊淡入清晰' },
  { kind: 'dissolve', label: '溶解', desc: '近似：颗粒淡入' },
  { kind: 'fan_expand', label: '扇形展开', desc: '近似：缩放+旋入' },
  { kind: 'push_in', label: '推进', desc: '由远推近' },
  // 二、出场（15）
  { kind: 'fade_out', label: '渐隐', desc: '淡出' },
  { kind: 'shrink_out', label: '缩小消失', desc: '缩小淡出' },
  { kind: 'slide_out_right', label: '向右滑出', desc: '向右滑出' },
  { kind: 'slide_out_left', label: '向左滑出', desc: '向左滑出' },
  { kind: 'slide_out_top', label: '向上滑出', desc: '向上滑出' },
  { kind: 'slide_out_bottom', label: '向下滑出', desc: '向下滑出' },
  { kind: 'rotate_out', label: '旋转消失', desc: '旋转淡出' },
  { kind: 'rebound_out', label: '回弹消失', desc: '回弹缩小消失' },
  { kind: 'bounce_out', label: '弹跳消失', desc: '弹跳缩小消失' },
  { kind: 'blur_out', label: '模糊消失', desc: '真模糊：放大并模糊淡出' },
  { kind: 'dissolve_out', label: '溶解消失', desc: '近似：颗粒淡出' },
  { kind: 'fold_out', label: '折叠', desc: '纵向折叠收起' },
  { kind: 'fling_out', label: '甩出', desc: '甩飞带旋转' },
  { kind: 'ink_out', label: '水墨消失', desc: '近似：晕开淡出' },
  { kind: 'fade_shrink', label: '渐隐缩小', desc: '淡出同时缩小' },
  // 三、组合（10，enter+exit 或含循环）
  { kind: 'clone', label: '分身', desc: '近似：弹入+微脉冲' },
  { kind: 'funhouse', label: '哈哈镜', desc: '横向拉伸纵向压缩' },
  { kind: 'top_spin', label: '小陀螺', desc: '旋转入场+持续转' },
  { kind: 'swing', label: '荡秋千', desc: '大幅钟摆旋转' },
  { kind: 'flip_flop', label: '翻翻转转', desc: '持续 360 翻滚' },
  { kind: 'slide_play', label: '滑滑梯', desc: '下滑+弹跳+滑出' },
  { kind: 'boing', label: '弹弹乐', desc: '强烈上下弹跳' },
  { kind: 'sway', label: '摇摆', desc: '轻微左右摇摆' },
  { kind: 'shake', label: '抖动', desc: '高频小幅抖动' },
  { kind: 'pulse', label: '脉冲', desc: '缩放脉冲' },
  // 四、循环（5，全程持续）
  { kind: 'zoom_loop', label: '放大缩小', desc: '循环呼吸缩放' },
  { kind: 'sway_loop', label: '摇摆循环', desc: '循环摇摆' },
  { kind: 'rotate_loop', label: '旋转循环', desc: '持续匀速旋转' },
  { kind: 'heartbeat', label: '心跳', desc: '双跳心跳缩放' },
  { kind: 'micro_shake', label: '轻微抖动', desc: '极轻微抖动' },
  // 补充：文字字幕热门（叠气泡层可复用）
  { kind: 'flicker', label: '闪烁', desc: '透明度频闪' },
  { kind: 'glitch', label: '故障', desc: '近似：错位抖动' },
  { kind: 'wave', label: '波浪', desc: '近似：错切波动' },
  { kind: 'vibrate', label: '震动', desc: '高频位移动感' },
  { kind: 'float', label: '漂浮', desc: '轻柔上下漂浮' },
  { kind: 'breathe', label: '呼吸', desc: '细微呼吸缩放' },
  { kind: 'bounce', label: '弹跳', desc: '循环上下弹跳' },
  // 五、真实滤镜（A1：ctx.filter 真出，渲染器实际渲染，不再是近似）
  { kind: 'glow', label: '发光', desc: '金色辉光呼吸（真滤镜）' },
  { kind: 'neon', label: '霓虹', desc: '青色霓虹发光（真滤镜）' },
  { kind: 'invert', label: '负片闪', desc: '负片闪现归位（真滤镜）' },
  { kind: 'sepia', label: '老照片', desc: '棕褐老照片闪现（真滤镜）' },
  { kind: 'bloom', label: '高光脉冲', desc: '亮度脉冲呼吸（真滤镜）' },
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
