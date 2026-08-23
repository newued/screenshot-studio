// 工具列表与路由配置（与原站 13 个页面一致）
export const TOOLS = [
  {
    group: '微信',
    theme: 'wechat',
    items: [
      { to: '/wechat/group', title: '微信群聊模拟器', desc: '多人群聊、红包、转账、语音，一键导出 PNG', tag: '聊天' },
      { to: '/wechat/single', title: '微信单聊对话生成', desc: '双人头像、昵称、文本/红包/转账', tag: '聊天' },
      { to: '/wechat/balance', title: '微信零钱', desc: '自定义零钱余额页面', tag: '账单' },
      { to: '/wechat/bill', title: '微信账单详情', desc: '扫码付款、商户付款、转账、红包、收款成功', tag: '账单' },
      { to: '/wechat/pay', title: '微信付款', desc: '扫码 / 付款成功账单详情页', tag: '账单' },
      { to: '/wechat/transfer', title: '微信转账详情', desc: '转账成功页面、金额、时间、对方', tag: '账单' },
      { to: '/wechat/receive-bill', title: '微信收款账单', desc: '收款成功账单详情页', tag: '账单' },
    ],
  },
  {
    group: 'QQ',
    theme: 'qq',
    items: [{ to: '/qq/chat', title: 'QQ 对话生成', desc: 'QQ 风格聊天截图', tag: '聊天' }],
  },
]

export const ALL_TOOLS = TOOLS.flatMap((g) => g.items)
