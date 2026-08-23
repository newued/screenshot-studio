// 顶部导航栏
import React from 'react'
import { NavLink } from 'react-router-dom'
import { ALL_TOOLS } from '../../data/tools'

export default function TopBar() {
  return (
    <header className="topbar">
      <NavLink to="/" className="brand">
        <span className="brand-mark">截</span>
        <span>截图工坊</span>
      </NavLink>
      <nav className="topnav">
        {ALL_TOOLS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t.title.replace(/微信|支付宝|QQ|模拟器|生成|详情|对话|页面|成功|账单/g, '').slice(0, 6) || t.title}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
