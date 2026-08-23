// 通用占位页（其余页面由 fixer 填充后替换）
import React from 'react'
import { Link } from 'react-router-dom'

export default function Placeholder({ title = '页面建设中' }) {
  return (
    <div className="page">
      <div className="hero">
        <h1>{title}</h1>
        <p>该页面正在建设中。</p>
        <Link to="/" className="disclaimer">
          ← 返回首页
        </Link>
      </div>
    </div>
  )
}
