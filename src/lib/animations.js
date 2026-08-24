// animations.js —— 动效引擎（纯函数、数据驱动）
// 设计：一条动效 = enter（入场，瞬时） / ambient（显示期间循环） / exit（离场，瞬时）三套变换。
// 每个 effect 定义返回 { dx, dy, scaleX, scaleY, rotate, skewX, skewY, alpha }，
// 渲染层只负责把该变换 apply 到气泡/贴纸组，不再内联数学。
// 词表（kind 列表）仍由 effectsCatalog.js 作为唯一真相源；本文件只实现「给定 kind 如何变换」。

const TAU = Math.PI * 2

export const IDENTITY = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotate: 0, skewX: 0, skewY: 0, alpha: 1 }

const clamp01 = (x) => Math.min(1, Math.max(0, x))
function easeOutBack(p, c = 1.70158) {
  const c3 = c + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
}
function sin01(t, f, phase = 0) {
  return Math.sin((t * f + phase) * TAU)
}
// 0..1..0 三角波（用于心跳/呼吸的起落）
function tri01(t, f, phase = 0) {
  const x = (((t * f + phase) % 1) + 1) % 1
  return x < 0.5 ? x * 2 : 2 - x * 2
}

// 组合两个变换（a 先、b 叠加）：位移相加、缩放/旋转/透明度相乘
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

// ============ 动效注册表（kind → 定义） ============
// 所有数值必须有限（避免 NaN 黑屏）。ambient 用绝对时间 t 做循环，全部为确定性正弦，无随机。
const EFFECTS = {
  // ---------- 入场（瞬时，约 0.4s） ----------
  fade_in: { enter: ENTER_FADE },
  pop_in: { enter: (p) => ({ ...IDENTITY, scaleX: easeOutBack(p), scaleY: easeOutBack(p) }) },
  bounce_in: { enter: (p) => ({ ...IDENTITY, scaleX: easeOutBack(p, 2.4), scaleY: easeOutBack(p, 2.4) }) },
  slide_in_left: { enter: (p) => ({ ...IDENTITY, dx: -120 * (1 - p) }) },
  slide_in_right: { enter: (p) => ({ ...IDENTITY, dx: 120 * (1 - p) }) },
  slide_in_top: { enter: (p) => ({ ...IDENTITY, dy: -120 * (1 - p) }) },
  slide_in_bottom: { enter: (p) => ({ ...IDENTITY, dy: 120 * (1 - p) }) },
  zoom_in: { enter: (p) => ({ ...IDENTITY, alpha: clamp01(p * 1.5), scaleX: 0.7 + 0.3 * easeOutBack(p), scaleY: 0.7 + 0.3 * easeOutBack(p) }) },
  flip_in: { enter: (p) => ({ ...IDENTITY, alpha: clamp01(p * 1.5), scaleX: 0.9 + 0.1 * p, rotate: (1 - p) * 40 }) },
  drop_in: { enter: (p) => ({ ...IDENTITY, dy: -160 * (1 - easeOutBack(p)), alpha: clamp01(p * 1.5) }) },
  spin_in: { enter: (p) => ({ ...IDENTITY, rotate: (1 - p) * 360, alpha: clamp01(p * 1.5) }) },

  // ---------- 环境/循环（显示期间持续） ----------
  pulse: { ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.05 * sin01(t, 1.6), scaleY: 1 + 0.05 * sin01(t, 1.6) }) },
  heartbeat: {
    ambient: (t) => {
      const f = 1.1
      const ph = (((t * f) % 1) + 1) % 1
      let b = 0
      if (ph < 0.12) b = Math.sin((ph / 0.12) * Math.PI)
      else if (ph > 0.22 && ph < 0.34) b = 0.7 * Math.sin(((ph - 0.22) / 0.12) * Math.PI)
      return { ...IDENTITY, scaleX: 1 + 0.09 * b, scaleY: 1 + 0.09 * b }
    },
  },
  sway: { ambient: (t) => ({ ...IDENTITY, rotate: 6 * sin01(t, 1.2) }) },
  swing: { ambient: (t) => ({ ...IDENTITY, rotate: 9 * tri01(t, 0.8) }) },
  wobble: { ambient: (t) => ({ ...IDENTITY, dx: 1.5 * sin01(t, 2), dy: 1 * sin01(t, 2.5, 0.3), rotate: 1.2 * sin01(t, 1.5) }) },
  breathe: { ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.02 * sin01(t, 1.2), scaleY: 1 + 0.02 * sin01(t, 1.2) }) },
  float: { ambient: (t) => ({ ...IDENTITY, dy: 4 * sin01(t, 1.6) }) },
  bounce: { ambient: (t) => ({ ...IDENTITY, dy: -3 * Math.abs(sin01(t, 2)) }) },
  flicker: { ambient: (t) => ({ ...IDENTITY, alpha: 0.55 + 0.45 * Math.abs(sin01(t, 7)) }) },
  blink: { ambient: (t) => ({ ...IDENTITY, alpha: Math.sin((t * 3) * TAU) > 0 ? 1 : 0.3 }) },
  // 抖动 / 震动：高频小幅位移（确定性）
  shake: { ambient: (t) => ({ ...IDENTITY, dx: 3 * sin01(t, 9), dy: 2 * sin01(t, 11, 0.25) }) },
  vibrate: { ambient: (t) => ({ ...IDENTITY, dx: 2 * sin01(t, 13), dy: 1.5 * sin01(t, 17, 0.4) }) },
  // 故障（近似）：水平抖动 + 轻微错切，真·像素级 RGB 分离留待 C 轮
  glitch: { ambient: (t) => ({ ...IDENTITY, dx: (Math.sin(t * 23) > 0 ? 2 : -2) + 0.5 * sin01(t, 7), skewX: 1.2 * sin01(t, 13) }) },
  // 波浪（近似）：按时间做轻微错切+纵向挤压，模拟波动
  wave: { ambient: (t) => ({ ...IDENTITY, skewY: 3 * sin01(t, 2.2), scaleY: 1 + 0.03 * sin01(t, 2.2, 0.2) }) },
  // 哈哈镜（近似）：横向拉伸/纵向压缩交替
  funhouse: { ambient: (t) => ({ ...IDENTITY, scaleX: 1 + 0.06 * sin01(t, 1.5), scaleY: 1 - 0.06 * sin01(t, 1.5), rotate: 1 * sin01(t, 1.3, 0.5) }) },
  // 闪光灯（频闪）：透明度周期跳变
  strobe: { ambient: (t) => ({ ...IDENTITY, alpha: Math.floor(t * 5) % 2 === 0 ? 1 : 0.4 }) },
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

// 计算某条消息在时间 t 的变换（合并 enter + ambient）。
// win = { ds, de }（该消息的显示时间窗）；enterDur 默认 0.4s。
// 若某 kind 只有 ambient 没有 enter，则自动补一个柔和 fade 入场，避免“凭空出现”。
export function evalEffect(kind, t, win, { enterDur = 0.4 } = {}) {
  const def = EFFECTS[kind] || EFFECTS.fade_in
  const ds = win?.ds || 0
  const de = win?.de || ds + 1
  const enterP = clamp01((t - ds) / enterDur)
  let tr = IDENTITY
  const enter = def.enter || ENTER_FADE
  if (enterP < 1) {
    tr = enter(enterP)
  }
  if (def.ambient && enterP >= 1 && t <= de) {
    tr = compose(tr, def.ambient(t))
  }
  return tr
}
