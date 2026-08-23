// AI 生成助手：格式说明 + 可复制提示词（预设模板）+ 粘贴结果校验
import React, { useState } from 'react'
import { validateScript } from '../../lib/validateScript'
import { copyText } from '../../lib/clipboard'

const AI_PROMPT = `你是一个微信聊天对话脚本生成助手。请严格按下面格式输出一段微信对话，不要任何额外解释、不要序号、不要使用中文引号。

【格式规则】
- 每行一条消息，格式：说话人字母说：内容
- 说话人用单个英文字母：A=第1人（默认"我"），B=第2人，C=第3人……
- 单聊只用 A、B 两人；群聊可用 A、B、C 多人
- 特殊消息用方括号包裹：
  红包：A说：[红包：祝福语]
  收红包：A说：[收红包：已领取]
  转账：A说：[转账：金额，备注]（金额仅数字，如 200.00）
  收转账：A说：[收转账：金额]
  语音：A说：[语音：时长"]（时长如 5" 表示 5 秒）
  语音转文字：A说：[语音转文字：转写内容]
  视频已接：A说：[视频已接：00:30]
  视频未接：A说：[视频未接]
- 时间戳：单独一行 时间：下午 2:30
- 系统/撤回提示：系统：xxx 或 撤回：xxx

【要求】
1. 金额只写数字，不要加"元""￥"等符号。
2. 仅输出脚本文本本身，用换行分隔每条消息。

【示例（单聊）】
A说：在吗？今晚有空吗
B说：在的，怎么了
A说：上次说的方案明天要交了
B说：我晚上帮你看看
时间：下午 2:30
A说：[转账：200.00，上次的餐费]
B说：[收转账：200.00]
B说：收到，谢啦
A说：[语音：5"]

【示例（群聊）】
A说：在吗？周末一起吃饭吗
B说：在的，周六可以
C说：算我一个
时间：上午 9:41
A说：[红包：周末聚餐红包]
B说：[转账：200.00，AA餐费]
C说：[语音：3"]
A说：收到，周六见

请根据以上规则，生成一段关于「{主题}」的微信{单聊/群聊}对话。`

// 预设模板：黑色职场幽默 + 发疯吐槽（短视频爆款风格）
const OFFICE_RANT_PROMPT = `你是一个微信聊天对话脚本生成助手。请生成一段「黑色职场幽默 + 发疯吐槽」风格的短视频对话脚本，全程以手机微信聊天截图/录屏的视角呈现。严格按下面格式输出，不要任何额外解释、不要序号、不要使用中文引号。

【角色性格——强制执行】
主角：互联网小厂开发。
性格核心：敢于炸毛、敢于阴阳、敢于当面怼。不爽就直说，不合理就拒绝，逼急了就发疯。
严禁出现以下行为：唯唯诺诺、只说"好的收到"、全程被动承受。主角会用各种形式反击（阴阳怪气/直接拒绝/荒诞类比/摆烂式同意）。

【核心要求】
1. 全部内容以微信对话形式展开。
2. 对话全程纯文字，禁止语音消息。
3. 【强制】每条消息不超过30个字（含标点）。
4. 只能出现：消息文字、时间戳。
5. 禁止出现：情绪值、内心OS、动作描写、@某人、表情包。
6. 金句梗点结尾。最后一条消息必须是主角发出，不超过30字，自嘲式黑色幽默金句。
7. 必须要有故事情节感，充满剧本的跌宕起伏。

【格式规则】
- 每行一条消息，格式：说话人字母说：内容
- 说话人用单个英文字母：A=主角（默认"我"），B=第2人，C=第3人……
- 单聊只用 A、B 两人；群聊可用 A、B、C 多人
- 时间戳：单独一行 时间：下午 2:30
- 仅输出脚本文本本身，用换行分隔每条消息。

【示例】
A说：需求又改了，这次要五彩斑斓的黑
B说：客户说要有高级感
A说：高级感是吧，我给他整个赛博朋克墓碑风
时间：下午 3:00
A说：行，我改，改完我就去天台看风景
B说：别冲动
A说：放心，我恐高

请根据以上规则，生成一段关于「{主题}」的微信{单聊/群聊}对话。`

const PRESETS = [
  { id: 'generic', name: '通用对话', prompt: AI_PROMPT },
  { id: 'office-rant', name: '职场吐槽（黑色幽默）', prompt: OFFICE_RANT_PROMPT },
]

export default function AiPromptPanel({ members = [], onApply }) {
  const [presetId, setPresetId] = useState('generic')
  const [prompt, setPrompt] = useState(AI_PROMPT)
  const [result, setResult] = useState('')
  const [copied, setCopied] = useState(false)

  // 实时校验粘贴进来的脚本是否符合格式
  const v = validateScript(result, members)

  const switchPreset = (id) => {
    setPresetId(id)
    const p = PRESETS.find((x) => x.id === id)
    if (p) setPrompt(p.prompt)
  }

  const copyPrompt = async () => {
    try {
      await copyText(prompt)
      flashCopied()
    } catch {
      flashCopied()
    }
  }

  const flashCopied = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="ai-panel-inner">
      <div className="section-title">格式说明</div>
      <ul className="ai-guide">
        <li>每行一条消息：<code>X说：内容</code></li>
        <li>说话人 <code>A/B/C…</code> 对应第 1/2/3… 位成员（A 默认为"我"）</li>
        <li>单聊只用 <code>A、B</code>；群聊可多人 <code>A、B、C…</code></li>
        <li>红包 <code>[红包：祝福语]</code> · 转账 <code>[转账：金额，备注]</code></li>
        <li>语音 <code>[语音：5"]</code> · 收转账 <code>[收转账：金额]</code></li>
        <li>时间戳 <code>时间：下午 2:30</code> · 系统 <code>系统：xxx</code></li>
      </ul>

      <div className="section-title">AI 生成提示词</div>
      <p className="ai-hint">复制后粘贴到任意 AI 对话工具，即可生成符合格式的对话脚本。</p>
      <select className="ai-preset" value={presetId} onChange={(e) => switchPreset(e.target.value)}>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <textarea className="ai-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} spellCheck={false} />
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" onClick={copyPrompt}>
          {copied ? '已复制 ✓' : '复制提示词'}
        </button>
      </div>

      <div className="section-title">粘贴生成结果并校验</div>
      <p className="ai-hint">把 AI 生成的对话脚本粘贴到这里，自动校验格式是否合规。</p>
      <textarea
        className="ai-result"
        value={result}
        onChange={(e) => setResult(e.target.value)}
        placeholder="在此粘贴 AI 生成的对话脚本…"
        spellCheck={false}
      />
      <ValidationView v={v} onApply={result.trim() && v.ok ? () => onApply && onApply(result) : null} />
    </div>
  )
}

function ValidationView({ v, onApply }) {
  if (!v) return null
  const hasContent = v.errors.length + v.warnings.length > 0
  if (!hasContent) {
    return (
      <div className="ai-validate ai-validate-ok">
        {onApply ? '✓ 格式校验通过，可应用到脚本' : '格式校验通过 ✓'}
        {onApply && (
          <button type="button" className="btn ai-apply" onClick={onApply}>
            应用到脚本
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="ai-validate">
      {v.errors.length > 0 && (
        <div className="ai-validate-block ai-err">
          <div className="ai-validate-title">❌ {v.errors.length} 处错误</div>
          <ul>
            {v.errors.map((e, i) => (
              <li key={i}>
                第 {e.line} 行：{e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {v.warnings.length > 0 && (
        <div className="ai-validate-block ai-warn">
          <div className="ai-validate-title">⚠ {v.warnings.length} 处提醒</div>
          <ul>
            {v.warnings.map((e, i) => (
              <li key={i}>
                第 {e.line} 行：{e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
