// 聊天消息列表渲染容器
// animMap / stickerMap：视频帧渲染用（可选，缺省不影响截图模式）
//   animMap[i]    → 消息入场动画样式（作用于 .chat-slice）
//   stickerMap[i] → { file, style } 贴纸（渲染在消息下方）
import React from 'react'
import Message from './Message'

export default function ChatPreview({ messages, members, platform = 'wechat', showName = false, innerRef, animMap = {}, stickerMap = {} }) {
  return (
    <div className="chat-body" ref={innerRef}>
      {messages.map((m, i) => (
        <div className="chat-slice" key={i} data-slice style={animMap?.[i]}>
          <Message msg={m} members={members} platform={platform} showName={showName} />
          {stickerMap?.[i] && (
            <div className="video-sticker" style={stickerMap[i].style}>
              <img
                src={stickerMap[i].file.startsWith('http') ? stickerMap[i].file : `/emojis/${stickerMap[i].file}`}
                alt=""
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
