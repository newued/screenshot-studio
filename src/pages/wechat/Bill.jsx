// 微信账单详情：扫码付款 / 商户付款 / 转账 / 红包 / 收款成功
import React, { useRef, useState, useEffect } from 'react'
import JsBarcode from 'jsbarcode'
import Panel from '../../components/ui/Panel'
import { Field, Row2 } from '../../components/ui/Field'
import AvatarField from '../../components/ui/AvatarField'
import Button from '../../components/ui/Button'
import PhoneFrame from '../../components/phone/Phone'
import { exportImage } from '../../lib/exportImage'

const DEFAULTS = {
  pay_person: {
    type: 'pay_person',
    title: '扫二维码付款-给渔-德生',
    amount: '50.00',
    amountPrefix: '-',
    status: '支付成功',
    remark: '二维码收款',
    method: '零钱',
    time: '2026年8月14日 08:34:53',
    tradeNo: '10001073012026081400080669445071',
    iconType: 'wallet',
    services: 'bill',
    receiverServices: 'card',
  },
  pay_merchant: {
    type: 'pay_merchant',
    title: '发到家袍江店',
    amount: '2.00',
    amountPrefix: '-',
    status: '支付成功',
    payTime: '2026年8月11日 15:22:32',
    product: 'tqpay:001',
    merchantFull: '绍兴客利多超市有限公司',
    acquirer: '随行付支付有限公司',
    method: '零钱',
    tradeNo: '4200003113202608115628822133',
    merchantNo: '可在支持的商户扫码退款',
    barcode: '83620260811642614220',
    iconType: 'avatar',
    avatar: '/avatars/avatar-010.jpg',
    services: 'merchant',
    receiverServices: '',
  },
  transfer: {
    type: 'transfer',
    title: '转账-转给a  不坏 不修，安装监控，太阳能灯',
    amount: '200.00',
    amountPrefix: '-',
    status: '对方已收钱',
    note: '微信转账',
    transferTime: '2026年7月26日 08:59:41',
    receiveTime: '2026年7月26日 08:59:48',
    method: '招商银行储蓄卡(6712)',
    tradeNo: '1000050001202607260728972034182',
    iconType: 'avatar',
    avatar: '/avatars/avatar-020.jpg',
    services: 'transfer',
  },
  redpacket: {
    type: 'redpacket',
    title: '微信红包-来自王辉',
    amount: '11.19',
    amountPrefix: '+',
    status: '已存入零钱',
    detailLink: '查看',
    receiveTime: '2026年7月29日 15:00:47',
    tradeNo: '1000039801004607296409440829016',
    merchantNo: '1000039801202607296409440829016',
    iconType: 'redpacket',
    services: 'none',
  },
  receive: {
    type: 'receive',
    title: '你已收款，资金已存入零钱',
    amount: '300.00',
    amountPrefix: '¥',
    status: '零钱余额',
    transferTime: '2026年06月09日 21:30:21',
    receiveTime: '2026年06月09日 21:31:08',
    iconType: 'success',
    services: 'none',
  },
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64">
      <circle cx="32" cy="32" r="32" fill="#FFC300" />
      <path d="M32 15c-8.5 0-15 6.5-15 14.5 0 5 2.5 9.5 6.5 12.2l-2.2 6.3h21.4l-2.2-6.3c4-2.7 6.5-7.2 6.5-12.2C47 21.5 40.5 15 32 15z" fill="#fff" />
      <path d="M27.5 33.5l4.2 4.2 8.8-8.8" stroke="#FFC300" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RedPacketIcon() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64">
      <circle cx="32" cy="32" r="32" fill="#FA5151" />
      <rect x="19" y="23" width="26" height="20" rx="2" fill="#fff" />
      <path d="M19 28h26" stroke="#FA5151" strokeWidth="2.5" />
      <circle cx="32" cy="35" r="3.5" fill="#FA5151" />
    </svg>
  )
}

function SuccessIcon() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64">
      <circle cx="32" cy="32" r="32" fill="#07C160" />
      <path d="M20 34l8 8 16-16" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BillIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 13.5v-4M10 7.5h.05" strokeLinecap="round" />
    </svg>
  )
}

function GroupIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.5" y="5.5" width="13" height="10" rx="1.5" />
      <path d="M6.5 8.5h7M6.5 11.5h5" />
    </svg>
  )
}

function CertIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6.5v4l2.5 1.5" strokeLinecap="round" />
    </svg>
  )
}

function CardIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.5" y="5.5" width="13" height="10" rx="1.5" />
      <path d="M3.5 9h13" />
      <circle cx="7" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 16.5c3.5 0 6.5-2.5 6.5-6s-3-6-6.5-6S3.5 7 3.5 10.5c0 1.2.4 2.4 1 3.3L3.5 16l2.5-.8c1 .6 2.2 1.3 4 1.3z" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 10a6 6 0 1 1 1.2 3.6" />
      <path d="M4 10V6M4 10h4" strokeLinecap="round" />
    </svg>
  )
}

function Barcode({ value }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 13,
        margin: 0,
        marginTop: 4,
        marginBottom: 4,
        height: 42,
        width: 1.6,
        background: '#ffffff',
        lineColor: '#111111',
        textAlign: 'center',
        textMargin: 3,
        flat: true,
      })
    } catch (e) {
      // 条码内容非法时回退为纯文本
      ref.current.innerHTML = ''
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.setAttribute('x', '50%')
      t.setAttribute('y', '16')
      t.setAttribute('text-anchor', 'middle')
      t.setAttribute('font-size', '13')
      t.textContent = value
      ref.current.appendChild(t)
    }
  }, [value])
  if (!value) return null
  return (
    <div className="wb-barcode">
      <svg ref={ref} className="wb-barcode-svg" />
    </div>
  )
}

function BillAvatar({ data }) {
  if (data.iconType === 'wallet') return <div className="wb-avatar"><WalletIcon /></div>
  if (data.iconType === 'redpacket') return <div className="wb-avatar"><RedPacketIcon /></div>
  if (data.iconType === 'success') return <div className="wb-avatar"><SuccessIcon /></div>
  const src = data.avatar
  return (
    <div className="wb-avatar">
      <img src={src} alt="" />
    </div>
  )
}

function BillServices({ type }) {
  if (type === 'bill') {
    return (
      <div className="wb-services">
        <div className="wb-service-title">账单服务</div>
        <div className="wb-service-grid">
          <div className="wb-service-item"><BillIcon /><span>对订单有疑惑</span></div>
          <div className="wb-service-item"><GroupIcon /><span>发起群收款</span></div>
          <div className="wb-service-item"><CertIcon /><span>申请电子凭证</span></div>
        </div>
      </div>
    )
  }
  if (type === 'merchant') {
    return (
      <div className="wb-services">
        <div className="wb-service-title">账单服务</div>
        <div className="wb-service-grid">
          <div className="wb-service-item"><BillIcon /><span>对订单有疑惑</span></div>
          <div className="wb-service-item"><GroupIcon /><span>发起群收款</span></div>
        </div>
      </div>
    )
  }
  if (type === 'transfer') {
    return (
      <div className="wb-services">
        <div className="wb-service-title">账单服务</div>
        <div className="wb-service-grid">
          <div className="wb-service-item"><BillIcon /><span>对订单有疑惑</span></div>
          <div className="wb-service-item"><ChatIcon /><span>定位到聊天位置</span></div>
          <div className="wb-service-item"><CertIcon /><span>申请转账电子凭证</span></div>
          <div className="wb-service-item"><HistoryIcon /><span>查看往来转账</span></div>
        </div>
      </div>
    )
  }
  return null
}

export default function WechatBill({ defaultType = 'pay_person' }) {
  const [type, setType] = useState(defaultType)
  const [data, setData] = useState(() => DEFAULTS[defaultType])
  const screenRef = useRef(null)

  const changeType = (t) => {
    setType(t)
    setData({ ...DEFAULTS[t] })
  }

  const set = (key) => (e) => setData((prev) => ({ ...prev, [key]: e.target.value }))
  const setText = (key, value) => setData((prev) => ({ ...prev, [key]: value }))
  const onExport = () => exportImage(screenRef.current, { filename: `wechat-bill-${type}.png` })

  const isReceive = type === 'receive'
  const isRedPacket = type === 'redpacket'

  return (
    <div className="page">
      <div className="tool-shell">
        <Panel title="微信账单详情" desc="参考真实截图还原扫码付款、商户付款、转账、红包、收款成功等账单样式。">
          <div className="field-grid">
            <Field label="账单类型">
              <select value={type} onChange={(e) => changeType(e.target.value)}>
                <option value="pay_person">扫码付款（个人）</option>
                <option value="pay_merchant">商户付款</option>
                <option value="transfer">转账</option>
                <option value="redpacket">微信红包</option>
                <option value="receive">收款成功</option>
              </select>
            </Field>

            <Row2>
              <Field label="标题">
                <input value={data.title} onChange={set('title')} placeholder="账单标题" />
              </Field>
              <Field label="金额">
                <input value={data.amount} onChange={set('amount')} placeholder="0.00" />
              </Field>
            </Row2>

            {!isReceive && (
              <Row2>
                <Field label="当前状态">
                  <input value={data.status} onChange={set('status')} placeholder="支付成功" />
                </Field>
                <Field label="支付方式">
                  <input value={data.method} onChange={set('method')} placeholder="零钱 / 银行卡" />
                </Field>
              </Row2>
            )}

            {type === 'pay_person' && (
              <>
                <Row2>
                  <Field label="收款方备注">
                    <input value={data.remark} onChange={set('remark')} placeholder="二维码收款" />
                  </Field>
                  <Field label="转账时间">
                    <input value={data.time} onChange={set('time')} placeholder="2026年..." />
                  </Field>
                </Row2>
                <Field label="转账单号">
                  <textarea rows={2} value={data.tradeNo} onChange={set('tradeNo')} placeholder="单号（换行可模拟折行）" />
                </Field>
                <Row2>
                  <Field label="账单服务">
                    <select value={data.services} onChange={set('services')}>
                      <option value="bill">个人版（3 项）</option>
                      <option value="merchant">商户版（2 项）</option>
                      <option value="none">无</option>
                    </select>
                  </Field>
                  <Field label="收款方服务">
                    <select value={data.receiverServices || ''} onChange={set('receiverServices')}>
                      <option value="card">收款方名片</option>
                      <option value="">无</option>
                    </select>
                  </Field>
                </Row2>
              </>
            )}

            {type === 'pay_merchant' && (
              <>
                <Row2>
                  <Field label="支付时间">
                    <input value={data.payTime} onChange={set('payTime')} />
                  </Field>
                  <Field label="商品">
                    <input value={data.product} onChange={set('product')} />
                  </Field>
                </Row2>
                <Field label="商户全称">
                  <input value={data.merchantFull} onChange={set('merchantFull')} />
                </Field>
                <Row2>
                  <Field label="收单机构">
                    <input value={data.acquirer} onChange={set('acquirer')} />
                  </Field>
                  <Field label="商户单号">
                    <input value={data.merchantNo} onChange={set('merchantNo')} />
                  </Field>
                </Row2>
                <Field label="交易单号">
                  <textarea rows={2} value={data.tradeNo} onChange={set('tradeNo')} />
                </Field>
                <Field label="条形码数字">
                  <input value={data.barcode} onChange={set('barcode')} />
                </Field>
                <AvatarField label="商户头像" value={data.avatar} onChange={(url) => setText('avatar', url)} fallbackName="商户" />
                <Row2>
                  <Field label="账单服务">
                    <select value={data.services} onChange={set('services')}>
                      <option value="merchant">商户版（2 项）</option>
                      <option value="bill">个人版（3 项）</option>
                      <option value="none">无</option>
                    </select>
                  </Field>
                  <Field label="收款方服务">
                    <select value={data.receiverServices || ''} onChange={set('receiverServices')}>
                      <option value="">无</option>
                      <option value="card">收款方名片</option>
                    </select>
                  </Field>
                </Row2>
              </>
            )}

            {type === 'transfer' && (
              <>
                <Row2>
                  <Field label="转账说明">
                    <input value={data.note} onChange={set('note')} />
                  </Field>
                  <Field label="转账时间">
                    <input value={data.transferTime} onChange={set('transferTime')} />
                  </Field>
                </Row2>
                <Row2>
                  <Field label="收款时间">
                    <input value={data.receiveTime} onChange={set('receiveTime')} />
                  </Field>
                  <AvatarField label="对方头像" value={data.avatar} onChange={(url) => setText('avatar', url)} fallbackName="对方" />
                </Row2>
                <Field label="转账单号">
                  <textarea rows={2} value={data.tradeNo} onChange={set('tradeNo')} />
                </Field>
              </>
            )}

            {type === 'redpacket' && (
              <>
                <Row2>
                  <Field label="收款时间">
                    <input value={data.receiveTime} onChange={set('receiveTime')} />
                  </Field>
                  <Field label="红包详情文案">
                    <input value={data.detailLink} onChange={set('detailLink')} />
                  </Field>
                </Row2>
                <Field label="交易单号">
                  <textarea rows={2} value={data.tradeNo} onChange={set('tradeNo')} />
                </Field>
                <Field label="商户单号">
                  <textarea rows={2} value={data.merchantNo} onChange={set('merchantNo')} />
                </Field>
              </>
            )}

            {type === 'receive' && (
              <>
                <Row2>
                  <Field label="转账时间">
                    <input value={data.transferTime} onChange={set('transferTime')} />
                  </Field>
                  <Field label="收款时间">
                    <input value={data.receiveTime} onChange={set('receiveTime')} />
                  </Field>
                </Row2>
              </>
            )}
          </div>
          <div className="btn-row">
            <Button onClick={onExport}>导出整图</Button>
          </div>
        </Panel>

        <aside className="preview-col">
          <PhoneFrame time="21:00" navTitle="" platform="wechat" close more={false} screenRef={screenRef}>
            <div className="page-white">
              <div className="wechat-bill">
               <div className="wb-header">
                 <BillAvatar data={data} />

                <div className={`wb-title ${type === 'receive' ? 'wb-receive-title' : ''}`}>{data.title}</div>

                <div className={`wb-amount ${isRedPacket ? 'income' : ''}`}>
                  {data.amountPrefix === '¥' ? (
                    <>
                      <small>¥</small>
                      {data.amount}
                    </>
                  ) : (
                    <>
                      {data.amountPrefix}
                      {data.amount}
                    </>
                  )}
                </div>

                {isReceive && <div className="wb-balance-link">{data.status}</div>}

                <div className="wb-divider" />
               </div>

                <div className="wb-detail-list">
                  {type === 'pay_person' && (
                    <>
                      <div className="wb-detail-item"><span>当前状态</span><span>{data.status}</span></div>
                      <div className="wb-detail-item"><span>收款方备注</span><span>{data.remark}</span></div>
                      <div className="wb-detail-item"><span>支付方式</span><span>{data.method}</span></div>
                      <div className="wb-detail-item"><span>转账时间</span><span>{data.time}</span></div>
                      <div className="wb-detail-item"><span>转账单号</span><span className="wb-multiline">{data.tradeNo}</span></div>
                    </>
                  )}

                  {type === 'pay_merchant' && (
                    <>
                      <div className="wb-detail-item"><span>当前状态</span><span>{data.status}</span></div>
                      <div className="wb-detail-item"><span>支付时间</span><span>{data.payTime}</span></div>
                      <div className="wb-detail-item"><span>商品</span><span>{data.product}</span></div>
                      <div className="wb-detail-item"><span>商户全称</span><span>{data.merchantFull}</span></div>
                      <div className="wb-detail-item"><span>收单机构</span><span>{data.acquirer}</span></div>
                      <div className="wb-detail-item"><span>支付方式</span><span>{data.method}</span></div>
                      <div className="wb-detail-item"><span>交易单号</span><span className="wb-multiline">{data.tradeNo}</span></div>
                      <div className="wb-detail-item"><span>商户单号</span><span>{data.merchantNo}</span></div>
                    </>
                  )}

                  {type === 'transfer' && (
                    <>
                      <div className="wb-detail-item"><span>当前状态</span><span>{data.status}</span></div>
                      <div className="wb-detail-item"><span>转账说明</span><span>{data.note}</span></div>
                      <div className="wb-detail-item"><span>转账时间</span><span>{data.transferTime}</span></div>
                      <div className="wb-detail-item"><span>收款时间</span><span>{data.receiveTime}</span></div>
                      <div className="wb-detail-item"><span>支付方式</span><span>{data.method}</span></div>
                      <div className="wb-detail-item"><span>转账单号</span><span className="wb-multiline">{data.tradeNo}</span></div>
                    </>
                  )}

                  {type === 'redpacket' && (
                    <>
                      <div className="wb-detail-item"><span>当前状态</span><span>{data.status}</span></div>
                      <div className="wb-detail-item"><span>红包详情</span><span className="wb-link">{data.detailLink}</span></div>
                      <div className="wb-detail-item"><span>收款时间</span><span>{data.receiveTime}</span></div>
                      <div className="wb-detail-item"><span>交易单号</span><span className="wb-multiline">{data.tradeNo}</span></div>
                      <div className="wb-detail-item"><span>商户单号</span><span className="wb-multiline">{data.merchantNo}</span></div>
                    </>
                  )}

                  {type === 'receive' && (
                    <>
                      <div className="wb-detail-item"><span>转账时间</span><span>{data.transferTime}</span></div>
                      <div className="wb-detail-item"><span>收款时间</span><span>{data.receiveTime}</span></div>
                    </>
                  )}
                </div>

                {type === 'pay_merchant' && data.barcode && <Barcode value={data.barcode} />}

                <BillServices type={data.services} />

                {data.receiverServices === 'card' && (
                  <div className="wb-services">
                    <div className="wb-service-title">收款方服务</div>
                    <div className="wb-service-grid">
                      <div className="wb-service-item"><CardIcon /><span>收款方名片</span></div>
                    </div>
                  </div>
                )}

                {isReceive && (
                  <div className="wb-bottom-link">账单详情</div>
                )}

                {(isRedPacket || type === 'transfer') && (
                  <div className="wb-footer-note">本服务由财付通提供</div>
                )}
              </div>
            </div>
          </PhoneFrame>
          <div className="phone-meta">截图 390×844 @3x</div>
        </aside>
      </div>
    </div>
  )
}
