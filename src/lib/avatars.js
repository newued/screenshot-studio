// 头像解析：统一复用网页预设头像库 src/data/avatars.js（public/avatars 下真实图片）
// 三种来源（与网页一致）：
//   1) member.avatar 为真实图片地址（/avatars/...、http(s)、用户上传 dataURL / 在线图）→ 直接使用
//   2) 无头像 → 按名字稳定映射到预设库中的某张真实图片（同名同图）
//   3) 手动「换一换」→ 从预设库随机取一张真实图片
// 仅在完全没有可用图片时，canvas 层才降级为彩色首字（见 canvasChat.drawAvatar）。
import dataAvatars, { randomAvatar as dataRandomAvatar, randomAvatars, defaultMembers } from '../data/avatars.js'
const AVATARS = dataAvatars || []

// 由名字稳定映射到预设库里的一张真实头像（同名同图，刷新不变）
function hash(str) {
  let h = 0
  const s = String(str || '?')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// 由 member 对象（或 name）给出头像 URL：用户指定优先，否则按名字稳定取预设库真实图片
export function genMemberAvatar(member) {
  const name = member?.name || member?.speaker || '?'
  const av = member?.avatar
  if (av) return av // 用户手动指定：真实图 / 上传 dataURL / 在线地址
  const list = AVATARS && AVATARS.length ? AVATARS : []
  if (list.length === 0) return ''
  return list[hash(name) % list.length].url
}

// 「换一换」：从预设库随机取一张真实图片（忽略 seed，每次不同）
export function randomAvatar() {
  return dataRandomAvatar()
}

// 取 n 张不重复的预设库真实头像
export function pickRandomAvatars(n) {
  return randomAvatars(n || 1)
}

// 按名字列表生成默认成员（随机分配不重复的真实头像），与网页 defaultMembers 一致
export function makeDefaultMembers(names) {
  return defaultMembers(names || [])
}

// 由名字稳定映射到一种颜色（仅用于 canvas 无图降级底色）
export function genMemberColor(name) {
  const COLORS = [
    '#07c160', '#1677ff', '#12b7f5', '#fa5151', '#ff976a',
    '#a18cd1', '#f6a5c0', '#5b8def', '#f7b500', '#7ed321',
    '#ff6b81', '#36cfc9', '#9c88ff', '#ffa940', '#36a2eb',
  ]
  return COLORS[hash(name || '?') % COLORS.length]
}

// 取得展示用的首字（名字首字符，缺省 ?），仅用于无图降级
export function avatarInitial(name) {
  return (name || '?').trim().slice(0, 1) || '?'
}

// 历史兼容：返回同名字稳定真实头像
export function avatarFor(name) {
  return genMemberAvatar({ name })
}
