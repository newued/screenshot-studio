// 表单字段包装
import React from 'react'

export function Field({ label, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
    </div>
  )
}

export function Row2({ children }) {
  return <div className="row-2">{children}</div>
}

export function Row3({ children }) {
  return <div className="row-3">{children}</div>
}
