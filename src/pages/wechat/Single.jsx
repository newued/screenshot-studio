// 微信单聊对话生成（基于群聊模板，双人对话，不显示昵称）
import React, { useState } from 'react'
import Panel from '../../components/ui/Panel'
import ScriptEditor from '../../components/ui/ScriptEditor'
import MembersEditor from '../../components/ui/MembersEditor'
import Button from '../../components/ui/Button'
import PhoneFrame from '../../components/phone/Phone'
import ChatPreview from '../../components/chat/ChatPreview'
import AiPromptPanel from '../../components/ai/AiPromptPanel'
import VideoPipelinePanel from '../../components/ui/VideoPipelinePanel'
import { useChatPage } from '../../lib/useChatPage'

const DEFAULT_SCRIPT = `A说：在吗？今晚有空吗
B说：在的，怎么了
A说：上次说的那个方案，明天就要交了
B说：我晚上帮你一起看看
时间：下午 2:30
A说：[转账：200.00，上次的餐费]
B说：[收转账：200.00]
B说：收到，谢啦
A说：[语音：5"]`

const DEFAULT_MEMBER_NAMES = ['我', '对方']

export default function WechatSingle() {
  const {
    DEEP,
    script,
    setScript,
    members,
    setMembers,
    aiOpen,
    setAiOpen,
    screenRef,
    messages,
    onExport,
    onExportSlices,
  } = useChatPage({
    defaultScript: DEFAULT_SCRIPT,
    defaultMemberNames: DEFAULT_MEMBER_NAMES,
    defaultGroupName: '微信单聊',
    filename: 'wechat-single',
    exportBase: (g, m) => m[1]?.name || '对方',
  })

  const [videoOpen, setVideoOpen] = useState(() => DEEP.autoExport === 'video')

  const singleTitle = members[1]?.name || '对方'

  return (
    <div className="page">
      <div className={`tool-shell ${aiOpen ? 'tool-shell--ai' : ''}`}>
        <Panel
          title="微信单聊对话生成"
          desc="双人头像、昵称、文本/红包/转账"
          action={
            <button type="button" className="ai-fab" onClick={() => setAiOpen((o) => !o)} title="AI 生成助手">
              <img src="/icons/aizhushou.svg" alt="AI" />
            </button>
          }
        >
          <ScriptEditor value={script} onChange={setScript} members={members} />
          <div className="section-title">对话双方</div>
          <MembersEditor members={members} onChange={setMembers} allowAddRemove={false} />
          <div className="btn-row export-row">
            <Button onClick={onExport}>导出整图</Button>
            <Button variant="secondary" onClick={onExportSlices}>
              导出切片
            </Button>
            {/* 生成视频入口仅在 agent 会话（?agent=1）下暴露；默认 UI 仅提供整图/切片 */}
            {DEEP.isAgentSession && (
              <Button variant="secondary" onClick={() => setVideoOpen((o) => !o)}>
                {videoOpen ? '收起视频面板' : '视频生成面板'}
              </Button>
            )}
          </div>
          {/* agent 会话才渲染视频面板；否则 UI 只做整图/切片导出 */}
          {DEEP.isAgentSession && (
          <VideoPipelinePanel
            messages={messages}
            members={members}
            platform="wechat"
            mode="single"
            projectTitle={singleTitle}
            groupName=""
            script={script}
            onScriptChange={setScript}
            autoRun={DEEP.autoExport === 'video' || DEEP.autoExport === 'mp4' ? DEEP.autoExport : ''}
            initialDecisions={DEEP.decisions}
            initialTimeline={DEEP.timeline}
            initialAudio={DEEP.audio}
            open={videoOpen}
            onToggle={() => setVideoOpen((o) => !o)}
          />
          )}
        </Panel>
        <aside className="preview-col">
          <PhoneFrame time="9:41" navTitle={members[1]?.name || '对方'} platform="wechat" input screenRef={screenRef}>
            <ChatPreview messages={messages} members={members} platform="wechat" showName={false} />
          </PhoneFrame>
          <div className="phone-meta">截图 390×844 @3x</div>
        </aside>
        {aiOpen && (
          <Panel
            className="ai-panel"
            title="AI 生成助手"
            desc="格式说明 · 提示词 · 粘贴校验"
            action={
              <button type="button" className="ai-fab ai-fab-close" onClick={() => setAiOpen(false)} title="收起">
                ×
              </button>
            }
          >
            <AiPromptPanel members={members} onApply={setScript} />
          </Panel>
        )}
      </div>
    </div>
  )
}