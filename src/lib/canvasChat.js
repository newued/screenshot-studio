// Canvas 聊天帧渲染器（替代 html2canvas 逐帧截图）
// 直接绘制消息气泡/头像/红包/转账/语音/贴纸/标题栏到 1080×1920 canvas，
// 支持入场动画（pop/slide/fade）与消息间交叉淡化转场，无需 DOM 截图。
// 纯逻辑 + Canvas 2D，无 DOM 依赖。
import { avatarFor, genMemberAvatar, genMemberColor, avatarInitial } from './avatars.js'
import { deriveChatTitle } from './chatTitle.js'

// 贴纸路径解析：库在 /emojis/imgs/ 下；message.sticker 可能带纯文件名、imgs/ 前缀或完整 /emojis 路径
function resolveStickerUrl(file) {
  if (!file) return file
  if (file.startsWith('http')) return file
  if (file.startsWith('/emojis/')) return file
  const base = file.startsWith('imgs/') ? file : `imgs/${file}`
  return `/emojis/${base}`
}

const W = 1080
const H = 1920
const TITLE_H = 120 // 标题栏高度（与视频渲染输出一致）
const PAD_X = 60
const PAD_TOP = 30
const MSG_GAP = 14
const AVATAR = 100
const AVATAR_GAP = 16
const BUBBLE_PAD_X = 20
const BUBBLE_PAD_Y = 16
const FONT_SIZE = 30
const LINE_H = Math.round(FONT_SIZE * 1.4)
// 气泡最大宽度 ~80% 舞台宽，头像同步放大，整体像“单条聊天截图”
const BUBBLE_MAX_W = 800
const STAGE_Y_RATIO = 0.58
const NAME_H = 30
const FONT_STACK = '"PingFang SC", "Microsoft YaHei", sans-serif'

// 平台配色（与 global.css 对齐）
const PLATFORM = {
  wechat: { bg: '#ededed', mineBubble: '#95ec69', bubbleRadius: 6, tail: '#95ec69', redpacket: ['#fa9d3b', '#f08519'], transfer: '#fa9d3b', nav: '#f7f7f7' },
  qq: { bg: '#ece3d7', mineBubble: '#12b7f5', bubbleRadius: 8, tail: '#12b7f5', redpacket: ['#ff5b5b', '#e23b3b'], transfer: '#12b7f5', nav: '#12b7f5' },
  alipay: { bg: '#f5f5f5', mineBubble: '#1677ff', bubbleRadius: 6, tail: '#1677ff', redpacket: ['#ff5b5b', '#e23b3b'], transfer: '#1677ff', nav: '#1677ff' },
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x))
}

// 按 speaker 匹配 members：优先 name 精确匹配；其次按 'A'/'B'/... 字母序对应 members 索引
// （脚本用 A/B 命名，而 members 可能叫「我/对方」，两种都要兼容）
function memberOf(members, speaker) {
  if (!members || !speaker) return null
  const exact = members.find((m) => m && m.name === speaker)
  if (exact) return exact
  const ch = String(speaker).trim().toUpperCase()
  if (/^[A-Z]$/.test(ch)) {
    const idx = ch.charCodeAt(0) - 65
    if (members[idx]) return members[idx]
  }
  return members[0] || null
}

// 情绪 → 贴纸动画（相邻不重复由调用方处理）
export function emotionToAnim(emotion) {
  switch (emotion) {
    case 'happy': return 'pop'
    case 'surprise': return 'rotate'
    case 'angry': return 'shake'
    case 'sad': return 'fade'
    default: return 'slide'
  }
}

// 缓动：easeOutBack（pop 弹跳），与 CSS 侧一致；c 越大回弹越夸张
function easeOutBack(p, c = 1.70158) {
  const c3 = c + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
}

// 稳定 hash / 随机（按 seed 复现，同名/同 index 同结果）
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
function rng2(seed) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

// 入场风格池（按说话人左右偏好分流）
const ENTER_LEFT = ['slide_in_left', 'slide_in_top', 'pop_in', 'fade_in', 'zoom_in', 'flip_in', 'bounce_in']
const ENTER_RIGHT = ['slide_in_right', 'slide_in_top', 'pop_in', 'fade_in', 'zoom_in', 'flip_in', 'bounce_in']
const ENTER_SET = new Set([...ENTER_LEFT, 'slide_in_bottom'])
function pickEntrance(msg, i, mine) {
  const e = msg.effect
  if (e && ENTER_SET.has(e)) return e
  const r = rng2(hashStr('eff' + i))()
  const pool = mine ? ENTER_RIGHT : ENTER_LEFT
  return pool[Math.floor(r * pool.length)]
}

// 到位后的随机 idle 微动（增强画面丰富性）
const IDLE_STYLES = ['float', 'breathe', 'wobble', 'bounce', 'none']
function idleTransform(i, age) {
  if (age < 0) age = 0
  const style = IDLE_STYLES[hashStr('idle' + i) % IDLE_STYLES.length]
  const ph = (hashStr('ph' + i) % 1000) / 1000 * Math.PI * 2
  switch (style) {
    case 'float': return { dx: 0, dy: 3 * Math.sin(age * 1.6 + ph), scale: 1, rotate: 0 }
    case 'breathe': return { dx: 0, dy: 0, scale: 1 + 0.02 * Math.sin(age * 1.2 + ph), rotate: 0 }
    case 'wobble': return { dx: 1.5 * Math.sin(age * 2 + ph), dy: 0, scale: 1, rotate: 1.2 * Math.sin(age * 1.5 + ph) }
    case 'bounce': return { dx: 0, dy: -2 * Math.abs(Math.sin(age * 2 + ph)), scale: 1, rotate: 0 }
    default: return { dx: 0, dy: 0, scale: 1, rotate: 0 }
  }
}

// 入场动画进度：返回 { alpha, dx, dy, scale, rotate }
// p = (t - ds) / 0.4，clamp 0..1；转场淡化由外部 alpha 处理
function entranceProgress(effect, p) {
  const q = clamp01(p)
  switch (effect) {
    case 'pop_in': return { alpha: 1, dx: 0, dy: 0, scale: easeOutBack(q), rotate: 0 }
    case 'bounce_in': return { alpha: 1, dx: 0, dy: 0, scale: easeOutBack(q, 2.4), rotate: 0 }
    case 'slide_in_left': return { alpha: 1, dx: -120 * (1 - q), dy: 0, scale: 1, rotate: 0 }
    case 'slide_in_right': return { alpha: 1, dx: 120 * (1 - q), dy: 0, scale: 1, rotate: 0 }
    case 'slide_in_top': return { alpha: 1, dx: 0, dy: -120 * (1 - q), scale: 1, rotate: 0 }
    case 'slide_in_bottom': return { alpha: 1, dx: 0, dy: 120 * (1 - q), scale: 1, rotate: 0 }
    case 'zoom_in': return { alpha: clamp01(q * 1.5), dx: 0, dy: 0, scale: 0.7 + 0.3 * easeOutBack(q), rotate: 0 }
    case 'flip_in': return { alpha: clamp01(q * 1.5), dx: 0, dy: 0, scale: 0.9 + 0.1 * q, rotate: (1 - q) * 40 }
    case 'fade_in':
    default: return { alpha: q, dx: 0, dy: 0, scale: 1, rotate: 0 }
  }
}

// 贴纸动画进度：返回 { alpha, dx, dy, scale, rotate }
function stickerProgress(anim, p, side) {
  const q = clamp01(p)
  switch (anim) {
    case 'pop': return { alpha: 1, dx: 0, dy: 0, scale: easeOutBack(q), rotate: 0 }
    case 'rotate': return { alpha: 1, dx: 0, dy: 0, scale: 0.5 + 0.5 * q, rotate: -15 * (1 - q) }
    case 'shake': return { alpha: 1, dx: 12 * Math.sin(q * 8 * Math.PI) * (1 - q), dy: 0, scale: 1 + 0.1 * (1 - q), rotate: 0 }
    case 'fade': return { alpha: q, dx: 0, dy: 0, scale: 1, rotate: 0 }
    case 'slide':
    default: return { alpha: 1, dx: (side === 'right' ? 1 : -1) * 120 * (1 - q), dy: 0, scale: 1, rotate: 0 }
  }
}

// ---------- 图片资源缓存 ----------
const imgCache = new Map()
// 标记"正在加载中"的 URL，避免并发重复创建 Image
const imgLoading = new Set()

// 图片尺寸兼容：浏览器 Image 用 naturalWidth/Height，@napi-rs/canvas 用 width/height
function imgW(img) {
  return img.naturalWidth || img.width || 0
}
function imgH(img) {
  return img.naturalHeight || img.height || 0
}

// 默认图片加载器（浏览器）：new Image() + CORS 处理
function defaultLoadImage(url) {
  return new Promise((resolve) => {
    const img = new Image()
    // 跨域判断：仅 http(s) 且 host 与当前页面不同才设 crossOrigin
    const sameOrigin = (u) => {
      if (u.startsWith('/') || u.startsWith('data:')) return true
      try {
        const h = new URL(u, window.location.href)
        return h.origin === window.location.origin
      } catch {
        return false
      }
    }
    if (!sameOrigin(url)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// 默认资源解析（浏览器）：由 dev server 直接服务 /icons /emojis /avatars
function defaultResolveAsset(url) {
  return url
}

function cachedImg(u) {
  return imgCache.get(u) || null
}

// ---------- 文本换行 ----------
function wrapText(ctx, text, maxW) {
  const lines = []
  let cur = ''
  for (const ch of String(text)) {
    if (ch === '\n') {
      lines.push(cur)
      cur = ''
      continue
    }
    const test = cur + ch
    if (cur && ctx.measureText(test).width > maxW) {
      lines.push(cur)
      cur = ch
    } else {
      cur = test
    }
  }
  if (cur !== '' || lines.length === 0) lines.push(cur)
  return lines
}

// ---------- 布局计算（按消息类型测量尺寸） ----------
function measureMessage(ctx, m, members, platform, showName) {
  const mine = m.speaker === 'A'
  const hasName = showName && !mine
  let w = 0
  let h = 0
  const lines = []
  const type = m.type

  if (type === 'time' || type === 'system') {
    return { w: 0, h: 25, lines, mine, hasName }
  }

  if (type === 'redpacket' || type === 'redpacketRecv') {
    w = 230
    h = 42 + 12 + 25 // icon(40) + padding + bottom
    return { w, h, lines, mine, hasName }
  }
  if (type === 'transfer' || type === 'transferRecv') {
    w = 230
    h = 36 + 14 + 25 // icon(36) + padding + bottom
    return { w, h, lines, mine, hasName }
  }
  if (type === 'voice') {
    w = Math.max(90, ctx.measureText(String(m.duration || '')).width + 18 + 12 + 24)
    h = 40
    return { w, h, lines, mine, hasName }
  }
  if (type === 'voiceText') {
    ctx.font = `${FONT_SIZE}px ${FONT_STACK}`
    const inner = wrapText(ctx, m.content || '', BUBBLE_MAX_W - 24)
    const textW = Math.max(...inner.map((l) => ctx.measureText(l).width), 60)
    w = Math.min(BUBBLE_MAX_W, textW + 24)
    h = 26 + inner.length * Math.round(14 * 1.4) + 16 // label + body + padding
    return { w, h, lines: inner, mine, hasName }
  }
  if (type === 'videoAnswered' || type === 'videoMissed') {
    ctx.font = `16px ${FONT_STACK}`
    const txt = m.type === 'videoMissed' ? '视频通话未接通' : `视频通话 ${m.duration || '00:00'}`
    const inner = wrapText(ctx, txt, BUBBLE_MAX_W - 24 - 22)
    w = Math.min(BUBBLE_MAX_W, Math.max(...inner.map((l) => ctx.measureText(l).width)) + 24 + 22)
    h = 20 + inner.length * Math.round(16 * 1.4)
    return { w, h, lines: inner, mine, hasName }
  }

  // 默认文本气泡
  ctx.font = `${FONT_SIZE}px ${FONT_STACK}`
  const inner = wrapText(ctx, m.content || '', BUBBLE_MAX_W - BUBBLE_PAD_X * 2)
  const textW = Math.max(...inner.map((l) => ctx.measureText(l).width), 20)
  w = Math.min(BUBBLE_MAX_W, textW + BUBBLE_PAD_X * 2)
  h = inner.length * LINE_H + BUBBLE_PAD_Y * 2
  return { w, h, lines: inner, mine, hasName }
}

// ---------- 绘制工具 ----------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawAvatar(ctx, x, y, size, member, fallbackName) {
  const name = (member && (member.name || member.speaker)) || fallbackName || '?'
  // 真实头像（预设库 /avatars/*.jpg、用户上传 dataURL、在线地址）优先走图片；
  // 仅在图片加载失败（无可用图）时降级为彩色圆角方块 + 白色首字。
  const raw = member && member.avatar
  const useImg = raw && cachedImg(raw)
  if (useImg) {
    ctx.save()
    roundRect(ctx, x, y, size, size, Math.round(size * 0.16))
    ctx.clip()
    ctx.drawImage(useImg, x, y, size, size)
    ctx.restore()
    return
  }
  // 兜底：无可用图片时，彩色圆角方块 + 白色首字
  ctx.save()
  roundRect(ctx, x, y, size, size, 4)
  ctx.fillStyle = genMemberColor(name)
  ctx.fill()
  ctx.clip()
  ctx.fillStyle = '#fff'
  ctx.font = `600 ${Math.round(size * 0.5)}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(avatarInitial(name), x + size / 2, y + size / 2 + 1)
  ctx.restore()
}

function drawBubbleTail(ctx, x, y, color, mine) {
  // 匹配网页 SVG polygon "0,0 5,4 0,8"：5×8px 的 > 三角形
  // x = 气泡对应边 x；y = 尾巴中心 y（CSS top:8px + h/2 = bubbleY+12）
  const tw = 5, th = 8
  ctx.fillStyle = color
  ctx.beginPath()
  if (mine) {
    // 右侧气泡：base 在气泡右边缘(x)，tip 在 x+tw（朝头像）
    ctx.moveTo(x, y - th / 2)     // (0,0) → base top
    ctx.lineTo(x, y + th / 2)     // (0,8) → base bottom
    ctx.lineTo(x + tw, y)          // (5,4) → tip
  } else {
    // 左侧气泡：base 在 x-tw（朝头像），tip 在气泡左边缘(x)
    ctx.moveTo(x - tw, y - th / 2) // → base top
    ctx.lineTo(x - tw, y + th / 2) // → base bottom
    ctx.lineTo(x, y)                // → tip
  }
  ctx.closePath()
  ctx.fill()
}

// 文本换行绘制（支持多行、垂直居中）
function drawWrappedText(ctx, text, x, y, maxW, lineH, align = 'left') {
  const lines = wrapText(ctx, text, maxW)
  lines.forEach((line, i) => {
    if (align === 'center') ctx.fillText(line, x + maxW / 2 - ctx.measureText(line).width / 2, y + i * lineH)
    else if (align === 'right') ctx.fillText(line, x + maxW - ctx.measureText(line).width, y + i * lineH)
    else ctx.fillText(line, x, y + i * lineH)
  })
}

// ---------- 单条消息绘制 ----------
function drawMessage(ctx, m, lay, members, platform, showName, iconRedpacket, iconVoice) {
  const { x, y, w, h, lines, mine, hasName } = lay
  const member = memberOf(members, m.speaker)
  const name = (member && member.name) || m.speaker || '?'
  const p = PLATFORM[platform] || PLATFORM.wechat

  // 名字（群聊对方 / 居中模式显示发言人）：位于气泡上方
  if (hasName || lay.centered) {
    ctx.fillStyle = '#b1b1b1'
    ctx.font = `12px ${FONT_STACK}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(name, x, y - 4)
  }

  // 头像：居中模式画在气泡左侧（与气泡构成整体，已在 computeLayout 中定位）；否则微信左右分边
  const badgeSize = AVATAR
  const avAtX = lay.centered ? (lay.avX != null ? lay.avX : x - AVATAR - AVATAR_GAP) : (mine ? x + w + AVATAR_GAP : x - AVATAR - AVATAR_GAP)
  drawAvatar(ctx, avAtX, y, badgeSize, member, name)

  // 消息主体（气泡/卡片）
  const type = m.type
  if (type === 'time' || type === 'system') {
    ctx.fillStyle = '#b2b2b2'
    ctx.font = `12px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.fillText(m.content || '', W / 2, y + 16)
    ctx.textAlign = 'left'
    return
  }

  // 气泡矩形（供各类复用）；名字在气泡上方，气泡下移
  const bubbleX = x
  const bubbleY = y + (hasName ? NAME_H : 0)

  if (type === 'redpacket' || type === 'redpacketRecv') {
    const recv = type === 'redpacketRecv'
    const grad = ctx.createLinearGradient(0, bubbleY, 0, bubbleY + 79)
    grad.addColorStop(0, p.redpacket[0])
    grad.addColorStop(1, p.redpacket[1])
    ctx.fillStyle = grad
    roundRect(ctx, bubbleX, bubbleY, w, h, 6)
    ctx.fill()
    // 红包图标（真实 SVG）
    const rpIcon = cachedImg(iconRedpacket)
    if (rpIcon) {
      ctx.save()
      roundRect(ctx, bubbleX + 12, bubbleY + 10, 36, 40, 5)
      ctx.clip()
      ctx.drawImage(rpIcon, bubbleX + 12, bubbleY + 10, 36, 40)
      ctx.restore()
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.92)'
      roundRect(ctx, bubbleX + 12, bubbleY + 10, 36, 40, 5)
      ctx.fill()
    }
    ctx.fillStyle = '#fff'
    ctx.font = '500 15px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(m.content || '恭喜发财', bubbleX + 60, bubbleY + 26)
    ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText('已领取', bubbleX + 60, bubbleY + 43)
    ctx.globalAlpha *= 0.9
    ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(recv ? '已领取' : platform === 'alipay' ? '支付宝红包' : platform === 'qq' ? 'QQ红包' : '微信红包', bubbleX + 12, bubbleY + h - 11)
    ctx.globalAlpha /= 0.9
    return
  }

  if (type === 'transfer' || type === 'transferRecv') {
    const recv = type === 'transferRecv'
    ctx.fillStyle = p.transfer
    roundRect(ctx, bubbleX, bubbleY, w, h, 6)
    ctx.fill()
    // ¥ 圆标
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(bubbleX + 12 + 18, bubbleY + 10 + 18, 18, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = '700 18px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('¥', bubbleX + 12 + 18, bubbleY + 10 + 18 + 6)
    ctx.textAlign = 'left'
    ctx.font = '500 15px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(`¥${m.amount || ''}`, bubbleX + 60, bubbleY + 30)
    if (m.note) {
      ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.globalAlpha *= 0.9
      ctx.fillText(m.note, bubbleX + 60, bubbleY + 47)
      ctx.globalAlpha /= 0.9
    }
    ctx.globalAlpha *= 0.92
    ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillText(recv ? '已收款' : '转账', bubbleX + 12, bubbleY + h - 11)
    ctx.globalAlpha /= 0.92
    return
  }

  if (type === 'voice') {
    ctx.fillStyle = mine ? p.mineBubble : '#fff'
    roundRect(ctx, bubbleX, bubbleY, w, h, p.bubbleRadius)
    ctx.fill()
    drawBubbleTail(ctx, mine ? bubbleX + w : bubbleX, bubbleY + 12, mine ? p.tail : '#fff', mine)
    // 语音图标（真实 SVG）
    const vIcon = cachedImg(iconVoice)
    const iconX = mine ? bubbleX + 16 : bubbleX + 16
    ctx.save()
    if (mine) {
      // 自己的语音条图标上下翻转（与 CSS .voice-icon 的 scaleY(-1) 一致）
      ctx.translate(iconX + 9, bubbleY + 20)
      ctx.scale(1, -1)
      ctx.translate(-(iconX + 9), -(bubbleY + 20))
    }
    if (vIcon) ctx.drawImage(vIcon, iconX, bubbleY + 11, 18, 18)
    else {
      ctx.fillStyle = '#191919'
      for (let i = 0; i < 3; i++) {
        const bh = [8, 14, 10][i]
        roundRect(ctx, iconX + i * 8, bubbleY + (20 - bh) / 2, 5, bh, 2.5)
        ctx.fill()
      }
    }
    ctx.restore()
    ctx.font = `17px ${FONT_STACK}`
    ctx.fillStyle = '#191919'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(m.duration || ''), mine ? bubbleX + w - 40 : bubbleX + 46, bubbleY + 21)
    return
  }

  if (type === 'voiceText') {
    ctx.fillStyle = mine ? p.mineBubble : '#fff'
    roundRect(ctx, bubbleX, bubbleY, w, h, p.bubbleRadius)
    ctx.fill()
    drawBubbleTail(ctx, mine ? bubbleX + w : bubbleX, bubbleY + 12, mine ? p.tail : '#fff', mine)
    // 语音转文字卡片
    const cardY = bubbleY + 10
    ctx.fillStyle = 'rgba(0,0,0,.04)'
    roundRect(ctx, bubbleX + 12, cardY, w - 24, h - 20, 4)
    ctx.fill()
    ctx.fillStyle = '#888'
    ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('语音转文字', bubbleX + 22, cardY + 15)
    ctx.fillStyle = '#191919'
    ctx.font = '14px "PingFang SC", "Microsoft YaHei", sans-serif'
    lines.forEach((line, i) => ctx.fillText(line, bubbleX + 22, cardY + 32 + i * Math.round(14 * 1.4)))
    return
  }

  if (type === 'videoAnswered' || type === 'videoMissed') {
    ctx.fillStyle = mine ? p.mineBubble : '#fff'
    roundRect(ctx, bubbleX, bubbleY, w, h, p.bubbleRadius)
    ctx.fill()
    drawBubbleTail(ctx, mine ? bubbleX + w : bubbleX, bubbleY + 12, mine ? p.tail : '#fff', mine)
    const missed = type === 'videoMissed'
    ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.fillStyle = '#191919'
    ctx.textBaseline = 'middle'
    ctx.fillText('📹', bubbleX + 12, bubbleY + h / 2)
    ctx.textAlign = 'left'
    const txt = missed ? '视频通话未接通' : `视频通话 ${m.duration || '00:00'}`
    ctx.fillText(txt, bubbleX + 34, bubbleY + h / 2)
    return
  }

  // 文本气泡
  ctx.fillStyle = mine ? p.mineBubble : '#fff'
  roundRect(ctx, bubbleX, bubbleY, w, h, p.bubbleRadius)
  ctx.fill()
  drawBubbleTail(ctx, mine ? bubbleX + w : bubbleX, bubbleY + 12, mine ? p.tail : '#fff', mine)
  ctx.fillStyle = '#191919'
  ctx.font = `${FONT_SIZE}px ${FONT_STACK}`
  ctx.textBaseline = 'alphabetic'
  lines.forEach((line, i) => ctx.fillText(line, bubbleX + BUBBLE_PAD_X, bubbleY + BUBBLE_PAD_Y + (i + 1) * LINE_H - 5))
}

// ---------- 贴纸绘制 ----------
function drawSticker(ctx, file, x, y, maxW, maxH, anim, side, progress) {
  const url = resolveStickerUrl(file)
  const img = cachedImg(url)
  if (!img) return
  // 允许放大以填满贴纸带（不再受源图尺寸限制）；contain 适配，超出部分留白不裁剪
  const scale = Math.min(maxW / imgW(img), maxH / imgH(img))
  const iw = imgW(img) * scale
  const ih = imgH(img) * scale
  const sp = stickerProgress(anim, progress, side)
  ctx.save()
  ctx.globalAlpha *= sp.alpha
  ctx.translate(x + maxW / 2 + sp.dx, y + maxH / 2 + sp.dy)
  ctx.rotate((sp.rotate * Math.PI) / 180)
  ctx.scale(sp.scale, sp.scale)
  // 圆角裁剪
  roundRect(ctx, -iw / 2, -ih / 2, iw, ih, 20)
  ctx.clip()
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih)
  ctx.restore()
}

// ---------- 主渲染器 ----------
// 返回 { render(t) → canvas, invalidate() }；数据变化时调用 invalidate 重算布局
export function createChatFrameRenderer({
  width = W,
  height = H,
  title = '',
  project = {},
  canvas: extCanvas = null,
  ctx: extCtx = null,
  loadImage: extLoadImage = null,
  resolveAsset: extResolveAsset = null,
} = {}) {
  // 画布可外部注入（Node/@napi-rs/canvas 无 DOM 时使用）；默认浏览器自建
  const canvas = extCanvas || document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = extCtx || canvas.getContext('2d')

  // 图片加载器 / 资源解析器：浏览器用默认，Node 注入（@napi-rs/canvas.loadImage + 本地路径解析）
  const loadImage = extLoadImage || defaultLoadImage
  const resolveAsset = extResolveAsset || defaultResolveAsset

  // 图标资源（红包/语音）：经 resolveAsset 解析为可加载路径
  const ICON_REDPACKET = resolveAsset('/icons/hongbao2x.svg')
  const ICON_VOICE = resolveAsset('/icons/yinpin.svg')

  // 预加载图片列表，返回 Promise（缓存按原始 url，内部按 resolveAsset 路径加载）
  function preloadImages(urls) {
    const need = [...new Set(urls.filter(Boolean))]
    const missing = need.filter((u) => !imgCache.has(u) && !imgLoading.has(u))
    if (missing.length === 0) return Promise.resolve()
    const loadOne = (u) =>
      new Promise((resolve) => {
        imgLoading.add(u)
        loadImage(resolveAsset(u))
          .then((img) => {
            imgCache.set(u, img)
            imgLoading.delete(u)
            resolve()
          })
          .catch(() => {
            imgCache.set(u, null)
            imgLoading.delete(u)
            resolve()
          })
      })
    return Promise.all(missing.map(loadOne))
  }

  // 预加载常规图标（红包/语音）
  function preloadIcons() {
    return preloadImages([ICON_REDPACKET, ICON_VOICE])
  }

  let layout = null // 缓存：布局 { items: [{msg, x, y, w, h, lines, mine, hasName, timing}], title }
  let cacheKey = ''

  function computeLayout(messages, members, platform, showName, centered) {
    const items = []
    let y = PAD_TOP
    messages.forEach((m, i) => {
      const lay = measureMessage(ctx, m, members, platform, showName)
      const mine = m.speaker === 'A'
      // 居中切片模式：始终显示说话者名字（上方），并把名字高度计入布局
      if (centered && !lay.hasName) {
        lay.hasName = true
        lay.h += NAME_H
      }
      let avX = null, avY = null
      if (centered) {
        // 头像(左) + 间距 + 气泡 作为一个整体水平居中
        const groupW = AVATAR + AVATAR_GAP + lay.w
        const groupLeft = Math.round((width - groupW) / 2)
        avX = groupLeft
        lay.x = groupLeft + AVATAR + AVATAR_GAP
      } else {
        // 非 mine 消息需要给头像留出左侧空间（头像 + 间距），否则头像会画到画布外
        lay.x = mine ? width - PAD_X - AVATAR - AVATAR_GAP - lay.w : PAD_X + AVATAR + AVATAR_GAP
      }
      lay.y = y
      lay.msg = m
      lay.i = i
      lay.avX = avX
      lay.avY = avY
      lay.mine = mine
      lay.centered = centered
      items.push(lay)
      y += lay.h + MSG_GAP
    })
    return { items, total: y }
  }

  function invalidate() {
    cacheKey = ''
  }

  // 预加载消息相关资源（头像/贴纸/语音图标）
  function preload(messages, members) {
    const urls = []
    members.forEach((m) => {
      if (m && m.avatar) urls.push(m.avatar)
    })
    messages.forEach((m) => {
      if (m.speaker) {
        const member = memberOf(members, m.speaker)
        // 用 genMemberAvatar：手动 avatar 优先，否则基于 name 稳定随机生成（同名单色/渐变/emoji）
        const av = (member && (member.avatar || member.name)) ? genMemberAvatar(member) : avatarFor(m.speaker)
        if (!member || !member.avatar) urls.push(av)
      }
      if (m.sticker) urls.push(resolveStickerUrl(m.sticker))
    })
    return Promise.all([preloadIcons(), preloadImages(urls)])
  }

  // 派生每条消息的时间窗：优先 timing[i].ds/de；其次 mapping 风格 start/end；
  // 再退化为链式衔接（用下一条的 ds 当本条 de，末条到视频结尾）。
  function deriveTiming(messages, timing, duration) {
    const n = messages.length
    const arr = messages.map((m, i) => {
      const tl = timing ? timing[i] : null
      const ds = tl ? (Number(tl.ds ?? tl.display_start ?? tl.start) || 0) : 0
      const de = tl ? (Number(tl.de ?? tl.display_end ?? tl.end) || 0) : 0
      return { ds, de }
    })
    for (let i = 0; i < n; i++) {
      if (arr[i].ds === 0 && arr[i].de === 0 && timing && timing[i]) {
        const s = Number(timing[i].start)
        const e = Number(timing[i].end)
        if (!Number.isNaN(s) && s > 0) { arr[i].ds = s; if (!Number.isNaN(e) && e > 0) arr[i].de = e }
      }
      if (arr[i].de <= arr[i].ds) {
        const next = i + 1 < n ? arr[i + 1].ds : (duration || 0)
        arr[i].de = next > arr[i].ds ? next : (duration || arr[i].ds + 3)
      }
    }
    return arr
  }

  // 标题栏显示条件：开场（首条登场前）直到首条出现后短暂保留，之后隐藏
  function items0VisibleAt(t, arr, dur) {
    if (!arr.length) return false
    const i0 = arr[0]
    // 从 0 到首条登场后 0.6s 显示标题（开场灰条 + 首条），之后隐藏
    return t <= i0.ds + 0.6
  }

  function render(t, { messages, members, platform = 'wechat', mode = 'single', title: ttl = title, groupName = '', timing = null, duration = 0, centered = false, showAll = false } = {}) {
    const showName = mode === 'group'
    const p = PLATFORM[platform] || PLATFORM.wechat
    const timingArr = deriveTiming(messages, timing, duration)
    const items = layout ? layout.items : []

    // 布局缓存（messages 变化时重算；centered 不再使用，统一微信左右分边）
    if (!layout || cacheKey !== `${messages}`) {
      layout = computeLayout(messages, members, platform, showName, false)
      cacheKey = `${messages}`
    }

    // 清屏 + 纯黑舞台背景
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)

    // ---- 标题栏：仅“第一条消息”可见时（与首条同现同隐，像截图把标题一起截进去） ----
    // 顶栏标题强制按规则派生：单聊=对方昵称/备注，群聊=群名称（见 deriveChatTitle）。
    // 旧的硬编码默认值 '聊天记录视频' 一律被派生结果覆盖，确保与网页编辑同步。
    const effTitle = ttl && ttl !== '聊天记录视频' ? ttl : deriveChatTitle(mode, members, groupName)
    const firstInfo = timingArr[0]
    const firstVisible = (!showAll) && firstInfo && t >= (firstInfo.ds - 0.25) && t <= (firstInfo.de + 0.25)
    if (firstVisible && (effTitle || mode === 'group')) {
      ctx.save()
      ctx.fillStyle = '#f7f7f7'
      ctx.fillRect(0, 0, width, TITLE_H)
      ctx.fillStyle = '#e0e0e0'
      ctx.fillRect(0, TITLE_H - 1, width, 1)
      ctx.fillStyle = '#222'
      ctx.font = '600 48px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      const showCount = mode === 'group' && members ? ` (${members.length})` : ''
      ctx.fillText(`${effTitle || '微信对话'}${showCount}`, width / 2, TITLE_H / 2 + 2)
      ctx.textAlign = 'left'
      ctx.restore()
    }

    // ---- 单条依次登上舞台：任意时刻只显示当前时间窗命中的那一条消息，
    //      下一条到来时上一条立即离场，不堆叠累积；白卡=舞台全宽（像单条截图）。 ----
    const items2 = layout.items
    let activeIdx = items2.findIndex((it) => {
      const tt = timingArr[it.i]
      return t >= tt.ds && (t < tt.de || (it.i === items2.length - 1 && Math.abs(t - tt.de) < 0.05))
    })
    if (activeIdx === -1) {
      // 落在两窗之间的空档：静态保留最近一条（不再淡出留黑屏），下一条登场时无缝顶替
      for (let i = items2.length - 1; i >= 0; i--) { if (t >= timingArr[i].ds) { activeIdx = i; break } }
    }
    if (activeIdx < 0) activeIdx = 0

    const it = items2[activeIdx]
    const info = timingArr[activeIdx]
    const mine = it.mine
    const eff = pickEntrance(it.msg, it.i, mine)
    const appearP = clamp01((t - info.ds) / 0.4)
    const ap = entranceProgress(eff, appearP)
    // 入场渐显（不带 idle 抖动：到位后完全静止）
    const alpha = eff === 'fade_in' || it.msg.effect === 'fade_in' ? appearP : clamp01(appearP * 1.5)
    // 离场：仅当下一条已经登场（t 超过本窗 de）才整组淡出，避免空档黑屏
    const exitP = t > info.de ? clamp01((t - info.de) / 0.35) : 0
    const exitAlpha = clamp01(1 - exitP * 1.6)
    const exitShift = exitP > 0 ? (mine ? -110 : 110) * exitP : 0
    const exitScale = 1 - exitP * 0.14
    const finalAlpha = alpha * exitAlpha

    if (finalAlpha > 0.01) {
      // 白卡：舞台全宽（像直接截了整条聊天的图），垂直包裹当前消息整块
      const cardX = 0
      const cardW = width
      const blockH = it.h + (it.hasName ? NAME_H : 0)
      // 白卡为长方形（无圆角），高度明显高于消息块：上下各留 80px 空余，并能罩住 100px 头像
      const V_PAD = 80
      const cardH = blockH + V_PAD * 2
      // 有贴纸时把白卡压到上方，下方预留固定「贴纸带」，使贴纸尺寸与消息长短解耦（不再忽大忽小）
      const hasSticker = !!it.msg.sticker
      const STK_BAND = Math.round(height * 0.42)
      const topRegionH = height - (hasSticker ? STK_BAND : 0)
      const cardY = Math.round(TITLE_H + Math.max(24, (topRegionH - TITLE_H - cardH) / 2))
      ctx.save()
      ctx.globalAlpha = finalAlpha
      // 整组（白卡 + 气泡 + 头像）一起做入场/出场动效：位移 + 缩放 + 旋转，绕白卡中心
      ctx.translate(ap.dx + exitShift, ap.dy)
      const gcx = cardX + cardW / 2
      const gcy = cardY + cardH / 2
      ctx.translate(gcx, gcy)
      ctx.scale(ap.scale * exitScale, ap.scale * exitScale)
      if (ap.rotate) ctx.rotate((ap.rotate * Math.PI) / 180)
      ctx.translate(-gcx, -gcy)
      ctx.fillStyle = '#f5f5f5'
      ctx.fillRect(cardX, cardY, cardW, cardH)
      // 消息块在白卡内垂直居中（白卡内 padding）
      const drawY = Math.round(cardY + (cardH - blockH) / 2) + (it.hasName ? NAME_H : 0)
      drawMessage(ctx, it.msg, { ...it, y: drawY }, members, platform, showName, ICON_REDPACKET, ICON_VOICE)
      ctx.restore()
      // 贴纸：绘制在下方固定「贴纸带」内，水平居中；尺寸以贴纸带为准，不受消息长短影响
      if (hasSticker) {
        const STK_MARGIN = 36
        const bandTop = height - STK_BAND
        // 尺寸下限 500px，上限占满贴纸带；与白卡高度解耦，避免长消息把贴纸挤小
        const stickerH = Math.min(Math.max(cardH * 1.1, 500), STK_BAND - STK_MARGIN * 2)
        const stickerW = Math.min(stickerH * 0.8, width * 0.6)
        const sx = Math.round((width - stickerW) / 2)
        const sy = Math.round(bandTop + (STK_BAND - stickerH) / 2)
        // 固定渐隐渐出：入场 0.25s 淡入、离场 0.25s 淡出（不受白卡缩放影响）
        const fadeIn = clamp01(appearP / 0.6)
        const fadeOut = t > info.de ? clamp01((info.de + 0.25 - t) / 0.25) : 1
        const stkAlpha = clamp01(fadeIn * fadeOut)
        if (stkAlpha > 0.01) {
          ctx.save()
          ctx.globalAlpha = finalAlpha * stkAlpha
          // 贴纸动画随情绪变化（pop/rotate/shake/fade/slide），让画面更丰富
          drawSticker(ctx, it.msg.sticker, sx, sy, stickerW, stickerH, emotionToAnim(it.msg.emotion), 'right', appearP)
          ctx.restore()
        }
      }
    }

    return canvas
  }

  return { render, preload, invalidate }
}
