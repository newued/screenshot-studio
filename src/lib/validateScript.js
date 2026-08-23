// 校验脚本是否符合本工具支持的单聊 / 群聊格式。
// 返回值：{ ok, errors:[{line, raw, message}], warnings:[{line, raw, message}] }
// 语法与 src/lib/parseScript.js 保持一致。
export function validateScript(text, members = []) {
  const lines = (text || '').split(/\r?\n/)
  const errors = []
  const warnings = []
  const count = members.length

  const TIME = /^时间[：:]\s*(\S[\s\S]*)?$/
  const SYS = /^(?:撤回|系统)[：:]\s*(\S[\s\S]*)?$/
  const SPEAKER = /^([A-Za-z])说[：:]\s*([\s\S]*)$/
  const isValidAmount = (s) => /^\d+(\.\d{1,2})?$/.test((s || '').trim())

  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const ln = i + 1

    // 时间 / 系统 / 撤回：合法
    if (TIME.test(line) || SYS.test(line)) return

    const sp = line.match(SPEAKER)
    if (!sp) {
      errors.push({ line: ln, raw, message: '无法识别该行。应使用「X说：内容」「时间：xxx」或「系统：xxx」格式。' })
      return
    }

    const letter = sp[1].toUpperCase()
    const index = letter.charCodeAt(0) - 65
    if (count > 0 && (index < 0 || index >= count)) {
      const last = count > 0 ? String.fromCharCode(65 + count - 1) : 'A'
      errors.push({ line: ln, raw, message: `说话人 ${letter} 超出已配置成员（共 ${count} 人，A~${last}）。请检查成员或字母。` })
    }

    const inner = sp[2].trim()
    if (!inner) {
      errors.push({ line: ln, raw, message: `${letter}说： 后内容为空，请填写消息内容。` })
      return
    }

    const bracket = inner.match(/^\[([\s\S]*)\]$/)
    if (!bracket) return // 普通文本，合法

    const body = bracket[1].trim()
    if (!body) {
      errors.push({ line: ln, raw, message: '方括号内为空，特殊消息格式不正确。' })
      return
    }

    if (/^红包[：:]/.test(body)) return
    if (/^收红包[：:]/.test(body)) return
    if (/^语音转文字[：:]/.test(body) || /^语音转文件[：:]/.test(body)) return
    if (/^视频已接[：:]/.test(body)) return
    if (/^视频未接$/.test(body)) return

    if (/^转账[：:]/.test(body)) {
      const m = body.match(/^转账[：:]\s*([\d.]+)(?:[，,]\s*([\s\S]*))?$/)
      if (!m) errors.push({ line: ln, raw, message: '转账格式应为：[转账：金额，备注]，金额需为数字（如 200.00）。' })
      else if (!isValidAmount(m[1])) errors.push({ line: ln, raw, message: `转账金额「${m[1]}」不是有效数字，应为如 200.00。` })
      return
    }
    if (/^收转账[：:]/.test(body)) {
      const m = body.match(/^收转账[：:]\s*([\d.]+)$/)
      if (!m) errors.push({ line: ln, raw, message: '收转账格式应为：[收转账：金额]，金额需为数字。' })
      else if (!isValidAmount(m[1])) errors.push({ line: ln, raw, message: `收转账金额「${m[1]}」不是有效数字。` })
      return
    }
    if (/^语音[：:]/.test(body)) {
      const m = body.match(/^语音[：:]\s*([\s\S]*)$/)
      const v = (m && m[1] || '').trim()
      if (!v) errors.push({ line: ln, raw, message: '语音格式应为：[语音：时长"]，如 [语音：5"]。' })
      else if (!/["”]|\d+:\d+/.test(v)) warnings.push({ line: ln, raw, message: `语音时长「${v}」建议以 " 结尾（如 5"）或写成 mm:ss。` })
      return
    }

    errors.push({
      line: ln,
      raw,
      message: `无法识别的特殊消息：「${body}」。支持类型：红包 / 收红包 / 转账 / 收转账 / 语音 / 语音转文字 / 视频已接 / 视频未接。`,
    })
  })

  return { ok: errors.length === 0, errors, warnings }
}
