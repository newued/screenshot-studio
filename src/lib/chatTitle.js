// 聊天对话框顶栏标题规则（单一真相源，前端预览 / 后端渲染共用）
// 规则：
//  - 单聊：显示对方的昵称或备注（即非“我”的那一位成员；约定 members[0]=我, members[1]=对方）
//  - 群聊：显示群名称
// 网页端编辑昵称/头像/群名后，members/groupName 会随「确认页面信息」提交，
// 渲染器据此派生标题，从而保证视频顶栏与网页同步更新。
export function deriveChatTitle(mode = 'single', members = [], groupName = '') {
  const list = Array.isArray(members) ? members : []
  if (mode === 'group') {
    const g = (groupName || '').toString().trim()
    if (g) return g
    if (list.length) return `${list[0].name || '群'}等${list.length}人`
    return '群聊'
  }
  // single：对方的昵称/备注
  const other = list.find((m) => m && m.name && m.name !== '我') || list[1] || list[0] || null
  return (other && other.name) || '对方'
}
