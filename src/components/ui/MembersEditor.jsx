// 成员管理器：配置群成员/对话双方的昵称与头像
import React from 'react'
import AvatarPicker from './AvatarPicker'

export default function MembersEditor({ members, onChange, allowAddRemove = true }) {
  const update = (i, patch) => {
    onChange(members.map((m, idx) => (idx === i ? { ...m, ...patch } : m)))
  }
  const add = () => onChange([...members, { name: `成员${members.length + 1}`, avatar: '' }])
  const remove = (i) => onChange(members.filter((_, idx) => idx !== i))

  return (
    <div className="members-scroll">
      <div className="members-grid">
        {members.map((m, i) => (
          <div className="member-card" key={i}>
            <div className="member-head">
              <span className="member-tag">
                {String.fromCharCode(65 + i)} {i === 0 ? '（我）' : ''}
              </span>
              <input
                className="member-name"
                value={m.name || ''}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="昵称"
              />
              {allowAddRemove && i !== 0 && (
                <button type="button" className="btn-ghost" onClick={() => remove(i)}>
                  删除
                </button>
              )}
            </div>
            <div className="avatar-row">
              <AvatarPicker
                value={m.avatar}
                onChange={(url) => update(i, { avatar: url })}
                fallbackName={m.name || String.fromCharCode(65 + i)}
              />
            </div>
          </div>
        ))}
      </div>
      {allowAddRemove && (
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={add}>
            添加成员
          </button>
        </div>
      )}
    </div>
  )
}
