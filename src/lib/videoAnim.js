// 入场动画（浏览器端帧渲染用）：贴纸入场动画定义
// 纯逻辑模块，无 DOM 依赖
const EASE_OUT_BACK = (p) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}

// 情绪 → 贴纸动画（相邻不重复在调用方预分配）
export function emotionToAnim(emotion) {
  switch (emotion) {
    case 'happy':
      return 'pop'
    case 'surprise':
      return 'rotate'
    case 'angry':
      return 'shake'
    case 'sad':
      return 'fade'
    default:
      return 'slide'
  }
}

// 消息入场动画（effect → 样式），p = (t - display_start) / 0.4，clamp 0..1
export function entranceStyle(effect, p) {
  const q = Math.min(1, Math.max(0, p))
  switch (effect) {
    case 'pop_in': {
      const s = EASE_OUT_BACK(q)
      return { transform: `scale(${s})`, opacity: 1 }
    }
    case 'slide_in_left':
      return { transform: `translateX(${-120 * (1 - q)}px)`, opacity: 1 }
    case 'slide_in_right':
      return { transform: `translateX(${120 * (1 - q)}px)`, opacity: 1 }
    case 'fade_in':
    default:
      return { opacity: q }
  }
}

// 贴纸入场动画（anim → 样式），side: 'left'|'right'（slide 方向与消息同侧）
export function stickerStyle(anim, p, side) {
  const q = Math.min(1, Math.max(0, p))
  switch (anim) {
    case 'pop': {
      const s = EASE_OUT_BACK(q)
      return { transform: `scale(${s})`, opacity: 1 }
    }
    case 'rotate':
      return {
        transform: `rotate(${-15 * (1 - q)}deg) scale(${0.5 + 0.5 * q})`,
        opacity: 1,
      }
    case 'shake':
      return {
        transform: `translateX(${12 * Math.sin(q * 8 * Math.PI) * (1 - q)}px) scale(${1 + 0.1 * (1 - q)})`,
        opacity: 1,
      }
    case 'fade':
      return { opacity: q }
    case 'slide':
    default:
      return {
        transform: `translateX(${(side === 'right' ? 1 : -1) * 120 * (1 - q)}px)`,
        opacity: 1,
      }
  }
}