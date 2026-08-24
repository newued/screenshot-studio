// 视频生成面板（V1.1 改造）：队列式人机协同工作流
// 状态机：SCRIPT → VOICEOVER → TIMELINE → SEMANTIC → RENDER
// 每步 PENDING → AWAIT_CONFIRM → CONFIRMED，可回退/编辑/继续
// 产物即契约：每步输出结构化 JSON，下一步只读该 JSON
// 深链接兼容：?script=&audio=&timeline=&decisions=&export= 一键自动出片
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { decideSemantics, resolveDecisions } from '../../lib/semantic'
import { transcribeAndAlign } from '../../lib/asrBrowser'
import { checkMcpStatus, mcpTranscribe, mcpAlignDP, mcpAlignDPFile, mcpSubmitPage, fetchPipelineState } from '../../lib/mcpClient'
import { alignDP, mappingToTimeline } from '../../lib/dpAlign'
import { renderChatVideoMP4 } from '../../lib/mp4Renderer'
import { createChatFrameRenderer } from '../../lib/canvasChat'
import McpStatusBar from '../video/McpStatusBar'
import { VOICE_STYLES, buildVoicePrompt } from '../../lib/voicePrompt'
import { buildTimelinePrompt } from '../../lib/timelinePrompt'
import { copyText } from '../../lib/clipboard'
import { ts } from '../../lib/time'
import { toast } from './Toast'
import {
  initState, loadState, saveState, confirmStep, backToStep,
  STEP_STATUS, STEP_LABELS, STEP_DESCRIPTIONS,
} from '../../lib/pipelineState'
import { buildScriptArtifact } from '../../lib/scriptPrompt'

// V1.1 步骤组件
import VideoStepBar from './video/VideoStepBar'
import ScriptSection from './video/ScriptSection'
import VoiceoverSection from './video/VoiceoverSection'
import TimelineReviewSection from './video/TimelineReviewSection'
import SemanticReviewSection from './video/SemanticReviewSection'

export default function VideoPipelinePanel({
  messages = [],
  members = [],
  platform = 'wechat',
  mode = 'single',
  projectTitle = '微信对话',
  script = '',
  onScriptChange = () => {},
  autoRun = '',
  initialDecisions = null,
  initialTimeline = null,
  initialAudio = '',
  open = true,
  onToggle,
}) {
  // ==================== 草稿持久化 ====================
  const draftKey = `draft:video:${platform}:${mode}`
  const pipelineKey = `pipeline:${platform}:${mode}`
  const readDraft = () => {
    try {
      return JSON.parse(localStorage.getItem(draftKey) || 'null') || {}
    } catch {
      return {}
    }
  }

  // ==================== 管线状态机（V1.1 核心） ====================
  const [pipelineState, setPipelineState] = useState(() => {
    const saved = loadState(pipelineKey)
    if (saved) return saved
    return initState(`p_${Date.now()}`, mode)
  })

  // 持久化管线状态
  useEffect(() => {
    saveState(pipelineKey, pipelineState)
  }, [pipelineKey, pipelineState])

  // 确认当前步骤并推进
  const handleConfirm = useCallback((artifact = null) => {
    setPipelineState((prev) => {
      const step = prev.current_step
      const art = artifact || prev.steps[step]?.artifact
      return confirmStep(prev, art)
    })
  }, [])

  // 回退到指定步骤
  const handleBack = useCallback((stepName) => {
    setPipelineState((prev) => backToStep(prev, stepName))
  }, [])

  // 步骤条点击：仅允许跳到已确认或当前步骤
  const onStepClick = useCallback((stepName) => {
    const s = pipelineState.steps[stepName]
    if (!s) return
    const isConfirmed = s.status === STEP_STATUS.CONFIRMED || s.status === STEP_STATUS.DONE
    const isCurrent = pipelineState.current_step === stepName
    if (isConfirmed || isCurrent) {
      setPipelineState((prev) => ({ ...prev, current_step: stepName }))
    }
  }, [pipelineState])

  // ==================== 状态（音频/时间轴/决策等） ====================
  const [audioFile, setAudioFile] = useState(null)
  const [audioName, setAudioName] = useState(() => readDraft().audioName || '')
  const [audioDuration, setAudioDuration] = useState(() => readDraft().audioDuration || '')
  const [title, setTitle] = useState(() => readDraft().title || projectTitle)
  const [busy, setBusy] = useState(false)
  const [timeline, setTimeline] = useState(null)
  const [timelineInfo, setTimelineInfo] = useState('')
  const [decisions, setDecisions] = useState(() => readDraft().decisions || initialDecisions || null)
  const [decisionsInfo, setDecisionsInfo] = useState(() => {
    const saved = readDraft().decisions
    if (saved) return `已恢复 ${saved.length} 条决策`
    return initialDecisions ? `已载入 ${initialDecisions.length} 条决策` : ''
  })
  const [asrStatus, setAsrStatus] = useState('')
  // 网页只展示的「识别与对齐进度%（0-100）」，由 agent/大模型后台对齐驱动
  const [alignProgress, setAlignProgress] = useState(0)
  // AI（agent 大模型）语义仲裁完成标记：说唱/演唱等 ASR 不稳、needs_review=true 时由 agent 修正后置 true
  const [reviewReady, setReviewReady] = useState(false)
  // 识别模型强制自动选择（不暴露给用户切换）：
// 主路径走 MCP（服务端 faster-whisper small，精度最优）；
// 浏览器离线兜底也强制用 small（而非 tiny），精度优先，且浏览器 Cache API 仅首次下载一次。
const BROWSER_ASR_MODEL = 'Xenova/whisper-small'
  const [promptStatus, setPromptStatus] = useState('')
  const [voiceStyleId, setVoiceStyleId] = useState(() => readDraft().voiceStyleId || 'gospel-funk')
  const [voicePromptStatus, setVoicePromptStatus] = useState('')
  const [timelinePromptStatus, setTimelinePromptStatus] = useState('')
  const [scriptPromptStatus, setScriptPromptStatus] = useState('')
  const [mcpAvailable, setMcpAvailable] = useState(false)
  const [asrEngine, setAsrEngine] = useState('')
  // V1.1 节拍网格 + DP 对齐状态
  const [beatGridInfo, setBeatGridInfo] = useState(null)  // { bpm, beat_count, duration, method }
  const [beatGrid, setBeatGrid] = useState(null)          // number[] 节拍时间数组
  const [mappingResult, setMappingResult] = useState(null)     // DP mapping 数组
  const [mappingMeta, setMappingMeta] = useState(null)         // DP mapping_meta
  const [alignmentMode, setAlignmentMode] = useState('')       // 'beat_grid' | 'asr_enhanced'
  const [asrQualityScore, setAsrQualityScore] = useState(0)
  const didAuto = useRef(false)
  const exportLockRef = useRef({ mp4: false, project: false })
  const [mp4Busy, setMp4Busy] = useState(false)
  const [mp4Progress, setMp4Progress] = useState(0)
  const [injectedTimeline, setInjectedTimeline] = useState(initialTimeline)
  const [injectedAudio, setInjectedAudio] = useState(initialAudio)

  // ==================== agent 模式：网页只做音频上传 + 确认页面信息 ====================
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [agentState, setAgentState] = useState(null) // 轮询 pipeline_state.json
  // 本地选中的音频文件（仅用于上传，真实路径由 server 落盘产生）
  const [localAudio, setLocalAudio] = useState(null)
  // 头像 / 名称 / 主题 一律以「上方编排区」为准（members/title 来自 props），面板不再重复编辑。

  // ref 镜像
  const decisionsRef = useRef(decisions)
  useEffect(() => { decisionsRef.current = decisions }, [decisions])
  const audioDurationRef = useRef(audioDuration)
  useEffect(() => { audioDurationRef.current = audioDuration }, [audioDuration])
  const timelineRef = useRef(timeline)
  useEffect(() => { timelineRef.current = timeline }, [timeline])
  const exportMp4Ref = useRef(null)
  const pipelineStateRef = useRef(pipelineState)
  useEffect(() => { pipelineStateRef.current = pipelineState }, [pipelineState])

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

  // 决策合并后的消息
  const mergedMessages = useMemo(() => resolveDecisions(messages, decisions), [messages, decisions])

  // ==================== 草稿自动保存 ====================
  const [savedAt, setSavedAt] = useState(() => {
    try { return localStorage.getItem(`${draftKey}:ts`) || null } catch { return null }
  })
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey)
      localStorage.removeItem(`${draftKey}:ts`)
      localStorage.removeItem(pipelineKey)
      setSavedAt(null)
      setPipelineState(initState(`p_${Date.now()}`, mode))
      toast.success('草稿与管线状态已清除')
    } catch { /* ignore */ }
  }, [draftKey, pipelineKey, mode])

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        audioName, audioDuration, title, decisions, voiceStyleId,
      }))
      const now = new Date().toLocaleString('zh-CN')
      localStorage.setItem(`${draftKey}:ts`, now)
      setSavedAt(now)
    } catch { /* 存储满时忽略 */ }
  }, [draftKey, audioName, audioDuration, title, decisions, voiceStyleId])

  // ==================== 事件处理 ====================

  // 导入决策 JSON
  const onDecisionsChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        const arr = Array.isArray(data) ? data : data.decisions
        if (!Array.isArray(arr)) throw new Error('缺少决策数组')
        setDecisions(arr)
        setDecisionsInfo(`已导入 ${arr.length} 条决策`)
      } catch (err) {
        setDecisions(null)
        setDecisionsInfo('决策 JSON 解析失败')
        console.error('决策 JSON 解析失败', err)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // 导入时间轴 JSON
  const onTimelineChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        const msgs = Array.isArray(data.messages) ? data.messages : data
        if (!Array.isArray(msgs)) throw new Error('缺少 messages 数组')
        setTimeline(msgs)
        setTimelineInfo(`已导入 ${msgs.length} 条时间轴`)
      } catch (err) {
        setTimeline(null)
        setTimelineInfo('时间轴 JSON 解析失败')
        console.error('时间轴 JSON 解析失败', err)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // 选择配音文件
  const onAudioChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAudioFile(file)
    setAudioName(file.name)
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(String(Math.round(audio.duration * 10) / 10))
      }
      URL.revokeObjectURL(url)
    }, { once: true })
    audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true })

    // 构建脚本文本（MCP 需要）
    const scriptText = messages.map(m => {
      if (m.type === 'time') return `[${m.content}]`
      if (m.type === 'system') return `[系统]${m.content}`
      return `${m.speaker || 'A'}说：${m.content}`
    }).join('\n')

    setAsrStatus('识别语音中…（首次需下载模型）')
    setAlignProgress(0)
    try {
      let tl, adur

      // 主路径：MCP Server（Python faster-whisper + librosa，模型本地缓存一次）
      // 浏览器上传的音频以 base64 发给 MCP Server 运行；只有当 MCP 不可用
      // 或强制浏览器模式时才退回浏览器 WASM（同样有本地缓存，不会每次下载）。
      // 关键：MCP 任意环节失败（缺依赖 / 离线）都要退回浏览器管道，绝不能死路。
      let result
      if (mcpAvailable) {
        try {
          setAsrStatus('MCP Server: librosa 节拍提取 + faster-whisper ASR + 大模型语义对齐…（中间产物由 AI 在后台完成）')
          setAsrEngine('mcp')
          result = await mcpAlignDPFile(
            file,
            scriptText,
            {
              model: 'small',
              onProgress: (p) => {
                const pct = (p?.status === 'progress' && p.total) ? Math.round((p.loaded / p.total) * 100) : (typeof p?.progress === 'number' ? Math.round(p.progress * 100) : null)
                if (pct != null) setAlignProgress(pct)
              },
            }
          )
          setAlignProgress(100)
          tl = result.timeline
          adur = result.duration

          // 填充节拍网格和 DP 对齐结果
          if (result.beat_grid) {
            setBeatGrid(result.beat_grid)
            setBeatGridInfo(result.grid_meta)
          }
          if (result.mapping) {
            setMappingResult(result.mapping)
            setMappingMeta(result.mapping_meta)
          }
          // 自动对齐存在 unmatched/ambiguous（说唱/演唱等）→ 标记待 AI 语义仲裁
          setReviewReady(false)
          if (result.mapping_meta?.needs_review) setAlignProgress(100)
          setAlignmentMode(result.alignment_mode || 'beat_grid')
          setAsrQualityScore(result.asr_quality_score || 0)
        } catch (mcpErr) {
          // MCP 失败（如缺 librosa / faster-whisper）→ 退回浏览器离线管道，不抛死
          console.warn('[ASR] MCP 失败，退回浏览器离线管道', mcpErr)
          setAsrStatus('MCP 不可用，退回浏览器离线：能量法节拍网格 + DP 全局对齐…（无需下载模型）')
          setAsrEngine('browser')
          result = await transcribeAndAlign(file, messages, setAsrStatus, (p) => {
            if (p?.status === 'progress' && p.total) {
              const pct = Math.round((p.loaded / p.total) * 100)
              setAsrStatus(`下载模型 ${pct}%`)
              setAlignProgress(pct)
            }
          }, BROWSER_ASR_MODEL)
          tl = result.timeline
          adur = result.audioDuration
          setBeatGrid(result.beatGrid || [])
          setBeatGridInfo(result.gridMeta || null)
          setMappingResult(result.mapping || null)
          setMappingMeta(result.mappingMeta || null)
          setAlignmentMode(result.alignmentMode || 'beat_grid')
          setAsrQualityScore(result.asrQualityScore || 0)
          if (result.usedFallback) {
            setAsrStatus(`已用节拍网格 + DP 生成卡点时间轴（${result.gridMeta?.beat_count || 0} 拍 / ${result.gridMeta?.bpm || 0} BPM）。${result.fallbackReason || ''} 如需更高精度可导入「AI 精修时间轴」。`)
          }
        }
      } else {
        // 离线兜底：浏览器节拍网格 + (可选)WASM ASR + DP 全局对齐
        setAsrStatus('浏览器离线：能量法节拍网格 + DP 全局对齐…（模型经浏览器缓存，仅首次下载一次）')
        setAsrEngine('browser')
        result = await transcribeAndAlign(file, messages, setAsrStatus, (p) => {
          if (p?.status === 'progress' && p.total) {
            const pct = Math.round((p.loaded / p.total) * 100)
            setAsrStatus(`下载模型 ${pct}%`)
          }
        }, BROWSER_ASR_MODEL)
        tl = result.timeline
        adur = result.audioDuration
        // 填充节拍网格与 DP 对齐产物（与 MCP 路径对齐，复用同一套 UI 展示）
        setBeatGrid(result.beatGrid || [])
        setBeatGridInfo(result.gridMeta || null)
        setMappingResult(result.mapping || null)
        setMappingMeta(result.mappingMeta || null)
        setAlignmentMode(result.alignmentMode || 'beat_grid')
        setAsrQualityScore(result.asrQualityScore || 0)
        if (result.usedFallback) {
          setAsrStatus(`已用节拍网格 + DP 生成卡点时间轴（${result.gridMeta?.beat_count || 0} 拍 / ${result.gridMeta?.bpm || 0} BPM）。${result.fallbackReason || ''} 如需更高精度可导入「AI 精修时间轴」。`)
        }
      }
      setTimeline(tl)
      setTimelineInfo(`已自动生成时间轴 ${tl.length} 条`)
      if (adur) setAudioDuration(String(Math.round(adur * 10) / 10))
      setAlignProgress(100)
      // 仅当 ASR 成功（非退化）时清空状态；退化提示需保留给用户
      if (!result?.usedFallback) setAsrStatus('')
    } catch (err) {
      console.error('ASR 失败', err)
      setAlignProgress(0)
      setAsrStatus(`自动识别失败：${err?.message || err}。可改用「AI 精修时间轴」导入。`)
    }
  }

  // 视频模式：用户在网页选音频文件（本地真实路径不可得，故由 server 落盘产生）
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
      // 以「上方编排区」为准：title/members/messages 全部取自 props（同一数据源）
      const res = await mcpSubmitPage({
        audioBase64: dataUrl,
        audioName: localAudio.name,
        title: projectTitle,
        messages,
        members,
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
  }, [localAudio, messages, members, title, projectTitle])

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

  // 复制配音提示词
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

  // 复制决策提示词
  const copyDecisionPrompt = useCallback(async () => {
    if (!messages.length) return
    setPromptStatus('生成提示词…')
    let stickers = []
    try {
      const res = await fetch('/emojis/index.json')
      if (res.ok) stickers = await res.json()
    } catch { /* */ }
    const prompt = buildDecisionPrompt(messages, stickers)
    try {
      await copyText(prompt)
      setPromptStatus('已复制决策提示词，粘贴给 codebuddy / codex 生成后导入 JSON')
    } catch { setPromptStatus('复制失败，请手动复制提示词') }
  }, [messages])

  // 一键用内置规则生成决策
  const runBuiltin = useCallback(() => {
    if (!messages.length) return
    const d = decideSemantics(messages)
    setDecisions(d)
    setDecisionsInfo(`已用内置规则生成 ${d.length} 条决策`)
  }, [messages])

  // 复制时间轴提示词
  const copyTimelinePrompt = useCallback(async () => {
    if (!messages.length) return
    const prompt = buildTimelinePrompt(messages, audioName)
    try {
      await copyText(prompt)
      setTimelinePromptStatus('已复制时间轴提示词，粘贴给 codex / codebuddy 生成后导入 JSON')
    } catch { setTimelinePromptStatus('复制失败，请手动复制提示词') }
  }, [messages, audioName])

  // 下载配音音频
  const downloadAudio = useCallback(() => {
    if (!audioFile) return
    const url = URL.createObjectURL(audioFile)
    const a = document.createElement('a')
    a.href = url
    a.download = audioName || 'voice.mp3'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [audioFile, audioName])

  // ==================== 渲染引擎 ====================
  const chatRendererRef = useRef(null)
  const getChatRenderer = useCallback(() => {
    if (!chatRendererRef.current) {
      chatRendererRef.current = createChatFrameRenderer({
        title: title || projectTitle,
        project: { platform, mode, members },
      })
    }
    return chatRendererRef.current
  }, [title, projectTitle, platform, mode, members])

  const renderFrame = useCallback((t) => {
    const timing = resolveTiming(mergedMessages, timeline)
    return getChatRenderer().render(t, {
      messages: mergedMessages, members, platform, mode,
      title: title || projectTitle, timing,
    })
  }, [mergedMessages, members, platform, mode, title, projectTitle, timeline, getChatRenderer])

  // ==================== 导出 ====================
  const exportMp4 = useCallback(async () => {
    if (exportLockRef.current.mp4) return
    if (!mergedMessages.length) return
    exportLockRef.current.mp4 = true
    setMp4Busy(true)
    setMp4Progress(0)
    try {
      await getChatRenderer().preload(mergedMessages, members)
      const timing = resolveTiming(mergedMessages, timeline)
      const dur = audioDuration !== '' && audioDuration != null
        ? Number(audioDuration)
        : Math.max(...timing.map((x) => x.de), 10)
      const blob = await renderChatVideoMP4({
        project: { duration: dur, audioFile: audioFile || null },
        renderFrame,
        onProgress: (p) => setMp4Progress(Math.round(p * 100)),
      })
      if (!blob || blob.size === 0) throw new Error('生成的视频文件为空')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title || projectTitle}-${ts()}.mp4`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast.success('MP4 视频已导出')
    } catch (err) {
      console.error('导出 MP4 失败', err)
      toast.error(`导出 MP4 失败：${err.message}`)
    } finally {
      exportLockRef.current.mp4 = false
      setMp4Busy(false)
    }
  }, [mergedMessages, timeline, audioDuration, audioFile, title, projectTitle, renderFrame])



  useEffect(() => { exportMp4Ref.current = exportMp4 }, [exportMp4])

  // ==================== 深链接 / AI 直传自动模式 ====================
  useEffect(() => {
    if (!autoRun && !injectedTimeline && !injectedAudio) return

    const run = async () => {
      // 1. 时间轴直传
      if (injectedTimeline && Array.isArray(injectedTimeline)) {
        setTimeline(injectedTimeline)
        setTimelineInfo(`已由 AI 直传时间轴 ${injectedTimeline.length} 条`)
      }

      // 2. 音频直传
      if (injectedAudio) {
        try {
          const res = await fetch(injectedAudio, { mode: 'cors' })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          const name = decodeURIComponent(injectedAudio.split('/').pop() || 'voice.mp3')
          const file = new File([blob], name, { type: blob.type || 'audio/mpeg' })
          setAudioFile(file)
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
          toast.error('AI 直传音频加载失败，将输出静音视频')
        }
      }

      // 3. 自动导出
      if (autoRun === 'video' || autoRun === 'mp4') {
        const waitUntil = (fn, timeout = 12000) =>
          new Promise((resolve) => {
            const start = Date.now()
            const check = () => {
              if (fn() || Date.now() - start > timeout) resolve()
              else setTimeout(check, 50)
            }
            check()
          })
        if (!decisionsRef.current) {
          try {
            const d = decideSemantics(messages)
            setDecisions(d)
            setDecisionsInfo(`已自动用内置规则生成 ${d.length} 条决策`)
          } catch { /* */ }
        }
        await waitUntil(() => decisionsRef.current !== null)
        if (injectedAudio) {
          await waitUntil(() => audioDurationRef.current !== '', 8000)
        }
        await exportMp4Ref.current?.()
      }
    }

    const t = setTimeout(() => {
      if (didAuto.current) return
      didAuto.current = true
      run()
    }, 300)
    return () => clearTimeout(t)
  }, [autoRun, injectedTimeline, injectedAudio, messages])

  // ==================== 各步骤确认门 ====================

  // SCRIPT 确认：生成 script.json 产物
  const confirmScript = useCallback(() => {
    const artifact = buildScriptArtifact({
      mode, title: title || projectTitle, speakers: members, messages, prompt: '',
    })
    handleConfirm(artifact)
  }, [mode, title, projectTitle, members, messages, handleConfirm])

  // VOICEOVER 确认：生成 voiceover.json 产物（V1.1 含节拍网格+DP mapping）
  const confirmVoiceover = useCallback(() => {
    const artifact = {
      audio_path: audioName,
      duration: audioDuration ? Number(audioDuration) : 0,
      alignment_mode: alignmentMode || (asrEngine === 'mcp' ? 'asr_enhanced' : 'beat_grid'),
      asr: asrEngine === 'mcp' ? 'whisperX' : 'whisper-browser',
      asr_quality_score: asrQualityScore,
      beat_grid: beatGrid || [],
      grid_meta: beatGridInfo || null,
      mapping: mappingResult || [],
      adlib_spans: [],
      mapping_meta: mappingMeta || { needs_review: false },
      timeline: timeline || [],
    }
    handleConfirm(artifact)
  }, [audioName, audioDuration, alignmentMode, asrEngine, asrQualityScore, beatGrid, beatGridInfo, mappingResult, mappingMeta, timeline, handleConfirm])

  // TIMELINE 确认：生成 timeline.json 产物
  const confirmTimeline = useCallback(() => {
    const timing = resolveTiming(mergedMessages, timeline)
    const artifact = {
      mode,
      total_duration: audioDuration ? Number(audioDuration) : 0,
      tracks: mergedMessages.map((m, i) => ({
        message_id: i,
        enter_at: timing[i].ds,
        exit_at: timing[i].de,
        speaker: m.speaker || 'A',
        layout: mode === 'single' ? 'left' : (m.speaker === 'A' ? 'left' : 'right'),
        text: m.content || m.text || '',
        match_type: 'exact',
        adlib: false,
        source: timeline ? 'rap_span' : 'estimated',
        locked: false,
      })),
    }
    handleConfirm(artifact)
  }, [mode, audioDuration, mergedMessages, timeline, handleConfirm])

  // SEMANTIC 确认：生成 effects.json 产物
  const confirmSemantic = useCallback(() => {
    const artifact = {
      insertions: (decisions || []).map((d, i) => ({
        id: i + 1,
        at_message: i,
        layer: 'sticker',
        kind: d.sticker || 'none',
        params: { emotion: d.emotion || 'neutral', effect: d.effect || 'fade_in' },
      })),
    }
    handleConfirm(artifact)
  }, [decisions, handleConfirm])

  // ==================== 当前步骤 ====================
  const currentStep = pipelineState.current_step
  const steps = pipelineState.steps

  // 步骤完成判断
  const scriptReady = messages.length > 0
  const voiceoverReady = !!audioFile
  const timelineReady = !!timeline
  const semanticReady = !!(decisions || decisionsInfo.includes('内置规则'))

  // ==================== 渲染 ====================
  return (
    <div className="video-panel">
      <div className="video-panel-head" onClick={onToggle}>
        <span className="video-panel-title">视频生成（V1.1 管线）</span>
        <span className="video-panel-toggle">{open ? '收起' : '展开'}</span>
      </div>
      <div className={`video-panel-body${open ? '' : ' video-panel-body--closed'}`}>

      <McpStatusBar />

      {savedAt && (
        <div className="video-draft-notice">
          <span>已恢复草稿（{savedAt}）</span>
          <button onClick={clearDraft} className="btn btn-text btn-sm">清除</button>
        </div>
      )}

      {/* 状态机步骤条 */}
      <VideoStepBar
        currentStep={currentStep}
        steps={steps}
        onStepClick={onStepClick}
      />

      {/* 步骤状态提示 */}
      <div className="video-step-status">
        当前：{STEP_LABELS[currentStep] || currentStep}
        {steps[currentStep]?.edited && <span className="video-step-edited">（已编辑，需重新确认）</span>}
      </div>

      {/* agent 模式：网页只做「音频上传 + 确认页面信息」，其余由 agent 驱动 */}
      {/* 注意：对话主题 / 人物名称 / 头像 全部以「上方编排区」为准，面板不做重复编辑 ——
          上方改了，提交时随 messages/members/title 一并传给 agent，保持单一数据源。 */}
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
              ⚠️ 本页面只负责上传配音与确认；视频生成进度与最终文件路径由 AI 助手在对话中返回，此处不会显示“视频已生成”。
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
