// 头像字段：封装 Field + AvatarPicker，用于详情页配置
import React from 'react'
import { Field } from './Field'
import AvatarPicker from './AvatarPicker'

function AvatarField({ label = '头像', value, onChange, fallbackName }) {
  return (
    <Field label={label}>
      <AvatarPicker value={value} onChange={onChange} fallbackName={fallbackName} />
    </Field>
  )
}

export default AvatarField