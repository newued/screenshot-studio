// 步骤条（V1.1）：5 步骤 + 状态机三态
// 脚本(SCRIPT) → 配音(VOICEOVER) → 时间轴(TIMELINE) → 语义(SEMANTIC) → 渲染(RENDER)
// 可点击已确认/当前步骤；显示 PENDING/AWAIT_CONFIRM/CONFIRMED 状态
import React from 'react'
import { STEP_ORDER, STEP_LABELS, STEP_STATUS } from '../../../lib/pipelineState'

export default function VideoStepBar({ currentStep = 'SCRIPT', steps = {}, onStepClick }) {
  return (
    <div className="video-step-bar">
      {STEP_ORDER.map((step, i) => {
        const s = steps[step] || { status: STEP_STATUS.PENDING }
        const isCurrent = currentStep === step
        const isConfirmed = s.status === STEP_STATUS.CONFIRMED || s.status === STEP_STATUS.DONE
        const isPending = s.status === STEP_STATUS.PENDING
        const canClick = isConfirmed || isCurrent
        return (
          <React.Fragment key={step}>
            {i > 0 && (
              <div className={`video-step-connector${isConfirmed ? ' video-step-connector--done' : ''}`} />
            )}
            <div
              className={`video-step${isCurrent ? ' active' : ''}${isConfirmed ? ' done' : ''}${isPending ? ' pending' : ''}`}
              onClick={canClick ? () => onStepClick?.(step) : undefined}
              style={{ cursor: canClick ? 'pointer' : 'default' }}
              title={s.edited ? '已编辑，需重新确认' : ''}
            >
              <span className="video-step-circle">
                {isConfirmed ? '✓' : i + 1}
              </span>
              <span className="video-step-label">{STEP_LABELS[step]}</span>
              {s.edited && <span className="video-step-edited-dot" title="已编辑" />}
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}
