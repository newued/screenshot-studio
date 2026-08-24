// scripts/core/project.js
// 项目组装（从 agent-bridge.mjs 抽出，解决反馈⑤）
// 把 parseScript + alignDP 的结果装配成渲染用的 project 对象。

import { defaultMembers } from '../../src/data/avatars.js'

// 把消息数组还原成脚本文本（供 alignDP / 回显）
export function buildScriptText(messages) {
  return (messages || []).map((m) => {
    if (m.type === 'time') return `[${m.content}]`
    if (m.type === 'system') return `[系统]${m.content}`
    const sp = m.speaker || (m.role === 'me' ? '我' : '对方') || 'A'
    return `${sp}说：${m.content}`
  }).join('\n')
}

// 由 parse + align 装配 project（时间窗从 mapping 派生）
export function buildProject({ parse, align, opts }) {
  const mapping = align.mapping || align.timeline || []
  const dur = align.duration || 0
  const messages = (parse.messages || []).map((m, i) => {
    const mp = mapping[i] || {}
    const rap = mp.rap_span || null
    const hasSpan = !!(rap && rap.start != null && rap.end != null)
    let ds = rap && rap.start != null ? +rap.start : (mp.proposed_at != null ? +mp.proposed_at : (m.display_start != null ? +m.display_start : null))
    let de = rap && rap.end != null ? +rap.end : (m.display_end != null ? +m.display_end : null)
    if (ds == null) ds = 0
    let explicitEnd = hasSpan
    if (de == null || de <= ds) {
      const nextDs = (mapping[i + 1] && (mapping[i + 1].rap_span?.start ?? mapping[i + 1].proposed_at)) || dur || (ds + 6)
      de = Math.max(ds + 0.6, Math.min(+nextDs, dur || ds + 12))
      explicitEnd = false
    }
    return {
      ...m,
      display_start: +ds.toFixed(3),
      display_end: +de.toFixed(3),
      // 保留决策指定的动效（已在 decisions.js 映射为渲染器枚举）；无则随机挑选以丰富画面
      effect: m.effect && m.effect !== 'random' ? m.effect : 'random',
      _explicitEnd: explicitEnd,
    }
  })
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i]._explicitEnd) continue
    const nextDs = messages[i + 1].display_start
    if (messages[i].display_end > nextDs) {
      messages[i].display_end = +Math.max(nextDs, messages[i].display_start + 0.6).toFixed(3)
    }
  }
  messages.forEach((m) => { delete m._explicitEnd })
  return {
    title: opts.title || '聊天记录视频',
    platform: opts.platform || 'wechat',
    mode: opts.mode || 'single',
    members: opts.members || (parse.messages?.length ? defaultMembers(['我', '对方']) : []),
    audio: opts.audio || '',
    audioDuration: dur,
    duration: dur,
    centered: opts.centered !== false,
    messages,
  }
}
