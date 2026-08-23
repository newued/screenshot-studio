// 手机外壳相关组件：PhoneFrame / StatusBar / NavBar / ChatInput
import React from 'react'

export function StatusBar({ time = '9:41', light = false }) {
  return (
    <div className={`status-bar${light ? ' light' : ''}`}>
      <div className="status-left">{time}</div>
      <div className="status-right">
        <span className="signal">
          <i className="on" />
          <i className="on" />
          <i className="on" />
          <i className="on" />
        </span>
        <span>5G</span>
        <span className="battery">
          <span style={{ width: '82%' }} />
        </span>
      </div>
    </div>
  )
}

export function NavBar({ title = '', rightTitle = '', platform = 'wechat', back = true, close = false, more = true }) {
  const cls = platform === 'alipay' ? 'alipay-nav' : platform === 'qq' ? 'qq-nav' : ''
  return (
    <div className={`nav-bar ${cls}`}>
      {close ? <div className="back close">×</div> : back ? <div className="back">‹</div> : <div />}
      <div className="title">{title}</div>
      {rightTitle ? <div className="more right-title">{rightTitle}</div> : more ? <div className="more">···</div> : <div />}
    </div>
  )
}

export function ChatInput({ platform = 'wechat' }) {
  return (
    <div className="chat-input-bar">
      <button className="chat-input-icon chat-input-plus-btn" type="button">+</button>
      <div className="chat-input-field">
        <span className="chat-input-mic-icon">🎤</span>
      </div>
      <button className="chat-input-icon" type="button">😊</button>
    </div>
  )
}

export default function PhoneFrame({ time, navTitle, rightNavTitle = '', platform = 'wechat', nav = true, close = false, more = true, input = false, children, screenRef, className = '' }) {
  const light = platform === 'alipay' || platform === 'qq'
  return (
    <div className="phone-frame">
      <div className={`phone-screen ${className}`} ref={screenRef}>
        <StatusBar time={time} light={light} />
        {nav && <NavBar title={navTitle} rightTitle={rightNavTitle} platform={platform} close={close} more={more} />}
        {children}
        {input && <ChatInput platform={platform} />}
      </div>
    </div>
  )
}
