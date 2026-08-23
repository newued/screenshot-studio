import React, { useRef, useState, useEffect, useCallback } from 'react'
import { createChatFrameRenderer } from '../../lib/canvasChat'

/**
 * 实时动效预览组件
 * 复用 canvasChat 渲染管线，支持播放/暂停/拖动进度条、音频同步。
 * Props: messages, timeline, platform, mode, members, title, audioFile, audioDuration
 */
export default function VideoPreview({
  messages = [],
  timeline = [],
  platform = 'wechat',
  mode = 'single',
  members = [],
  title = '',
  audioFile = null,
  audioDuration = 0,
}) {
  const canvasRef = useRef(null)
  const audioRef = useRef(null)
  const rendererRef = useRef(null)
  const rafRef = useRef(null)
  const startTimeRef = useRef(null)
  const startTRef = useRef(0)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [ready, setReady] = useState(false)

  // 总时长：音频时长 > 时间轴最后 de > 30s 兜底
  const totalDuration = audioDuration || (timeline.length > 0 ? Math.max(...timeline.map(t => t.de)) : 30)

  // 计算每帧 timing（复用 resolveTiming 逻辑）
  const timing = (() => {
    if (timeline && timeline.length > 0) {
      return messages.map((m, i) => {
        const t = timeline[i]
        return t ? { ds: t.display_start, de: t.display_end } : { ds: 0, de: 0 }
      })
    }
    // 兜底：按字数均分
    let cursor = 0
    return messages.map((m) => {
      const d = Math.min(12, Math.max(1.5, (m.content || '').length / 7 + 1))
      const ds = cursor
      const de = cursor + d
      cursor = de + 0.4
      return { ds, de }
    })
  })()

  // 渲染单帧
  const renderFrame = useCallback((t) => {
    const canvas = canvasRef.current
    if (!canvas || !messages.length) return

    const ctx = canvas.getContext('2d')
    if (!rendererRef.current) {
      rendererRef.current = createChatFrameRenderer({
        canvas, ctx, width: 1080, height: 1920,
      })
    }
    rendererRef.current.render(t, {
      messages, members, platform, mode,
      title: title || '微信对话',
      timing,
    })
  }, [messages, members, platform, mode, title, timing])

  // 预加载资源 → 渲染首帧
  useEffect(() => {
    if (!messages.length) return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = 1080
    canvas.height = 1920
    const ctx = canvas.getContext('2d')
    const renderer = createChatFrameRenderer({ canvas, ctx, width: 1080, height: 1920 })
    rendererRef.current = renderer

    renderer.preload(messages, members).then(() => {
      setReady(true)
      renderFrame(0)
    })
  }, [messages, members])

  // 动画循环
  const animate = useCallback((timestamp) => {
    if (!startTimeRef.current) {
      startTimeRef.current = timestamp
      startTRef.current = currentTime
    }
    const elapsed = (timestamp - startTimeRef.current) / 1000
    const t = Math.min(startTRef.current + elapsed, totalDuration)
    setCurrentTime(t)
    renderFrame(t)
    if (t < totalDuration) {
      rafRef.current = requestAnimationFrame(animate)
    } else {
      setPlaying(false)
    }
  }, [currentTime, totalDuration, renderFrame])

  // 播放/暂停
  const togglePlay = useCallback(() => {
    if (playing) {
      // 暂停
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (audioRef.current) audioRef.current.pause()
      setPlaying(false)
    } else {
      // 播放
      if (currentTime >= totalDuration) {
        // 从头开始
        setCurrentTime(0)
        startTRef.current = 0
        startTimeRef.current = null
      } else {
        startTimeRef.current = null
      }
      setPlaying(true)
      rafRef.current = requestAnimationFrame(animate)
      // 音频同步
      if (audioRef.current) {
        audioRef.current.currentTime = currentTime
        audioRef.current.play().catch(() => {})
      }
    }
  }, [playing, currentTime, totalDuration, animate])

  // 进度条拖动
  const onScrub = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const t = ratio * totalDuration
    setCurrentTime(t)
    renderFrame(t)
    if (audioRef.current) {
      audioRef.current.currentTime = t
    }
    if (playing) {
      // 重新从当前位置开始动画
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      startTimeRef.current = null
      rafRef.current = requestAnimationFrame(animate)
    }
  }, [totalDuration, renderFrame, playing, animate])

  // 卸载
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const fmt = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className="video-preview">
      {/* 音频元素（隐藏） */}
      {audioFile && (
        <audio ref={audioRef} src={URL.createObjectURL(audioFile)} preload="auto" />
      )}

      {/* 画布预览（缩放适配面板宽度） */}
      <div className="video-preview-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={1080}
          height={1920}
          style={{ width: '100%', height: 'auto', borderRadius: 8, background: '#000' }}
        />
        {!ready && <div className="video-preview-loading">加载中…</div>}
      </div>

      {/* 播放控制 */}
      <div className="video-preview-controls">
        <button
          className="btn btn-primary btn-sm"
          onClick={togglePlay}
          disabled={!ready || !messages.length}
        >
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <span className="video-preview-time">
          {fmt(currentTime)} / {fmt(totalDuration)}
        </span>
      </div>

      {/* 进度条 */}
      <div className="video-preview-progress" onClick={onScrub}>
        <div
          className="video-preview-progress-fill"
          style={{ width: `${(currentTime / totalDuration) * 100}%` }}
        />
      </div>

      {/* 消息时间轴（可选，辅助调试） */}
      {messages.length > 0 && (
        <div className="video-preview-timeline">
          {messages.slice(0, 20).map((m, i) => {
            const t = timing[i] || { ds: 0, de: 0 }
            const isActive = currentTime >= t.ds && currentTime < t.de
            return (
              <div
                key={i}
                className={`video-preview-timeline-item ${isActive ? 'active' : ''}`}
              >
                <span className="vptt-speaker">{m.speaker || '?'}</span>
                <span className="vptt-text">{(m.content || '').slice(0, 20)}{(m.content || '').length > 20 ? '…' : ''}</span>
                <span className="vptt-time">{fmt(t.ds)}–{fmt(t.de)}</span>
              </div>
            )
          })}
          {messages.length > 20 && (
            <div className="video-preview-timeline-item" style={{ color: '#999' }}>
              …共 {messages.length} 条消息
            </div>
          )}
        </div>
      )}
    </div>
  )
}
