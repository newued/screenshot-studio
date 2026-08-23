// 首页：Hero + 工具卡片网格
import React from 'react'
import { Link } from 'react-router-dom'
import { TOOLS } from '../data/tools'

export default function Home() {
  return (
    <div className="page">
      <div className="hero">
        <h1>截图工坊</h1>
        <p>
          微信 / 支付宝 / QQ 对话与账单生成器。自定义聊天内容、红包转账、账单详情，一键导出高清
          PNG，仅供娱乐与内容创作。
        </p>
        <div className="disclaimer">⚠️ 仅供娱乐与内容创作，请勿用于欺诈等非法用途</div>
      </div>

      {TOOLS.map((group) => (
        <div key={group.group}>
          <div className="section-title">{group.group}工具</div>
          <div className="tool-grid">
            {group.items.map((t) => (
              <Link key={t.to} to={t.to} className={`tool-card ${group.theme}`}>
                <span className="tag">{t.tag}</span>
                <h3>{t.title}</h3>
                <p>{t.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
