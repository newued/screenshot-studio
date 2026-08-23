// 微信付款：合并扫码付款与付款账单
import React, { useRef, useState } from 'react'
import Panel from '../../components/ui/Panel'
import { Field, Row2 } from '../../components/ui/Field'
import Button from '../../components/ui/Button'
import PhoneFrame from '../../components/phone/Phone'
import { exportImage } from '../../lib/exportImage'

const DEFAULT_DATA = {
  merchant: '美宜佳便利店（华强店）',
  status: '付款成功',
  time: '2026-08-19 18:20',
  method: '零钱',
  tradeNo: '4200001234202608191234567890',
  amount: '25.50',
}

export default function WechatPay() {
  const [data, setData] = useState(DEFAULT_DATA)
  const screenRef = useRef(null)

  const set = (key) => (e) => setData((prev) => ({ ...prev, [key]: e.target.value }))
  const onExport = () => exportImage(screenRef.current, { filename: 'wechat-pay.png' })

  return (
    <div className="page">
      <div className="tool-shell">
        <Panel title="微信付款" desc="扫码付款 / 付款账单成功页面，右侧实时预览，可一键导出整图。">
          <div className="field-grid">
            <Row2>
              <Field label="收款方">
                <input value={data.merchant} onChange={set('merchant')} placeholder="请输入收款方" />
              </Field>
              <Field label="状态文案">
                <input value={data.status} onChange={set('status')} placeholder="付款成功" />
              </Field>
            </Row2>
            <Row2>
              <Field label="付款时间">
                <input value={data.time} onChange={set('time')} placeholder="2026-08-19 18:20" />
              </Field>
              <Field label="支付方式">
                <input value={data.method} onChange={set('method')} placeholder="零钱 / 银行卡" />
              </Field>
            </Row2>
            <Row2>
              <Field label="交易单号">
                <input value={data.tradeNo} onChange={set('tradeNo')} placeholder="请输入交易单号" />
              </Field>
              <Field label="金额（元）">
                <input value={data.amount} onChange={set('amount')} placeholder="0.00" />
              </Field>
            </Row2>
          </div>
          <div className="btn-row">
            <Button onClick={onExport}>导出整图</Button>
          </div>
        </Panel>
        <aside className="preview-col">
          <PhoneFrame time="9:41" navTitle="微信支付" platform="wechat" screenRef={screenRef}>
            <div className="page-white">
              <div className="money-page">
                <div className="success-icon">✓</div>
                <div className="label">{data.status}</div>
                <div className="amount">
                  <small>¥</small>
                  {data.amount}
                </div>
                <div className="detail-list">
                  <div className="detail-item">
                    <span>收款方</span>
                    <span>{data.merchant}</span>
                  </div>
                  <div className="detail-item">
                    <span>付款时间</span>
                    <span>{data.time}</span>
                  </div>
                  <div className="detail-item">
                    <span>支付方式</span>
                    <span>{data.method}</span>
                  </div>
                  <div className="detail-item">
                    <span>交易单号</span>
                    <span>{data.tradeNo}</span>
                  </div>
                  <div className="detail-item">
                    <span>金额</span>
                    <span>¥{data.amount}</span>
                  </div>
                </div>
              </div>
            </div>
          </PhoneFrame>
          <div className="phone-meta">截图 390×844 @3x</div>
        </aside>
      </div>
    </div>
  )
}
