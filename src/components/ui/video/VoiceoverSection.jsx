// VOICEOVER 步骤（V1.1 第 4.2 节）：配音提示词 + 音频选择 + 节拍网格 + DP对齐 + 确认门
// 节拍网格优先（librosa），ASR 增强（faster-whisper），DP 全局对齐
import React from 'react'
import { VOICE_STYLES } from '../../../lib/voicePrompt'

export default function VoiceoverSection({
  audioName,
  audioDuration,
  voiceStyleId,
  voicePromptStatus,
  asrStatus,
  mcpAvailable,
  asrEngine,
  progress = 0,        // 0-100，由 agent/大模型对齐进度驱动
  needsReview = false, // 自动对齐存在 unmatched/ambiguous（如说唱/演唱），需 AI 语义仲裁
  reviewReady = false, // agent 已完成语义仲裁并写回
  onAudioChange,
  onDurationChange,
  onVoiceStyleChange,
  onCopyVoicePrompt,
}) {
  return (
    <div className="video-section video-section--open">
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
              <option key={s.id} value={s.id}>{s.name}</option>
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
          <span className="video-file-pick-text">
            {audioName ? `已选择：${audioName}（点击更换）` : '点击选择音频文件（MP3）'}
          </span>
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

      {/* 进度卡片：网页只展示步骤与进度，中间对齐细节由 AI(agent 大模型) 在后台完成，不在网页编辑 */}
      <div className="video-field">
        <label>识别与对齐进度</label>
        <div className="align-progress">
          <div className="align-progress-bar">
            <div
              className="align-progress-fill"
              style={{ width: `${Math.max(0, Math.min(100, progress || 0))}%` }}
            />
          </div>
          <div className="align-progress-meta">
            <span className="align-progress-pct">{Math.round(progress || 0)}%</span>
            <span className="align-progress-engine">
              {asrEngine === 'mcp'
                ? 'AI 引擎：MCP 原生 + 大模型语义对齐'
                : mcpAvailable
                  ? 'AI 引擎：MCP（不可用则浏览器离线）'
                  : 'AI 引擎：浏览器离线'}
            </span>
          </div>
          {asrStatus && <p className="hint-text">{asrStatus}</p>}
          {needsReview && !reviewReady && (
            <p className="hint-text" style={{ color: '#92400e' }}>
              ⚠ 检测到说唱/演唱等 ASR 不稳片段（未匹配或歧义），已转交 AI（agent 大模型）做语义级对齐，无需在网页手动处理。
            </p>
          )}
          {reviewReady && (
            <p className="hint-text" style={{ color: '#065f46' }}>
              ✓ AI 语义仲裁已完成，时间轴已修正。
            </p>
          )}
          <p className="hint-text hint-text--muted">
            节拍网格 / DP 对齐 / 未匹配审阅等中间产物由 AI（agent 大模型）在后台完成，网页仅展示进度，无需手动干预。
          </p>
        </div>
      </div>
    </div>
  )
}
