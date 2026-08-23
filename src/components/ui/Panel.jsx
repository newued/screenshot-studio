// 配置面板容器
import React from 'react'

export default function Panel({ title, desc, children, scroll = true, className = '', action }) {
  return (
    <section className={`panel ${className || ''}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {action && <div className="panel-action">{action}</div>}
      </div>
      {desc && <p className="desc">{desc}</p>}
      <div className={scroll ? 'panel-scroll' : ''}>{children}</div>
    </section>
  )
}
