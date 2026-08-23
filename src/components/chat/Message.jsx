// 单条消息渲染：支持 time/system/text/redpacket/transfer/voice/voiceText/video 等类型
import React from 'react'
import { avatarFor } from '../../lib/avatars'

function memberOf(speaker, members) {
  const idx = (speaker || 'A').charCodeAt(0) - 65
  return members[idx] || { name: speaker || '?', avatar: avatarFor(speaker || '?') }
}

function Tail({ mine }) {
  const d = mine
    ? 'M5 4 L0 0 L0 8 Z'
    : 'M0 4 L5 0 L5 8 Z'
  return (
    <span className="bubble-tail">
      <svg viewBox="0 0 5 8" preserveAspectRatio="none">
        <path d={d} fill="currentColor" />
      </svg>
    </span>
  )
}

function bubbleColor(msg, platform) {
  if (msg.type === 'redpacket' || msg.type === 'transfer' || msg.type === 'redpacketRecv' || msg.type === 'transferRecv') {
    return null // 这些气泡自带背景，尾巴颜色单独处理
  }
  if (msg.mine) {
    if (platform === 'alipay') return '#1677ff'
    if (platform === 'qq') return '#12b7f5'
    return '#95ec69'
  }
  return '#fff'
}

export default function Message({ msg, members, platform = 'wechat', showName = false }) {
  if (msg.type === 'time') {
    return <div className="msg-time">{msg.content}</div>
  }
  if (msg.type === 'system') {
    return <div className="msg-system">{msg.content}</div>
  }

  const mine = msg.speaker === 'A'
  const member = memberOf(msg.speaker, members)
  const name = member.name || msg.speaker
  const avatar = member.avatar || avatarFor(name)
  const color = bubbleColor(msg, platform)

  // 红包 / 转账 等卡片气泡
  if (msg.type === 'redpacket') {
    return (
      <div className={`msg-row${mine ? ' mine' : ''}${showName && !mine ? ' has-name' : ''}`}>
        {showName && !mine && <div className="msg-name">{name}</div>}
        <div className="msg-body">
          <div className="msg-avatar-wrap"><img className="msg-avatar" src={avatar} alt="" /></div>
          <div className="msg-main">
            <div className="bubble-wrap">
              <div className={`bubble redpacket${platform === 'qq' ? ' qq-bubble' : ''}${platform === 'alipay' ? ' alipay-bubble' : ''}`}>
                <div className="rp-top">
                  <div className="rp-icon"><img src="/icons/hongbao2x.svg" alt="红包" /></div>
                  <div className="rp-text"><strong>{msg.content}</strong><span>已领取</span></div>
                </div>
                <div className="rp-bottom">{platform === 'alipay' ? '支付宝红包' : platform === 'qq' ? 'QQ红包' : '微信红包'}</div>
              </div>
              <Tail mine={mine} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'redpacketRecv') {
    return (
      <div className={`msg-row${mine ? ' mine' : ''}${showName && !mine ? ' has-name' : ''}`}>
        {showName && !mine && <div className="msg-name">{name}</div>}
        <div className="msg-body">
          <div className="msg-avatar-wrap"><img className="msg-avatar" src={avatar} alt="" /></div>
          <div className="msg-main">
            <div className="bubble-wrap">
              <div className={`bubble redpacket${platform === 'qq' ? ' qq-bubble' : ''}${platform === 'alipay' ? ' alipay-bubble' : ''}`}>
                <div className="rp-top">
                  <div className="rp-icon"><img src="/icons/hongbao2x.svg" alt="红包" /></div>
                  <div className="rp-text"><strong>{msg.content}</strong><span>{platform === 'alipay' ? '支付宝红包' : platform === 'qq' ? 'QQ红包' : '微信红包'}</span></div>
                </div>
                <div className="rp-bottom">已领取</div>
              </div>
              <Tail mine={mine} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'transfer') {
    return (
      <div className={`msg-row${mine ? ' mine' : ''}${showName && !mine ? ' has-name' : ''}`}>
        {showName && !mine && <div className="msg-name">{name}</div>}
        <div className="msg-body">
          <div className="msg-avatar-wrap"><img className="msg-avatar" src={avatar} alt="" /></div>
          <div className="msg-main">
            <div className="bubble-wrap">
              <div className={`bubble transfer${platform === 'qq' ? ' qq-bubble' : ''}${platform === 'alipay' ? ' alipay-bubble' : ''}`}>
                <div className="tf-top">
                  <div className="tf-icon">¥</div>
                  <div className="tf-text">
                    <strong>¥{msg.amount}</strong>
                     <span>{msg.note}</span>
                  </div>
                </div>
               
                <div className="tf-bottom">转账</div>
              </div>
              <Tail mine={mine} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'transferRecv') {
    return (
      <div className={`msg-row${mine ? ' mine' : ''}${showName && !mine ? ' has-name' : ''}`}>
        {showName && !mine && <div className="msg-name">{name}</div>}
        <div className="msg-body">
          <div className="msg-avatar-wrap"><img className="msg-avatar" src={avatar} alt="" /></div>
          <div className="msg-main">
            <div className="bubble-wrap">
              <div className={`bubble transfer transfer-recv${platform === 'qq' ? ' qq-bubble' : ''}${platform === 'alipay' ? ' alipay-bubble' : ''}`}>
                <div className="tf-top">
                  <div className="tf-icon">¥</div>
                  <div className="tf-text"><strong>¥{msg.amount}</strong></div>
                </div>
                <div className="tf-bottom">已收款</div>
              </div>
              <Tail mine={mine} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'voice') {
    return (
      <div className={`msg-row${mine ? ' mine' : ''}${showName && !mine ? ' has-name' : ''}`}>
        {showName && !mine && <div className="msg-name">{name}</div>}
        <div className="msg-body">
          <div className="msg-avatar-wrap"><img className="msg-avatar" src={avatar} alt="" /></div>
          <div className="msg-main">
            <div className="bubble-wrap">
              <div className={`bubble voice-bubble${mine ? ' is-mine' : ''}`}>
                <span className="voice-icon"><img src="/icons/yinpin.svg" alt="语音" /></span>
                <span className="voice-duration">{msg.duration}</span>
              </div>
              <Tail mine={mine} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'voiceText') {
    return (
      <div className={`msg-row${mine ? ' mine' : ''}${showName && !mine ? ' has-name' : ''}`}>
        {showName && !mine && <div className="msg-name">{name}</div>}
        <div className="msg-body">
          <div className="msg-avatar-wrap"><img className="msg-avatar" src={avatar} alt="" /></div>
          <div className="msg-main">
            <div className="voice-text-block">
              <div className="voice-text-card">
                <div className="voice-text-label">语音转文字</div>
                <div className="voice-text-body">{msg.content}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'videoAnswered' || msg.type === 'videoMissed') {
    const missed = msg.type === 'videoMissed'
    return (
      <div className={`msg-row${mine ? ' mine' : ''}${showName && !mine ? ' has-name' : ''}`}>
        {showName && !mine && <div className="msg-name">{name}</div>}
        <div className="msg-body">
          <div className="msg-avatar-wrap"><img className="msg-avatar" src={avatar} alt="" /></div>
          <div className="msg-main">
            <div className="bubble-wrap">
              <div className="bubble call-bubble">
                <span className="call-icon">📹</span>
                <span>{missed ? '视频通话未接通' : `视频通话 ${msg.duration || '00:00'}`}</span>
              </div>
              <Tail mine={mine} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 默认：文本气泡
  return (
      <div className={`msg-row${mine ? ' mine' : ''}${showName && !mine ? ' has-name' : ''}`}>
      {showName && !mine && <div className="msg-name">{name}</div>}
      <div className="msg-body">
        <div className="msg-avatar-wrap"><img className="msg-avatar" src={avatar} alt="" /></div>
        <div className="msg-main">
          <div className="bubble-wrap">
            <div className={`bubble${platform === 'qq' ? ' qq-bubble' : ''}${platform === 'alipay' && mine ? ' alipay-bubble' : ''}`}>
              <span className="bubble-text">{msg.content}</span>
            </div>
            {color && <Tail mine={mine} />}
          </div>
        </div>
      </div>
    </div>
  )
}
