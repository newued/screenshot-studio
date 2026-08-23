// 决策区：内置规则生成 / 复制决策提示词 / 导入决策 JSON
// 纯受控组件，无内部 state
import React from 'react'

export default function DecisionSection({
  decisionsInfo,
  promptStatus,
  stepDone3,
  onRunBuiltin,
  onCopyDecisionPrompt,
  onDecisionsChange,
}) {
  return (
    <div className={`video-section video-section--open${stepDone3 ? '' : ' video-section-fade'}`}>
      <div className="video-field">
        <label>语义决策（贴纸 / 动画）</label>
        <p className="hint-text">
          没有 codebuddy / codex？已默认用<strong>内置规则</strong>自动生成贴纸，可直接导出；或点「复制决策提示词」给任意 AI 生成后导入；AI 工具也可经深链接 ?decisions= 直传。
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={onRunBuiltin}>
            用内置规则生成
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCopyDecisionPrompt}>
            复制决策提示词
          </button>
          <label className="video-file-pick video-file-pick--inline">
            <span className="video-file-pick-text">导入决策 JSON</span>
            <input type="file" accept=".json,application/json" onChange={onDecisionsChange} hidden />
          </label>
        </div>
        {decisionsInfo && <p className="hint-text">{decisionsInfo}</p>}
        {promptStatus && <p className="hint-text">{promptStatus}</p>}
      </div>
    </div>
  )
}
