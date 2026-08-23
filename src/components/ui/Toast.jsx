// 全局 Toast 通知：替代 alert() 与静默 console.error
// 用法：import { toast } from './Toast'; toast.success('已导出') / toast.error('失败') / toast.info('提示')
// 组件 <ToastHost /> 挂在应用根部一次即可
import React, { useEffect, useState } from 'react'

let push = null

export function toast(msg, type = 'info') {
  push?.({ id: Date.now() + Math.random(), msg, type })
}
toast.success = (msg) => toast(msg, 'success')
toast.error = (msg) => toast(msg, 'error')
toast.info = (msg) => toast(msg, 'info')

export default function ToastHost() {
  const [items, setItems] = useState([])

  useEffect(() => {
    push = (item) => {
      setItems((prev) => [...prev, item])
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== item.id))
      }, 3000)
    }
    return () => {
      push = null
    }
  }, [])

  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {t.msg}
        </div>
      ))}
    </div>
  )
}