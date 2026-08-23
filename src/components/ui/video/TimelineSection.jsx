// 时间轴区：导入时间轴 JSON + ASR 状态提示 + AI 精修时间轴（模型直通）
// 纯受控组件，无内部 state
import React from 'react'

export default function TimelineSection({
  timelineInfo,
  asrStatus,
  stepDone2,
  onTimelineChange,
  hasAudio,
  audioName,
  onDownloadAudio,
  onCopyTimelinePrompt,
  timelinePromptStatus,
}) {
  return (
    <div className={`video-section video-section--open${stepDone2 ? '' : ' video-section-fade'}`}>
      <div className="video-field">
        <label>导入时间轴 JSON（可选，自动识别失败时可手动覆盖）</label>
        <label className="video-file-pick">
          <span className="video-file-pick-text">点击选择时间轴 JSON（.json）</span>
          <input type="file" accept=".json,application/json" onChange={onTimelineChange} hidden />
        </label>
        {timelineInfo && <p className="hint-text">{timelineInfo}</p>}
      </div>

      <div className="video-field">
        <label>AI 精修时间轴（更高精度，可选）</label>
        <p className="hint-text">
           浏览器 Whisper 会自动生成时间轴（零配置，首次需联网下载模型，国内自动走 hf-mirror 镜像）。若识别失败或需更高精度，可让 codex / codebuddy
           用本地 faster-whisper / SenseVoice 生成精确时间轴并导入。
         </p>
        <div className="video-btn-row">
          <button type="button" className="btn btn-secondary" disabled={!hasAudio} onClick={onDownloadAudio}>
            下载配音音频
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCopyTimelinePrompt}>
            复制时间轴提示词给 AI
          </button>
        </div>
        {timelinePromptStatus && <p className="hint-text">{timelinePromptStatus}</p>}
      </div>
    </div>
  )
}
