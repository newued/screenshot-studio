// animations.js —— 动效引擎（纯函数、数据驱动）
// 设计：一条动效 = enter（入场）/ ambient（显示期间循环）/ exit（离场）三套变换。
// 每个 effect 定义返回 { dx, dy, scaleX, scaleY, rotate, skewX, skewY, alpha }，
// 渲染层只负责把该变换 apply 到气泡组，不再内联数学。
// 词表（kind 列表）由 effectsCatalog.js 作为唯一真相源；本文件只实现「给定 kind 如何变换」。
//
// 说明：剪映式「擦除/扇形/立方体/溶解/水墨/墨迹」等仍用 translate/scale/rotate/skew 做**近似**
// （标注 approx）。但「模糊/辉光/霓虹/负片/老照片/高光脉冲/故障色偏」已升级为**真滤镜**
// （A1）：由 animations.js 的 evalFilter 输出 CSS filter 字符串，渲染层用 ctx.filter 让 Skia 真出，
// 不再是近似。像素级 warp（RGB 分离 / 逐行位移 / clip 擦除）留待后续 C 轮增强。
//
// 左右区分（入场/出场均考虑「自己的气泡 / 对方的气泡」）：
//  - 入场方向由 canvasChat.js 的 pickEntrance 按 mine 分流左右入场池决定；
//  - 出场由 DEFAULT_EXIT(p, mine, center) 决定：center=true 朝屏心收，center=false 滑向各自一侧；
//    渲染层按消息索引确定性混搭（it.i%3!==0 多数为中间收），做到「有些中间收、有些各自侧」。

const TAU = Math.PI * 2

export const IDENTITY = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotate: 0, skewX: 0, skewY: 0, alpha: 1 }

const clamp01 = (x) => Math.min(1, Math.max(0, x))
function easeOutBack(p, c = 1.70158) {
  const c3 = c + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
}
function easeOut(p) {
  return 1 - (1 - p) * (1 - p)
}
function sin01(t, f, phase = 0) {
  return Math.sin((t * f + phase) * TAU)
}
// 0..1..0 三角波
function tri01(t, f, phase = 0) {
  const x = (((t * f + phase) % 1) + 1) % 1
  return x < 0.5 ? x * 2 : 2 - x * 2
}

// ---------- 真实滤镜（A1：ctx.filter，由 Skia 实际渲染；作用于整组气泡） ----------
// 这些不再是近似：模糊/辉光/霓虹/负片/老照片/高光脉冲/故障色偏都由浏览器/Node Skia 真出。
const fBlur = (px) => `blur(${Math.max(0, px).toFixed(1)}px)`
function fBlurIn(p) { return fBlur((1 - p) * 16) }
function fBlurOut(p) { return fBlur(p * 16) }
function fGlow(t) { const b = 6 + 5 * (0.5 + 0.5 * Math.sin(t * 4)); return `drop-shadow(0 0 ${b.toFixed(1)}px rgba(255,214,120,.95))` }
function fNeon(t) { const b = 5 + 4 * (0.5 + 0.5 * Math.sin(t * 5)); return `drop-shadow(0 0 ${b.toFixed(1)}px #36e0ff) saturate(1.6) brightness(1.15)` }
function fInvertFlash(p) { return `invert(${(1 - p).toFixed(2)})` }
function fSepiaFlash(p) { return `sepia(${((1 - p) * 0.85).toFixed(2)}) contrast(1.05)` }
function fBloom(t) { const b = 1 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3)); return `brightness(${b.toFixed(2)}) saturate(${b.toFixed(2)})` }
function fGlitchHue(t) { const h = (Math.sin(t * 37) >= 0 ? 1 : -1) * (20 + 60 * Math.abs(Math.sin(t * 13))); return `hue-rotate(${h.toFixed(0)}deg)` }

const FILTERS = {
  blur_in: { enter: fBlurIn },
  blur_out: { exit: fBlurOut },
  glow: { ambient: fGlow },
  neon: { ambient: fNeon },
  invert: { enter: fInvertFlash },
  sepia: { enter: fSepiaFlash },
  bloom: { ambient: fBloom },
  glitch: { ambient: fGlitchHue },
}

// 计算某 kind 在时间 t 应施加的 ctx.filter 字符串（无则为 ''）。
// 相位与 evalEffect 完全一致：入场用 f.enter、离场用 f.exit、显示期间用 f.ambient。
export function evalFilter(kind, t, win, { enterDur = 0.4, exitDur = 0.35, mine = false } = {}) {
  const fdef = FILTERS[kind] || {}
  if (!fdef.enter && !fdef.exit && !fdef.ambient) return ''
  const ds = win?.ds || 0
  const de = win?.de || ds + 1
  const enterP = clamp01((t - ds) / enterDur)
  if (enterP < 1 && fdef.enter) return fdef.enter(enterP)
  if (t > de && fdef.exit) return fdef.exit(clamp01((t - de) / exitDur), mine)
  if (fdef.ambient) return fdef.ambient(t)
  return ''
}

// 组合两个变换（a 先、b 叠加）
export function compose(a, b) {
  return {
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scaleX: a.scaleX * b.scaleX,
    scaleY: a.scaleY * b.scaleY,
    rotate: a.rotate + b.rotate,
    skewX: a.skewX + b.skewX,
    skewY: a.skewY + b.skewY,
    alpha: a.alpha * b.alpha,
  }
}

// 将一个变换应用到 ctx（绕中心 cx,cy 做 translate/scale/rotate/skew）
export function applyTransform(ctx, tr, cx, cy) {
  ctx.translate(tr.dx, tr.dy)
  ctx.translate(cx, cy)
  ctx.scale(tr.scaleX, tr.scaleY)
  if (tr.rotate) ctx.rotate((tr.rotate * Math.PI) / 180)
  if (tr.skewX || tr.skewY) {
    ctx.transform(1, Math.tan((tr.skewY || 0) * Math.PI / 180), Math.tan((tr.skewX || 0) * Math.PI / 180), 1, 0, 0)
  }
  ctx.translate(-cx, -cy)
}

const ENTER_FADE = (p) => ({ ...IDENTITY, alpha: clamp01(p * 1.5) })
// 默认离场（无显式 exit 时）：淡出 + 轻移 + 轻微缩小。
// center=true → 向中间收（自己的往左、对方的往右，朝屏心收束）；
// center=false → 滑向各自一侧（自己的往右、对方的往左，朝自己那条边退场）。
// 渲染层按消息索引确定性混搭，做到「有些中间收、有些各自滑出」。
const DEFAULT_EXIT = (p, mine, center = true) => {
  const dir = center ? (mine ? -1 : 1) : (mine ? 1 : -1)
  return {
    ...IDENTITY,
    alpha: clamp01(1 - p * 1.6),
    dx: dir * 110 * p,
    scaleX: 1 - 0.14 * p,
    scaleY: 1 - 0.14 * p,
  }
}

// ============================ 动效注册表 ============================
const EFFECTS = {
  // ---------------- 一、入场（20） ----------------
  fade_in: { enter: ENTER_FADE }, // 1 渐显
  zoom_in: { enter: (p) => ({ ...IDENTITY, scaleX: 0.6 + 0.4 * easeOut(p), scaleY: 0.6 + 0.4 * easeOut(p) }) }, // 2 放大
  shrink_in: { enter: (p) => ({ ...IDENTITY, scaleX: 1.3 - 0.3 * easeOut(p), scaleY: 1.3 - 0.3 * easeOut(p) }) }, // 3 缩小
  slide_in_right: { enter: (p) => ({ ...IDENTITY, dx: 120 * (1 - p) }) }, // 4 向右滑入
  slide_in_left: { enter: (p) => ({ ...IDENTITY, dx: -120 * (1 - p) }) }, // 5 向左滑入
  slide_in_top: { enter: (p) => ({ ...IDENTITY, dy: -120 * (1 - p) }) }, // 6 向上滑入
  slide_in_bottom: { enter: (p) => ({ ...IDENTITY, dy: 120 * (1 - p) }) }, // 7 向下滑入
  dynamic_zoom: { enter: (p) => ({ ...IDENTITY, scaleX: 0.5 + 0.5 * easeOutBack(p, 2.0), scaleY: 0.5 + 0.5 * easeOutBack(p, 2.0) }) }, // 8 动感放大
  rebound: { enter: (p) => ({ ...IDENTITY, scaleX: 1.25 - 0.25 * easeOutBack(p), scaleY: 1.25 - 0.25 * easeOutBack(p) }) }, // 9 回弹
  bounce_in: { enter: (p) => ({ ...IDENTITY, scaleX: easeOutBack(p, 2.4), scaleY: easeOutBack(p, 2.4) }) }, // 10 弹跳
  spin_in: { enter: (p) => ({ ...IDENTITY, alpha: clamp01(p * 1.5), rotate: (1 - p) * 360 }) }, // 11 旋转入场
  wipe_right: { enter: (p) => ({ ...IDENTITY, dx: 120 * (1 - p), alpha: p }) }, // 12 向右擦除(approx)
  wipe_left: { enter: (p) => ({ ...IDENTITY, dx: -120 * (1 - p), alpha: p }) }, // 13 向左擦除(approx)
  fade_zoom: { enter: (p) => ({ ...IDENTITY, alpha: clamp01(p * 1.5), scaleX: 0.8 + 0.2 * p, scaleY: 0.8 + 0.2 * p }) }, // 14 渐隐放大
  cube: { enter: (p) => ({ ...IDENTITY, scaleX: 0.2 + 0.8 * easeOutBack(p), skewY: 18 * (1 - p) * Math.sin(p * Math.PI) }) }, // 15 立方体(approx)
  blur_in: { enter: (p) => ({ ...IDENTITY, alpha: clamp01(p * 1.4), scaleX: 0.92 + 0.08 * p, scaleY: 0.92 + 0.08 * p }) }, // 17 模糊显现(approx)
  dissolve: { enter: (p) => ({ ...IDENTITY, alpha: 0.2 + 0.8 * tri01(p, 5), scaleX: 0.9 + 0.1 * p, scaleY: 0.9 + 0.1 * p }) }, // 18 溶解(approx)
  fan_expand: { enter: (p) => ({ ...IDENTITY, scaleX: 0.2 + 0.8 * easeOutBack(p), rotate: (1 - p) * 15 }) }, // 19 扇形展开(approx)
  push_in: { enter: (p) => ({ ...IDENTITY, scaleX: 1.15 - 0.15 * easeOut(p), scaleY: 1.15 - 0.15 * easeOut(p), dx: 40 * (1 - p) }) }, // 20 推进

  // ---------------- 二、出场（15） ----------------
  fade_out: { exit: (p) => ({ ...IDENTITY, alpha: 1 - p }) }, // 21 渐隐
  shrink_out: { exit: (p) => ({ ...IDENTITY, alpha: 1 - p, scaleX: 1 - 0.4 * p, scaleY: 1 - 0.4 * p }) }, // 22 缩小消失
  slide_out_right: { exit: (p) => ({ ...IDENTITY, alpha: clamp01(1 - p * 1.6), dx: 120 * p }) }, // 23
  slide_out_left: { exit: (p) => ({ ...IDENTITY, alpha: clamp01(1 - p * 1.6), dx: -120 * p }) }, // 24
  slide_out_top: { exit: (p) => ({ ...IDENTITY, alpha: clamp01(1 - p * 1.6), dy: -120 * p }) }, // 25
  slide_out_bottom: { exit: (p) => ({ ...IDENTITY, alpha: clamp01(1 - p * 1.6), dy: 120 * p }) }, // 26
  rotate_out: { exit: (p) => ({ ...IDENTITY, alpha: 1 - p, rotate: -40 * p }) }, // 27 旋转消失
  rebound_out: { exit: (p) => ({ ...IDENTITY, alpha: clamp01(1 - p * 1.2), scaleX: easeOutBack(1 - p), scaleY: easeOutBack(1 - p) }) }, // 28 回弹消失
  bounce_out: { exit: (p) => ({ ...IDENTITY, alpha: clamp01(1 - p * 1.4), scaleX: (1 - p) + 0.12 * Math.sin((1 - p) * Math.PI * 3) * (1 - p), scaleY: (1 - p) + 0.12 * Math.sin((1 - p) * Math.PI * 3) * (1 - p) }) }, // 29 弹跳消失
  blur_out: { exit: (p) => ({ ...IDENTITY, alpha: 1 - p, scaleX: 1 + 0.05 * p, scaleY: 1 + 0.05 * p }) }, // 30 模糊消失(approx)
  dissolve_out: { exit: (p) => ({ ...IDENTITY, alpha: 0.2 + 0.8 * tri01(1 - p, 5) }) }, // 31 溶解消失(approx)
  fold_out: { exit: (p) => ({ ...IDENTITY, alpha: 1 - p, scaleY: 1 - p }) }, // 32 折叠
  fling_out: { exit: (p, mine) => ({ ...IDENTITY, alpha: clamp01(1 - p * 1.5), dx: (mine ? -320 : 320) * p, rotate: (mine ? -30 : 30) * p }) }, // 33 甩出
  ink_out: { exit: (p) => ({ ...IDENTITY, alpha: 1 - p, scaleX: 1 + 0.15 * p, scaleY: 1 + 0.15 * p }) }, // 34 水墨消失(approx)
  fade_shrink: { exit: (p) => ({ ...IDENTITY, alpha: 1 - p, scaleX: 1 - 0.3 * p, scaleY: 1 - 0.3 * p }) }, // 35 渐隐缩小

  // ---------------- 三、组合（10，enter+exit 或 含循环） ----------------
  clone: { enter: (p) => ({ ...IDENTITY, scaleX: easeOutBack(p), scaleY: easeOutBack(p) }), ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.03 * sin01(t, 1.4), scaleY: 1 + 0.03 * sin01(t, 1.4) }) }, // 36 分身(approx)
  funhouse: { ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.07 * sin01(t, 1.5), scaleY: 1 - 0.07 * sin01(t, 1.5), rotate: 1 * sin01(t, 1.3, 0.5) }) }, // 37 哈哈镜
  top_spin: { enter: (p) => ({ ...IDENTITY, alpha: clamp01(p * 1.5), rotate: (1 - p) * 360 }), ambient: (t) => ({ ...IDENTITY, rotate: (t * 220) % 360 }) }, // 38 小陀螺
  swing: { ambient: (t) => ({ ...IDENTITY, rotate: 12 * sin01(t, 1.0) }) }, // 39 荡秋千
  flip_flop: { ambient: (t) => ({ ...IDENTITY, rotate: (t * 200) % 360 }) }, // 40 翻翻转转
  slide_play: { enter: (p) => ({ ...IDENTITY, dy: 120 * (1 - p) }), exit: (p) => ({ ...IDENTITY, alpha: clamp01(1 - p * 1.6), dy: 120 * p }), ambient: (t) => ({ ...IDENTITY, dy: -2 * Math.abs(sin01(t, 2.5)) }) }, // 41 滑滑梯
  boing: { ambient: (t) => ({ ...IDENTITY, dy: -8 * Math.abs(sin01(t, 2.5)) }) }, // 42 弹弹乐
  sway: { ambient: (t) => ({ ...IDENTITY, rotate: 6 * sin01(t, 1.2) }) }, // 43 摇摆
  shake: { ambient: (t) => ({ ...IDENTITY, dx: 3 * sin01(t, 9), dy: 2 * sin01(t, 11, 0.25) }) }, // 44 抖动
  pulse: { ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.05 * sin01(t, 1.6), scaleY: 1 + 0.05 * sin01(t, 1.6) }) }, // 45 脉冲

  // ---------------- 四、循环（5，全程持续） ----------------
  zoom_loop: { ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.06 * sin01(t, 1.6), scaleY: 1 + 0.06 * sin01(t, 1.6) }) }, // 46 放大缩小
  sway_loop: { ambient: (t) => ({ ...IDENTITY, rotate: 7 * sin01(t, 1.2) }) }, // 47 摇摆循环
  rotate_loop: { ambient: (t) => ({ ...IDENTITY, rotate: (t * 180) % 360 }) }, // 48 旋转循环
  heartbeat: {
    ambient: (t) => {
      const f = 1.1
      const ph = (((t * f) % 1) + 1) % 1
      let b = 0
      if (ph < 0.12) b = Math.sin((ph / 0.12) * Math.PI)
      else if (ph > 0.22 && ph < 0.34) b = 0.7 * Math.sin(((ph - 0.22) / 0.12) * Math.PI)
      return { ...IDENTITY, scaleX: 1 + 0.09 * b, scaleY: 1 + 0.09 * b }
    },
  }, // 49 心跳
  micro_shake: { ambient: (t) => ({ ...IDENTITY, dx: 1.2 * sin01(t, 10), dy: 1 * sin01(t, 12, 0.3) }) }, // 50 轻微抖动

  // ---------------- 补充：文字字幕热门（部分，叠在气泡层也可复用） ----------------
  flicker: { ambient: (t) => ({ ...IDENTITY, alpha: 0.55 + 0.45 * Math.abs(sin01(t, 7)) }) }, // 闪烁
  glitch: { ambient: (t) => ({ ...IDENTITY, dx: (Math.sin(t * 23) > 0 ? 2 : -2) + 0.5 * sin01(t, 7), skewX: 1.2 * sin01(t, 13) }) }, // 故障(approx)
  wave: { ambient: (t) => ({ ...IDENTITY, skewY: 3 * sin01(t, 2.2), scaleY: 1 + 0.03 * sin01(t, 2.2, 0.2) }) }, // 波浪(approx)
  vibrate: { ambient: (t) => ({ ...IDENTITY, dx: 2 * sin01(t, 13), dy: 1.5 * sin01(t, 17, 0.4) }) },
  float: { ambient: (t) => ({ ...IDENTITY, dy: 4 * sin01(t, 1.6) }) },
  breathe: { ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.02 * sin01(t, 1.2), scaleY: 1 + 0.02 * sin01(t, 1.2) }) },
  bounce: { ambient: (t) => ({ ...IDENTITY, dy: -3 * Math.abs(sin01(t, 2)) }) },

  // ---------------- 五、真实滤镜（A1：ctx.filter 真出，不再近似） ----------------
  glow: { ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.02 * Math.sin(t * 4), scaleY: 1 + 0.02 * Math.sin(t * 4) }) }, // 金色辉光呼吸
  neon: { ambient: () => IDENTITY }, // 青色霓虹发光
  invert: { enter: ENTER_FADE }, // 负片闪现归位
  sepia: { enter: ENTER_FADE }, // 老照片闪现
  bloom: { ambient: () => IDENTITY }, // 高光脉冲呼吸
}

export function listEffectKinds() {
  return Object.keys(EFFECTS)
}
export function hasEffect(kind) {
  return !!EFFECTS[kind]
}
export function getEffect(kind) {
  return EFFECTS[kind] || null
}

// 计算某条消息在时间 t 的变换（合并 enter + ambient + exit）。
// win = { ds, de }；enterDur 默认 0.4s，exitDur 默认 0.35s。
// 若某 kind 只有 ambient 没有 enter，自动补柔和 fade 入场；没有 exit 则补默认淡出（带方向）。
export function evalEffect(kind, t, win, { enterDur = 0.4, exitDur = 0.35, mine = false, exitCenter = true } = {}) {
  const def = EFFECTS[kind] || EFFECTS.fade_in
  const ds = win?.ds || 0
  const de = win?.de || ds + 1
  const enterP = clamp01((t - ds) / enterDur)
  if (enterP < 1) {
    return (def.enter || ENTER_FADE)(enterP)
  }
  if (t > de) {
    const exitP = clamp01((t - de) / exitDur)
    return (def.exit || ((p) => DEFAULT_EXIT(p, mine, exitCenter)))(exitP, mine)
  }
  if (def.ambient) {
    return def.ambient(t)
  }
  return IDENTITY
}
