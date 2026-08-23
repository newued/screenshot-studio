// SCRIPT 步骤（V1.1 第 4.1 节）：提示词 → AI 生成脚本 → 用户确认/编辑
// 三种输入方式：① AI 生成（复制提示词给 codex/codebuddy → 导入 JSON）
//               ② 手动编辑（当前脚本编辑器，script 来自父组件）
//               ③ 深链接直传（?script=）
import React, { useState } from 'react'
import { buildScriptPrompt, scriptJsonToText } from '../../../lib/scriptPrompt'
import { copyText } from '../../../lib/clipboard'

export default function ScriptSection({
  mode = 'single',
  speakerNames = [],
  script = '',          // 当前脚本文本（来自 ScriptEditor）
  scriptPromptStatus = '',
  onCopyScriptPrompt,
  onScriptJsonImport,   // (scriptText) => void
  onScriptJsonChange,   // (e) => void  file input handler
}) {
  const [userPrompt, setUserPrompt] = useState('')
  const [localStatus, setLocalStatus] = useState('')

  const handleCopyPrompt = async () => {
    if (!userPrompt.trim()) {
      setLocalStatus('请先输入对话描述')
      return
    }
    const prompt = buildScriptPrompt(userPrompt.trim(), mode, speakerNames)
    try {
      await copyText(prompt)
      setLocalStatus('已复制脚本生成提示词，粘贴给 codex / codebuddy 生成后导入 JSON')
      onCopyScriptPrompt?.()
    } catch {
      setLocalStatus('复制失败，请手动复制')
      console.log(prompt)
    }
  }

  const handleImport = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        const text = scriptJsonToText(data)
        if (text) {
          onScriptJsonImport(text)
          setLocalStatus(`已导入 AI 生成的脚本（${data.messages?.length || 0} 条消息）`)
        } else {
          setLocalStatus('脚本 JSON 解析成功但无消息内容')
        }
      } catch (err) {
        setLocalStatus('脚本 JSON 解析失败')
        console.error('脚本 JSON 解析失败', err)
      }
    }
    reader.readAsText(file)
    // 清空 input 以便重复选择同一文件
    e.target.value = ''
  }

  return (
    <div className="video-section video-section--open">
      {/* AI 脚本生成 */}
      <div className="video-field">
        <label>AI 生成脚本（推荐）</label>
        <p className="hint-text">
          输入对话描述 → 复制提示词给 codex / codebuddy → AI 生成脚本 JSON → 导入应用。
          也可直接在上方脚本编辑器手动编写。
        </p>
        <textarea
          className="script-prompt-input"
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          placeholder={
            mode === 'group'
              ? '例：三个同事讨论周末聚餐，有人提议吃火锅，有人想吃烧烤，最后投票决定…'
              : '例：两个人聊周末计划，约吃饭看电影，有转账和语音消息…'
          }
          rows={3}
        />
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={handleCopyPrompt}>
            复制脚本提示词给 AI
          </button>
          <label className="video-file-pick video-file-pick--inline">
            <span className="video-file-pick-text">导入脚本 JSON</span>
            <input type="file" accept=".json,application/json" onChange={handleImport} hidden />
          </label>
        </div>
        {(localStatus || scriptPromptStatus) && (
          <p className="hint-text">{localStatus || scriptPromptStatus}</p>
        )}
      </div>

      {/* 当前脚本预览 */}
      <div className="video-field">
        <label>当前脚本</label>
        <div className="script-preview-box">
          {script ? (
            <pre className="script-preview-text">{script}</pre>
          ) : (
            <p className="hint-text">暂无脚本，请在上方编辑器中编写或用 AI 生成</p>
          )}
        </div>
      </div>
    </div>
  )
}
