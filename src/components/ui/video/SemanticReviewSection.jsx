// SEMANTIC 步骤（V1.1 第 4.4 / 6 节）：语义决策审阅 + 增删改 + 确认门
// 三种生成方式：① 内置规则 ② AI 生成导入 ③ 深链接直传
// 审阅界面：逐条查看消息的 emotion/sticker/effect，可修改
import React, { useState, useMemo } from 'react'
import { EFFECTS_CATALOG, findSticker, findMotion, isValidKind } from '../../../lib/effectsCatalog'
import { buildDecisionPromptForCatalog } from '../../../lib/decisionPrompt'
import { copyText } from '../../../lib/clipboard'

export default function SemanticReviewSection({
  messages = [],
  decisions = null,       // [{emotion, sticker, sfx, effect}, ...]
  decisionsInfo = '',
  promptStatus = '',
  onRunBuiltin,
  onCopyDecisionPrompt,
  onDecisionsChange,     // file input handler
  onDecisionsUpdate,     // (newDecisions) => void
}) {
  const [editStatus, setEditStatus] = useState('')

  // 决策与消息对齐展示
  const reviewRows = useMemo(() => {
    if (!decisions || !decisions.length) return []
    return messages.map((m, i) => {
      const d = decisions[i] || {}
      return {
        index: i,
        speaker: m.speaker || 'A',
        content: (m.content || m.text || '').slice(0, 25),
        type: m.type || 'text',
        emotion: d.emotion || 'neutral',
        sticker: d.sticker || '',
        effect: d.effect || 'fade_in',
      }
    })
  }, [messages, decisions])

  // 修改单条决策
  const handleFieldChange = (index, field, value) => {
    if (!decisions) return
    const newDecisions = decisions.map((d, i) => {
      if (i !== index) return d
      return { ...d, [field]: value }
    })
    onDecisionsUpdate(newDecisions)
    setEditStatus(`已修改第 ${index} 条的 ${field}`)
  }

  // 复制决策提示词（使用 V1.1 特效词表）
  const handleCopyPrompt = async () => {
    if (!messages.length) return
    const catalogSummary = {
      sticker: EFFECTS_CATALOG.sticker.map(s => ({ kind: s.kind, label: s.label })),
      motion: EFFECTS_CATALOG.motion.map(m => ({ kind: m.kind, label: m.label, desc: m.desc })),
    }
    const prompt = buildDecisionPromptForCatalog(messages, catalogSummary)
    try {
      await copyText(prompt)
      onCopyDecisionPrompt?.()
    } catch {
      /* 父组件处理 */
    }
  }

  return (
    <div className="video-section video-section--open">
      {/* 生成方式 */}
      <div className="video-field">
        <label>语义决策生成</label>
        <p className="hint-text">
          系统根据对话语义自动判断贴纸/动效/转场插入。可使用内置规则快速生成，
          或复制提示词给 AI 生成后导入。
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={onRunBuiltin}>
            用内置规则生成
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleCopyPrompt}>
            复制决策提示词（V1.1 词表）
          </button>
          <label className="video-file-pick video-file-pick--inline">
            <span className="video-file-pick-text">导入决策 JSON</span>
            <input type="file" accept=".json,application/json" onChange={onDecisionsChange} hidden />
          </label>
        </div>
        {(decisionsInfo || promptStatus) && (
          <p className="hint-text">{decisionsInfo || promptStatus}</p>
        )}
      </div>

      {/* 逐条审阅 */}
      {decisions && decisions.length > 0 && (
        <div className="video-field">
          <label>决策审阅（可逐条修改）</label>
          <div className="semantic-review-list">
            {reviewRows.map((row) => (
              <div key={row.index} className="semantic-review-row">
                <span className="semantic-review-index">{row.index}</span>
                <span className="semantic-review-speaker">{row.speaker}</span>
                <span className="semantic-review-content" title={row.content}>
                  {row.type === 'time' ? '[时间]' : row.type === 'system' ? '[系统]' : row.content}
                </span>
                <select
                  className="semantic-review-select semantic-review-select--emotion"
                  value={row.emotion}
                  onChange={(e) => handleFieldChange(row.index, 'emotion', e.target.value)}
                >
                  <option value="neutral">中性</option>
                  <option value="happy">开心</option>
                  <option value="sad">伤心</option>
                  <option value="angry">愤怒</option>
                  <option value="surprise">惊讶</option>
                </select>
                <select
                  className="semantic-review-select semantic-review-select--sticker"
                  value={row.sticker}
                  onChange={(e) => handleFieldChange(row.index, 'sticker', e.target.value)}
                >
                  <option value="">无贴纸</option>
                  {EFFECTS_CATALOG.sticker.map(s => (
                    <option key={s.kind} value={s.kind}>{s.label}</option>
                  ))}
                </select>
                <select
                  className="semantic-review-select semantic-review-select--effect"
                  value={row.effect}
                  onChange={(e) => handleFieldChange(row.index, 'effect', e.target.value)}
                >
                  {EFFECTS_CATALOG.motion.map(m => (
                    <option key={m.kind} value={m.kind}>{m.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {editStatus && <p className="hint-text">{editStatus}</p>}
        </div>
      )}
    </div>
  )
}
