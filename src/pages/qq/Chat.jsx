// QQ 对话生成（基于群聊模板，QQ 主题；AI 助手与视频面板为全平台共用组件）
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

const DEFAULT_SCRIPT = `A说：周末开黑吗兄弟们
B说：来，几点
C说：晚上 8 点走起
时间：晚上 7:45
A说：[红包：开黑红包]
B说：[语音：5"]
C说：收到
A说：8 点见`

const DEFAULT_MEMBER_NAMES = ['我', '张三', '李四']

export default function QqChat() {
  const {
    DEEP,
    script,
    setScript,
    members,
    setMembers,
    groupName,
    setGroupName,
    aiOpen,
    setAiOpen,
    screenRef,
    messages,
    onExport,
    onExportSlices,
    randomizeAvatars,
  } = useChatPage({
    defaultScript: DEFAULT_SCRIPT,
    defaultMemberNames: DEFAULT_MEMBER_NAMES,
    defaultGroupName: 'QQ群聊',
    filename: 'qq-chat',
    exportBase: (g) => g || 'QQ群聊',
  })

  const [videoOpen, setVideoOpen] = useState(() => DEEP.autoExport === 'video')

  return (
    <div className="page">
      <div className={`tool-shell ${aiOpen ? 'tool-shell--ai' : ''}`}>
        <Panel
          title="QQ 对话生成"
          desc="QQ 风格聊天截图；可导出整图、逐条切片，或生成视频。"
          action={
            <button type="button" className="ai-fab" onClick={() => setAiOpen((o) => !o)} title="AI 生成助手">
              <img src="/icons/aizhushou.svg" alt="AI" />
            </button>
          }
        >
          <ScriptEditor value={script} onChange={setScript} members={members} />
          <div className="section-title">群名称</div>
          <input className="group-name-input" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="群名称" />
          <div className="section-title">群成员</div>
          <MembersEditor members={members} onChange={setMembers} />
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={randomizeAvatars}>
              一键随机头像
            </button>
          </div>
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
            platform="qq"
            mode="group"
            projectTitle={groupName || 'QQ群聊'}
            groupName={groupName}
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
          <PhoneFrame time="9:41" navTitle={groupName} platform="qq" input screenRef={screenRef}>
            <ChatPreview messages={messages} members={members} platform="qq" showName />
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