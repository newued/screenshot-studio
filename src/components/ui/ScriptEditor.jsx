// 脚本编辑器：说话人选择 + 插入模板 + emoji 面板
import React, { useRef, useState } from 'react'

const CHIPS = [
  { key: 'text', label: '文本', tpl: (s) => `${s}说：` },
  { key: 'redpacket', label: '红包', tpl: (s) => `${s}说：[红包：恭喜发财]` },
  { key: 'transfer', label: '转账', tpl: (s) => `${s}说：[转账：88.00，转账给朋友]` },
  { key: 'transferRecv', label: '收转账', tpl: (s) => `${s}说：[收转账：88.00]` },
  { key: 'voice', label: '语音', tpl: (s) => `${s}说：[语音：10"]` },
  { key: 'voiceText', label: '语音转文字', tpl: (s) => `${s}说：[语音转文字：这里是转写内容]` },
  { key: 'videoAnswered', label: '视频已接', tpl: (s) => `${s}说：[视频已接：00:30]` },
  { key: 'videoMissed', label: '视频未接', tpl: (s) => `${s}说：[视频未接]` },
  { key: 'time', label: '时间', tpl: () => `时间：上午 9:41` },
  { key: 'system', label: '系统', tpl: () => `系统：以下为新消息` },
  { key: 'recall', label: '撤回', tpl: () => `撤回：你撤回了一条消息` },
]

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '🤔', '😎', '😭',
  '😅', '🙄', '👍', '👎', '👏', '🙏', '💪', '❤️', '💔', '🔥',
  '🎉', '🌹', '🧧', '💰', '✅', '❌', '⚡', '🌟', '😴', '🤝',
]

export default function ScriptEditor({ value, onChange, members = [] }) {
  const taRef = useRef(null)
  const lastPos = useRef(0)
  const [speaker, setSpeaker] = useState('A')

  const insert = (text) => {
    const ta = taRef.current
    if (!ta) {
      onChange((value || '') + '\n' + text)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = (value || '').slice(0, start) + text + (value || '').slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + text.length
    })
  }

  const insertChip = (chip) => {
    const s = ['time', 'system', 'recall'].includes(chip.key) ? '' : speaker
    insert('\n' + chip.tpl(s))
  }

  const insertEmoji = (e) => insert(e)

  // 切换说话人后，把焦点和光标移回文本框，并恢复到切换前的光标位置
  const onSpeakerChange = (e) => {
    const v = e.target.value
    setSpeaker(v)
    const ta = taRef.current
    if (ta) {
      const pos = lastPos.current
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
    }
  }

  return (
    <div className="script-editor">
      <div className="script-toolbar">
        <div className="script-speaker">
          说话人：
          <select value={speaker} onChange={onSpeakerChange}>
            {members.map((m, i) => (
              <option key={i} value={String.fromCharCode(65 + i)}>
                {String.fromCharCode(65 + i)} · {m.name || '(未命名)'}
                {i === 0 ? '（我）' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="script-actions">
          {CHIPS.map((c) => (
            <button key={c.key} type="button" className="script-chip" onClick={() => insertChip(c)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="emoji-panel">
        {EMOJIS.map((e) => (
          <button key={e} type="button" className="emoji-btn" onClick={() => insertEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          lastPos.current = e.target.selectionStart
        }}
        placeholder={'输入对话脚本，例如：\nA说：在吗？\nB说：在的\n时间：上午 9:41\nA说：[红包：恭喜发财]\nB说：[转账：88.00，转账给朋友]'}
      />
    </div>
  )
}
