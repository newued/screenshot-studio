// 配音区：文件选择 + 曲风 + 复制配音提示词 + 时长输入
// 纯受控组件，无内部 state
import React from 'react'
import Button from '../Button'
import { VOICE_STYLES } from '../../../lib/voicePrompt'

export default function AudioSection({
  audioName,
  audioDuration,
  voiceStyleId,
  voicePromptStatus,
  asrStatus,
  stepDone1,
  mcpAvailable,
  asrEngine,
  onAudioChange,
  onDurationChange,
  onVoiceStyleChange,
  onCopyVoicePrompt,
}) {
  return (
    <div className={`video-section video-section--open${stepDone1 ? '' : ' video-section-fade'}`}>
      {/* 配音提示词 + 曲风选择 */}
      <div className="video-field">
        <label>配音提示词（去 Suno / 妙响 生成配音）</label>
        <div className="btn-row">
          <select
            className="ai-preset"
            value={voiceStyleId}
            onChange={(e) => onVoiceStyleChange(e.target.value)}
          >
            {VOICE_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={onCopyVoicePrompt}>
            复制配音提示词
          </button>
        </div>
        {voicePromptStatus && <p className="hint-text">{voicePromptStatus}</p>}
      </div>

      {/* 音频文件选择 */}
      <div className="video-field">
        <label>配音 MP3 文件</label>
        <label className="video-file-pick">
          <span className="video-file-pick-text">{audioName ? `已选择：${audioName}（点击更换）` : '点击选择音频文件（MP3）'}</span>
          <input type="file" accept="audio/mpeg,audio/mp3,.mp3" onChange={onAudioChange} hidden />
        </label>
        <div className="btn-row" style={{ marginTop: 8, alignItems: 'center' }}>
          {/* 识别引擎自动选择：MCP 可用优先用 Python faster-whisper（最优），
              否则退回浏览器 WASM；无需用户手动切换 */}
          <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {asrEngine === 'mcp'
              ? <span style={{ color: '#07c160' }}>🟢 已启用 MCP 原生（faster-whisper，精度最优）</span>
              : mcpAvailable
                ? <span style={{ color: '#999' }}>⚪ 浏览器离线（MCP 不可用时兜底）</span>
                : <span style={{ color: '#999' }}>⚪ 浏览器离线模式</span>
            }
          </span>
        </div>
        {asrStatus && <p className="hint-text">{asrStatus}</p>}
      </div>

      {/* 音频时长 */}
      <div className="video-field">
        <label>音频时长（秒，选择文件后自动获取，可修改）</label>
        <input
          type="number"
          min="0"
          step="0.1"
          value={audioDuration}
          onChange={(e) => onDurationChange(e.target.value)}
          placeholder="自动获取"
        />
      </div>
    </div>
  )
}
