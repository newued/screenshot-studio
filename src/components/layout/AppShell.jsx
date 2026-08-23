// 应用外壳：顶栏 + 内容 + 页脚
import React from 'react'
import TopBar from './TopBar'
import Footer from './Footer'

export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      <TopBar />
      {children}
      <Footer />
    </div>
  )
}
