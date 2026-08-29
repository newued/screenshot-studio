// 视频生成面板（V2.0 Agent 优先简化版）：
// 网页端只负责：编辑头像/气泡 + 上传配音 + 确认页面信息
// 所有计算密集型任务（ASR、对齐、渲染）由 Agent 后端完成
// 状态同步：pipeline_state.json 是唯一真相源
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { checkMcpStatus, mcpSubmitPage, fetchPipelineState } from '../../lib/mcpClient'
import { deriveChatTitle } from '../../lib/chatTitle'
import McpStatusBar from '../video/McpStatusBar'
import { VOICE_STYLES, buildVoicePrompt } from '../../lib/voicePrompt'
import { copyText } from '../../lib/clipboard'
import { toast } from './Toast'

export default function VideoPipelinePanel({
  messages = [],
  members = [],
  platform = 'wechat',
  mode = 'single',
  projectTitle = '微信对话',
  groupName = '',
  script = '',
  onScriptChange = () => {},
  autoRun = '',
  initialDecisions = null,
  initialTimeline = null,
  initialAudio = '',
  open = true,
  onToggle,
}) {
  // ==================== 简化状态（V2.0 Agent 优先） ====================
  // 网页端只维护：音频文件、提交状态、Agent 处理状态
  const [audioName, setAudioName] = useState('')
  const [audioDuration, setAudioDuration] = useState('')
  const [voiceStyleId, setVoiceStyleId] = useState('gospel-funk')
  const [voicePromptStatus, setVoicePromptStatus] = useState('')
  const [mcpAvailable, setMcpAvailable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [agentState, setAgentState] = useState(null)
  const [localAudio, setLocalAudio] = useState(null)

  // 顶栏标题强制按规则派生（与后端渲染、网页预览一致）：单聊=对方昵称，群聊=群名称。
  // 必须在 handleConfirmPage 之前定义（后者引用此值）
  const headerTitle = useMemo(() => deriveChatTitle(mode, members, groupName), [mode, members, groupName])

  // 检测 MCP Server
  useEffect(() => {
    let alive = true
    const poll = async () => {
      const ok = await checkMcpStatus()
      if (alive) setMcpAvailable(ok)
    }
    poll()
    const timer = setInterval(poll, 10000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // 选择配音文件（V2.0：只做文件选择，不做 ASR）
  const onAudioPick = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLocalAudio(file)
    setAudioName(file.name)
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) setAudioDuration(String(Math.round(audio.duration * 10) / 10))
      URL.revokeObjectURL(url)
    }, { once: true })
    audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
  }, [])

  // 确认页面信息：把音频 base64 + 当前 messages/members 提交给 MCP Server
  // → server 落盘音频（产生真实本地路径）+ 写 pipeline_state.json → agent 轮询拿到
  const handleConfirmPage = useCallback(async () => {
    if (!localAudio) { setSubmitError('请先选择配音音频文件'); return }
    setSubmitting(true); setSubmitError(''); setSubmitted(false)
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(localAudio)
      })
      // 以「上方编排区」为准：members/groupName 全部取自 props；标题按规则派生后提交
      const res = await mcpSubmitPage({
        audioBase64: dataUrl,
        audioName: localAudio.name,
        title: headerTitle,
        messages,
        members,
        groupName,
      })
      setSubmitted(true)
      toast.success('信息已确认，请回到 AI 助手对话继续')
      console.log('[submitPage]', res)
    } catch (err) {
      console.error('提交页面信息失败', err)
      setSubmitError(`提交失败：${err?.message || err}`)
    } finally {
      setSubmitting(false)
    }
  }, [localAudio, messages, members, headerTitle])

  // 轮询 pipeline_state.json：agent 处理进度/结果回显
  useEffect(() => {
    if (!submitted) return
    let alive = true
    const tick = async () => {
      if (!alive) return
      try {
        const st = await fetchPipelineState()
        if (st) setAgentState(st)
      } catch { /* 忽略轮询错误 */ }
      if (alive) setTimeout(tick, 1500)
    }
    tick()
    return () => { alive = false }
  }, [submitted])

  // 复制配音提示词（V2.0：只做复制，不做 ASR）
  const copyVoicePrompt = useCallback(async () => {
    if (!messages.length) return
    const style = VOICE_STYLES.find((s) => s.id === voiceStyleId) || VOICE_STYLES[0]
    const prompt = buildVoicePrompt(messages, style.prompt)
    if (!prompt) { setVoicePromptStatus('当前脚本没有可配音的文本消息'); return }
    try {
      await copyText(prompt)
      setVoicePromptStatus('已复制配音提示词，去 Suno / 妙响 生成后下载 MP3 并选择')
    } catch { setVoicePromptStatus('复制失败，请手动复制'); console.log(prompt) }
  }, [messages, voiceStyleId])

  // ==================== 深链接 / AI 直传自动模式（V2.0：简化） ====================
  useEffect(() => {
    if (!autoRun && !initialAudio) return

    const run = async () => {
      // 1. 音频直传
      if (initialAudio) {
        try {
          const res = await fetch(initialAudio, { mode: 'cors' })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          const name = decodeURIComponent(initialAudio.split('/').pop() || 'voice.mp3')
          const file = new File([blob], name, { type: blob.type || 'audio/mpeg' })
          setLocalAudio(file)
          setAudioName(name)
          const url = URL.createObjectURL(file)
          const audio = new Audio(url)
          audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(audio.duration)) setAudioDuration(String(Math.round(audio.duration * 10) / 10))
            URL.revokeObjectURL(url)
          }, { once: true })
          audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })
        } catch (err) {
          console.error('AI 直传音频加载失败', err)
          toast.error('AI 直传音频加载失败')
        }
      }
    }

    const t = setTimeout(() => {
      run()
    }, 300)
    return () => clearTimeout(t)
  }, [autoRun, initialAudio])

  // 步骤完成判断（V2.0：简化）
  const scriptReady = messages.length > 0
  const voiceoverReady = !!localAudio

  // ==================== 渲染（V2.0：简化） ====================
  return (
    <div className="video-panel">
      <div className="video-panel-head" onClick={onToggle}>
        <span className="video-panel-title">视频生成（V2.0 Agent 优先）</span>
        <span className="video-panel-toggle">{open ? '收起' : '展开'}</span>
      </div>
      <div className={`video-panel-body${open ? '' : ' video-panel-body--closed'}`}>

      <McpStatusBar />

      {/* agent 模式：网页只做「音频上传 + 确认页面信息」，其余由 agent 驱动 */}
      <div className="video-pipeline-status">
        <p className="hint-text hint-text--muted">
          对话脚本、头像与名称已在上方编排区设定（以它为准）。请生成配音后上传 MP3，
          点击「确认页面信息」交给 AI 助手完成音画同步、时间轴与动效，最终合成视频。
        </p>

        {/* 曲风提示词（复制去 Suno / 妙响 等生成配音） */}
        <div className="video-field">
          <label>配音曲风提示词</label>
          <div className="btn-row">
            <select
              className="ai-preset"
              value={voiceStyleId}
              onChange={(e) => setVoiceStyleId(e.target.value)}
            >
              {VOICE_STYLES.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button type="button" className="btn btn-secondary" onClick={() => copyVoicePrompt()}>
              复制曲风提示词
            </button>
          </div>
          {voicePromptStatus && <p className="hint-text">{voicePromptStatus}</p>}
        </div>

        {/* 音频上传（真实路径由 MCP Server 落盘产生，再交 agent 读取） */}
        <div className="video-field">
          <label>上传配音 MP3</label>
          <label className="video-file-pick">
            <span className="video-file-pick-text">
              {localAudio ? `已选择：${localAudio.name}（点击更换）` : '点击选择音频文件（MP3）'}
            </span>
            <input type="file" accept="audio/mpeg,audio/mp3,.mp3,.wav,.m4a,.ogg" onChange={onAudioPick} hidden />
          </label>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              {mcpAvailable
                ? <span style={{ color: '#07c160' }}>🟢 MCP 已连接（音频将由本地引擎处理）</span>
                : <span style={{ color: '#999' }}>⚪ MCP 离线，请先启动本地后端</span>}
            </span>
          </div>
        </div>

        {/* 确认页面信息 → 回调 MCP Server → agent 轮询拿到（agent 收到 page_confirmed 前不会动） */}
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirmPage}
            disabled={submitting || !localAudio}
            title={!localAudio ? '请先上传配音 MP3 再确认' : ''}
          >
            {submitting ? '提交中…' : '确认页面信息'}
          </button>
        </div>
        {!localAudio && !submitted && (
          <p className="hint-text" style={{ color: '#b45309' }}>⚠️ 请先上传配音 MP3（本工具不内置 TTS），再点「确认页面信息」。</p>
        )}
        {submitError && <p className="hint-text" style={{ color: '#b91c1c' }}>{submitError}</p>}
        {submitted && (
          <div className="pipeline-step-card" style={{ marginTop: 8 }}>
            <div className="pipeline-step-name">提交状态</div>
            <div className="pipeline-step-state">
              {agentState?.page_confirmed || agentState?.status || agentState?.current_step
                ? '✅ 已提交，AI 助手正在处理（音画同步 / 时间轴 / 动效 / 渲染）…'
                : '⏳ 已提交，等待 AI 助手读取…（若长时间无响应，请确认 MCP 已连接）'}
            </div>
            <p className="hint-text hint-text--muted" style={{ marginTop: 6 }}>
              ⚠️ 本页面只负责上传配音与确认；视频生成进度与最终文件路径由 AI 助手在对话中返回，此处不会显示"视频已生成"。
            </p>
          </div>
        )}

        {/* agent 进度回显（轮询 pipeline_state.json） */}
        {submitted && agentState && (
          <div className="video-field">
            <label>AI 助手处理进度</label>
            <div className="pipeline-step-card">
              <div className="pipeline-step-name">{agentState.current_step || '—'}</div>
              <div className="pipeline-step-state">
                状态：{agentState.status || (agentState.page_confirmed ? 'agent 已接收' : '等待')}
                {agentState.needs_review && '（需 AI 语义干预）'}
              </div>
              {agentState.asr_quality_score != null && (
                <div className="pipeline-step-desc">ASR 质量分：{agentState.asr_quality_score} · 对齐模式：{agentState.alignment_mode || '—'}</div>
              )}
            </div>
            <p className="hint-text hint-text--muted" style={{ marginTop: 6 }}>
              生成中的进度如上；最终视频路径会在 AI 助手对话里返回，请在那里查看，不要在本页面等待结果。
            </p>
          </div>
        )}
      </div>

      </div>
    </div>
  )
}

// ==================== 工具函数 ====================

function resolveTiming(messages, timeline) {
  let offset = 0
  if (timeline && timeline.length > 0 && timeline.length < messages.length &&
      (messages[0]?.type === 'time' || messages[0]?.type === 'system')) {
    offset = 1
  }
  let cursor = 0
  return messages.map((m, i) => {
    const tl = timeline?.[i - offset]
    if (tl && Number.isFinite(tl.display_start)) {
      return { ds: tl.display_start, de: tl.display_end }
    }
    const len = (m.content || m.text || '').length
    const d = Math.min(12, Math.max(1.5, len / 7 + 1))
    const ds = cursor
    const de = cursor + d
    cursor = de + 0.4
    return { ds, de }
  })
}

function buildDecisionPrompt(messages, stickers) {
  const list = messages.map((m, i) => ({
    index: i, speaker: m.speaker || 'A', content: m.content || m.text || '',
  }))
  return `你是一个短视频贴纸与入场动画决策助手。给定聊天对话（每条含 speaker 与 content）以及可用的贴纸文件名列表，请为每条消息判断：
- emotion：情绪标签，取值 happy / sad / angry / surprise / neutral
- sticker：从给定贴纸列表中选一个最贴合消息语义的文件名；若没有合适的，填空字符串 ""
- effect：入场动画，取值 pop_in / slide_in_left / slide_in_right / fade_in
只输出一个 JSON 数组，元素顺序与输入消息一一对应，不要任何解释、不要 markdown 代码块。

对话：
${JSON.stringify(list, null, 2)}

贴纸列表：
${JSON.stringify(stickers)}

输出格式示例：
[{"emotion":"angry","sticker":"angry_01.png","effect":"pop_in"}, ...]`
}
