// mcp-server/tools/creative.js
// 创意层写回（LLM 导演）：贴纸 / 动效 / 时间轴精修。
// 严格校验：不符合（贴纸不在库、动效不在枚举、时间窗非法）直接抛错，
// 由调用方（agent）把明确提示回给用户。无关键词兜底、无静默降级。

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

// 渲染层已实现的入场动效枚举（与 src/lib/canvasChat.js 的 entranceProgress 对应）
export const EFFECT_ENUM = [
  'pop_in', 'bounce_in', 'slide_in_left', 'slide_in_right',
  'slide_in_top', 'slide_in_bottom', 'zoom_in', 'flip_in',
  'fade_in', 'pop', 'rotate', 'shake', 'fade', 'slide',
]

// 解析 public/emojis/emoji_scenes.md → [{ label, file, emotion? }]
// 真实文件固定在 public/emojis/imgs/ 下。LLM 只能选这里存在的文件。
export async function buildEmojiCatalog() {
  const mdPath = join(ROOT, 'public', 'emojis', 'emoji_scenes.md')
  let txt = ''
  try { txt = await readFile(mdPath, 'utf-8') } catch { return [] }
  const items = []
  const reFile = /\*\*文件\*\*:\s*`?imgs[/\\]([^`]+)`?/i
  let cur = null
  for (const line of txt.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line)
    if (h) { if (cur) items.push(cur); cur = { label: h[1].trim(), file: '' } ; continue }
    if (!cur) continue
    const f = reFile.exec(line)
    if (f) cur.file = 'imgs/' + f[1].trim().replace(/\\/g, '/')
  }
  if (cur) items.push(cur)
  return items.filter((x) => x.file)
}

function emojiFileSet(catalog) {
  const set = new Set()
  for (const it of catalog) {
    const base = it.file.split('/').pop().toLowerCase()
    set.add(base)
    set.add(it.file.toLowerCase())
    set.add(('/emojis/' + it.file).toLowerCase())
  }
  return set
}

function normSticker(s, set) {
  if (!s) return null
  const lower = s.toLowerCase().replace(/\\/g, '/')
  let cand = lower
  if (!cand.startsWith('/emojis/')) cand = '/emojis/' + (lower.startsWith('imgs/') ? lower : 'imgs/' + lower)
  if (set.has(cand)) return cand
  // 退一步：仅比 basename
  const base = cand.split('/').pop()
  for (const k of set) if (k.endsWith(base)) return k.startsWith('/emojis/') ? k : '/emojis/' + k
  return null
}

/**
 * applyCreative({ scriptMessages, creative })
 * creative: 数组，每条 { index, id?, sticker?, effect?, display_start?, display_end?,
 *                          emotion?, semantic?, reason?, confidence? }
 * 把 LLM 的创意决策写回 script_messages / messages，并标记 creative_reviewed。
 * semantic/reason/confidence 为可选的结构化字段（反馈④：便于单条决策审阅/回改）。
 * 校验失败直接 throw —— 由调用方把错误提示回给用户。
 */
export async function applyCreative({ scriptMessages, creative }) {
  if (!Array.isArray(scriptMessages) || !scriptMessages.length) throw new Error('applyCreative: scriptMessages 为空，请先 parseScript。')
  if (!Array.isArray(creative)) throw new Error('applyCreative: creative 必须是数组。')

  const catalog = await buildEmojiCatalog()
  const set = emojiFileSet(catalog)

  const msgs = scriptMessages.map((m) => ({ ...m }))
  const errors = []

  for (const c of creative) {
    const idx = typeof c.index === 'number' ? c.index
      : (c.id != null ? msgs.findIndex((m) => m.id === c.id) : -1)
    if (idx < 0 || idx >= msgs.length) {
      errors.push(`creative 索引无效 index=${c.index} id=${c.id}（消息数 ${msgs.length}）`)
      continue
    }
    const m = msgs[idx]

    if (c.sticker != null) {
      const norm = normSticker(c.sticker, set)
      if (!norm) errors.push(`贴纸「${c.sticker}」不在表情库（emoji_scenes.md）。请只从库中挑选。`)
      else m.sticker = norm
    }
    if (c.effect != null) {
      if (!EFFECT_ENUM.includes(c.effect)) errors.push(`动效「${c.effect}」不在枚举 ${EFFECT_ENUM.join('/')}。`)
      else m.effect = c.effect
    }
    if (c.emotion != null) m.emotion = c.emotion
    if (c.semantic != null && typeof c.semantic === 'object') m.semantic = c.semantic
    if (c.reason != null) m.creative_reason = c.reason
    if (c.confidence != null) m.creative_confidence = Number(c.confidence)
    if (c.display_start != null || c.display_end != null) {
      const ds = Number(c.display_start ?? m.display_start)
      const de = Number(c.display_end ?? m.display_end)
      if (!isFinite(ds) || !isFinite(de)) errors.push(`消息 ${idx} 时间窗非法（display_start/display_end 非数字）。`)
      else if (de <= ds) errors.push(`消息 ${idx} 时间窗非法（display_end 必须 > display_start）。`)
      else { m.display_start = +ds.toFixed(3); m.display_end = +de.toFixed(3) }
    }
  }

  if (errors.length) {
    throw new Error('创意决策校验未通过，已拒绝写回：\n- ' + errors.join('\n- '))
  }

  // 写回真相源
  const statePath = join(ROOT, 'pipeline_state.json')
  let state = {}
  try { state = JSON.parse(await readFile(statePath, 'utf-8')) } catch {}
  state.script_messages = msgs
  state.messages = msgs
  state.creative_reviewed = true
  state.updated_at = new Date().toISOString()
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8')

  return { ok: true, applied: creative.length, message_count: msgs.length }
}
