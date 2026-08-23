// TIMELINE 步骤（V1.1 第 4.3 节）：时间轴审阅 + nudge/shift 编辑 + 确认门
// 支持逐条时间查看与微调、整段平移、导入 AI 精修时间轴
import React, { useState, useMemo } from 'react'
import { buildTimelinePrompt } from '../../../lib/timelinePrompt'
import { copyText } from '../../../lib/clipboard'

export default function TimelineReviewSection({
  messages = [],
  timeline = null,       // [{display_start, display_end}, ...]
  audioName = '',
  hasAudio = false,
  timelineInfo = '',
  asrStatus = '',
  timelinePromptStatus = '',
  onTimelineChange,      // file input handler
  onDownloadAudio,
  onCopyTimelinePrompt,
  onTimelineUpdate,      // (newTimeline) => void
}) {
  const [shiftRange, setShiftRange] = useState('')
  const [shiftDelta, setShiftDelta] = useState('')
  const [nudgeId, setNudgeId] = useState('')
  const [nudgeDelta, setNudgeDelta] = useState('')
  const [editStatus, setEditStatus] = useState('')

  // 消息与时间轴对齐展示
  const timelineRows = useMemo(() => {
    if (!timeline || !timeline.length) return []
    let offset = 0
    if (
      timeline.length < messages.length &&
      (messages[0]?.type === 'time' || messages[0]?.type === 'system')
    ) {
      offset = 1
    }
    return messages.map((m, i) => {
      const tl = timeline[i - offset]
      return {
        index: i,
        speaker: m.speaker || 'A',
        content: (m.content || m.text || '').slice(0, 30),
        type: m.type || 'text',
        start: tl?.display_start,
        end: tl?.display_end,
        hasTiming: !!tl && Number.isFinite(tl.display_start),
      }
    })
  }, [messages, timeline])

  // /nudge <id> <±s>：单条微调
  const handleNudge = () => {
    if (!timeline || !nudgeId || !nudgeDelta) return
    const id = parseInt(nudgeId, 10)
    if (isNaN(id) || id < 0 || id >= timeline.length) {
      setEditStatus(`无效的消息序号：${nudgeId}`)
      return
    }
    const delta = parseFloat(nudgeDelta)
    if (isNaN(delta)) {
      setEditStatus(`无效的偏移量：${nudgeDelta}`)
      return
    }
    const newTl = timeline.map((t, i) => {
      if (i !== id) return t
      return {
        ...t,
        display_start: Math.max(0, (t.display_start || 0) + delta),
        display_end: Math.max(0, (t.display_end || 0) + delta),
      }
    })
    onTimelineUpdate(newTl)
    setEditStatus(`已微调第 ${id} 条：${delta > 0 ? '+' : ''}${delta}s`)
    setNudgeId('')
    setNudgeDelta('')
  }

  // /shift <range> <±s>：整段平移
  const handleShift = () => {
    if (!timeline || !shiftRange || !shiftDelta) return
    const m = shiftRange.match(/^(\d+)-(\d+)$/)
    let start, end
    if (m) {
      start = parseInt(m[1], 10)
      end = parseInt(m[2], 10)
    } else {
      const n = parseInt(shiftRange, 10)
      if (!isNaN(n)) { start = n; end = n }
      else { setEditStatus(`无效的范围：${shiftRange}（格式：3-7 或 5）`); return }
    }
    const delta = parseFloat(shiftDelta)
    if (isNaN(delta)) { setEditStatus(`无效的偏移量：${shiftDelta}`); return }

    const newTl = timeline.map((t, i) => {
      if (i < start || i > end) return t
      return {
        ...t,
        display_start: Math.max(0, (t.display_start || 0) + delta),
        display_end: Math.max(0, (t.display_end || 0) + delta),
      }
    })
    onTimelineUpdate(newTl)
    setEditStatus(`已平移 ${start}-${end}：${delta > 0 ? '+' : ''}${delta}s`)
    setShiftRange('')
    setShiftDelta('')
  }

  // 逐条编辑
  const handleRowEdit = (index, field, value) => {
    if (!timeline) return
    const numVal = parseFloat(value)
    if (isNaN(numVal)) return
    const offset = timelineRows[index]?.hasTiming ? 0 : 0
    const tlIndex = timelineRows[index]?.hasTiming
      ? timeline.findIndex((t, i) => i === index - (messages[0]?.type === 'time' || messages[0]?.type === 'system' ? 1 : 0))
      : -1
    // 简化：直接按 index 对齐
    const newTl = timeline.map((t, i) => {
      if (i !== index) return t
      return { ...t, [field]: numVal }
    })
    onTimelineUpdate(newTl)
  }

  const handleCopyPrompt = async () => {
    if (!messages.length) return
    const prompt = buildTimelinePrompt(messages, audioName)
    try {
      await copyText(prompt)
      onCopyTimelinePrompt?.()
    } catch {
      /* 父组件处理状态 */
    }
  }

  return (
    <div className="video-section video-section--open">
      {/* 时间轴列表 */}
      {timeline && timeline.length > 0 ? (
        <div className="video-field">
          <label>时间轴列表（可逐条编辑）</label>
          <div className="timeline-review-list">
            {timelineRows.map((row) => (
              <div key={row.index} className={`timeline-review-row${!row.hasTiming ? ' timeline-review-row--unmatched' : ''}`}>
                <span className="timeline-review-index">{row.index}</span>
                <span className="timeline-review-speaker">{row.speaker}</span>
                <span className="timeline-review-content" title={row.content}>
                  {row.type === 'time' ? `[时间]` : row.type === 'system' ? `[系统]` : row.content}
                </span>
                {row.hasTiming ? (
                  <>
                    <input
                      type="number"
                      className="timeline-review-input"
                      value={row.start?.toFixed(2) ?? ''}
                      step="0.05"
                      onChange={(e) => handleRowEdit(row.index, 'display_start', e.target.value)}
                    />
                    <span className="timeline-review-sep">→</span>
                    <input
                      type="number"
                      className="timeline-review-input"
                      value={row.end?.toFixed(2) ?? ''}
                      step="0.05"
                      onChange={(e) => handleRowEdit(row.index, 'display_end', e.target.value)}
                    />
                  </>
                ) : (
                  <span className="timeline-review-no-timing">无时间</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="video-field">
          <label>时间轴未生成</label>
          <p className="hint-text">
            选择配音文件后将自动生成时间轴（浏览器 ASR），或用 AI 精修导入。
          </p>
        </div>
      )}

      {/* 批量编辑命令 */}
      {timeline && timeline.length > 0 && (
        <div className="video-field">
          <label>批量调整</label>
          <div className="timeline-edit-row">
            <span className="timeline-edit-label">/nudge</span>
            <input
              type="number"
              className="timeline-edit-input timeline-edit-input--id"
              value={nudgeId}
              onChange={(e) => setNudgeId(e.target.value)}
              placeholder="序号"
            />
            <input
              type="text"
              className="timeline-edit-input timeline-edit-input--delta"
              value={nudgeDelta}
              onChange={(e) => setNudgeDelta(e.target.value)}
              placeholder="±0.5s"
            />
            <button type="button" className="btn btn-sm btn-secondary" onClick={handleNudge}>
              微调
            </button>
          </div>
          <div className="timeline-edit-row">
            <span className="timeline-edit-label">/shift</span>
            <input
              type="text"
              className="timeline-edit-input timeline-edit-input--range"
              value={shiftRange}
              onChange={(e) => setShiftRange(e.target.value)}
              placeholder="3-7"
            />
            <input
              type="text"
              className="timeline-edit-input timeline-edit-input--delta"
              value={shiftDelta}
              onChange={(e) => setShiftDelta(e.target.value)}
              placeholder="+0.5s"
            />
            <button type="button" className="btn btn-sm btn-secondary" onClick={handleShift}>
              平移
            </button>
          </div>
          {editStatus && <p className="hint-text">{editStatus}</p>}
        </div>
      )}

      {/* AI 精修时间轴 */}
      <div className="video-field">
        <label>AI 精修时间轴（更高精度，可选）</label>
        <p className="hint-text">
          浏览器 Whisper 自动生成时间轴（零配置）。若需更高精度，可让 codex / codebuddy
          用本地 faster-whisper / SenseVoice 生成并导入。
        </p>
        <div className="video-btn-row">
          <button type="button" className="btn btn-secondary" disabled={!hasAudio} onClick={onDownloadAudio}>
            下载配音音频
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleCopyPrompt}>
            复制时间轴提示词给 AI
          </button>
          <label className="video-file-pick video-file-pick--inline">
            <span className="video-file-pick-text">导入时间轴 JSON</span>
            <input type="file" accept=".json,application/json" onChange={onTimelineChange} hidden />
          </label>
        </div>
        {(timelineInfo || timelinePromptStatus) && (
          <p className="hint-text">{timelineInfo || timelinePromptStatus}</p>
        )}
        {asrStatus && <p className="hint-text">{asrStatus}</p>}
      </div>
    </div>
  )
}
