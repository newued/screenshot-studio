// 脚本解析：将聊天脚本文本解析为消息对象数组
// 语法（与原站一致）：
//   时间：xxx
//   系统：xxx   撤回：xxx
//   A说：内容
//   A说：[红包：祝福语]
//   A说：[收红包：xxx]
//   A说：[转账：88.00，备注]
//   A说：[收转账：88.00]
//   A说：[语音：10"]
//   A说：[语音转文字：内容]
//   A说：[视频已接：xxx]
//   A说：[视频未接]
// 说话人字母 A/B/C... 对应成员列表索引 0/1/2...（A 即“我”）

const RE = {
  time: /^时间[：:]\s*(.*)$/,
  system: /^(撤回|系统)[：:]\s*(.*)$/,
  speaker: /^(?:\[([A-Za-z])\]\s*|([A-Za-z])(?:说)?[：:]\s*)(.*)$/,
  redpacket: /^\[红包[：:]\s*(.*)\]$/,
  redpacketRecv: /^\[收红包[：:]\s*(.*)\]$/,
  transfer: /^\[转账[：:]\s*([\d.]+)(?:[，,]\s*(.*))?\]$/,
  transferRecv: /^\[收转账[：:]\s*([\d.]+)\]$/,
  voice: /^\[语音[：:]\s*(.*)\]$/,
  voiceText: /^\[(?:语音转文字|语音转文件)[：:]\s*(.*)\]$/,
  videoAnswered: /^\[视频已接[：:]\s*(.*)\]$/,
  videoMissed: /^\[视频未接\]$/,
};

export function parseScript(text) {
  const lines = (text || "").split(/\r?\n/);
  return lines
    .map((line) => {
      const r = line.trim();
      if (!r) return null;
      const a = r.match(RE.time);
      if (a) return { type: "time", content: a[1] };
      const i = r.match(RE.system);
      if (i) return { type: "system", content: i[2] || i[0] };
      const s = r.match(RE.speaker);
      if (!s) return { type: "system", content: r };
      const u = (s[1] || s[2]).toUpperCase();
      const f = s[3];
      const h = f.match(RE.redpacket);
      if (h)
        return {
          type: "redpacket",
          speaker: u,
          content: h[1] || "恭喜发财，大吉大利",
        };
      const B = f.match(RE.redpacketRecv);
      if (B)
        return { type: "redpacketRecv", speaker: u, content: B[1] || "已领取" };
      const d = f.match(RE.transfer);
      if (d)
        return {
          type: "transfer",
          speaker: u,
          amount: d[1],
          note: d[2] || "转账给朋友",
        };
      const m = f.match(RE.transferRecv);
      if (m) return { type: "transferRecv", speaker: u, amount: m[1] };
      const p = f.match(RE.voice);
      if (p) return { type: "voice", speaker: u, duration: p[1] || '1"' };
      const v = f.match(RE.voiceText);
      if (v) return { type: "voiceText", speaker: u, content: v[1] || "" };
      const C = f.match(RE.videoAnswered);
      if (C)
        return { type: "videoAnswered", speaker: u, duration: C[1] || "00:00" };
      if (RE.videoMissed.test(f)) return { type: "videoMissed", speaker: u };
      return { type: "text", speaker: u, content: f };
    })
    .filter(Boolean);
}

// 将消息数组序列化回脚本文本（用于“复制脚本”）
export function serializeScript(messages) {
  return messages
    .map((n) => {
      switch (n.type) {
        case "time":
          return `时间：${n.content}`;
        case "system":
          return `系统：${n.content}`;
        case "redpacket":
          return `${n.speaker}说：[红包：${n.content}]`;
        case "redpacketRecv":
          return `${n.speaker}说：[收红包：${n.content}]`;
        case "transfer":
          return `${n.speaker}说：[转账：${n.amount}${n.note ? "，" + n.note : ""}]`;
        case "transferRecv":
          return `${n.speaker}说：[收转账：${n.amount}]`;
        case "voice":
          return `${n.speaker}说：[语音：${n.duration}]`;
        case "voiceText":
          return `${n.speaker}说：[语音转文字：${n.content}]`;
        case "videoAnswered":
          return `${n.speaker}说：[视频已接：${n.duration}]`;
        case "videoMissed":
          return `${n.speaker}说：[视频未接]`;
        default:
          return `${n.speaker}说：${n.content}`;
      }
    })
    .join("\n");
}
