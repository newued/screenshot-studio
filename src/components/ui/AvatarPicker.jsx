// 头像选择器：预设头像库（100张）+ 手动上传 + URL 输入
import React, { useState, useRef } from 'react'
import AVATARS, { AVATAR_CATEGORIES } from '../../data/avatars'
import { avatarFor } from '../../lib/avatars'

export default function AvatarPicker({ value, onChange, fallbackName = '', label = '头像' }) {
  const [open, setOpen] = useState(false)
  const [cat, setCat] = useState('全部')
  const fileRef = useRef(null)

  const preview = value || avatarFor(fallbackName || '?')
  const filtered = cat === '全部' ? AVATARS : AVATARS.filter((a) => a.category === cat)

  const onUpload = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onChange(reader.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <>
      <div className="avatar-picker">
        <img
          className="avatar-preview"
          src={preview}
          alt=""
          title="点击修改头像"
          onClick={() => setOpen(true)}
        />
      </div>

      {open && (
        <div className="avatar-modal-mask" onClick={() => setOpen(false)}>
          <div className="avatar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="avatar-modal-head">
              <strong>选择{label}</strong>
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <div className="avatar-cats">
              {AVATAR_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={'chip' + (cat === c ? ' chip-on' : '')}
                  onClick={() => setCat(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="avatar-grid">
              {filtered.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="avatar-cell"
                  title={a.category}
                  onClick={() => {
                    onChange(a.url)
                    setOpen(false)
                  }}
                >
                  <img src={a.url} alt={a.id} loading="lazy" />
                </button>
              ))}
            </div>
            <div className="avatar-manual">
              <span>手动：</span>
              <button type="button" className="btn btn-secondary" onClick={() => fileRef.current && fileRef.current.click()}>
                上传图片
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
              <input
                className="avatar-url"
                placeholder="或粘贴图片 URL"
                value={value && value.startsWith('http') ? value : ''}
                onChange={(e) => onChange(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
