// 微信收款账单
import React, { useRef, useState } from 'react'
import Panel from '../../components/ui/Panel'
import { Field, Row2 } from '../../components/ui/Field'
import Button from '../../components/ui/Button'
import PhoneFrame from '../../components/phone/Phone'
import { exportImage } from '../../lib/exportImage'

const DEFAULT_DATA = {
  payer: '李四',
  time: '2026-08-19 16:45',
  account: '零钱',
  tradeNo: '4200001234202608190987654321',
  amount: '88.00',
}

export default function WechatReceiveBill() {
  const [data, setData] = useState(DEFAULT_DATA)
  const screenRef = useRef(null)

  const set = (key) => (e) => setData((prev) => ({ ...prev, [key]: e.target.value }))
  const onExport = () => exportImage(screenRef.current, { filename: 'wechat-receive-bill.png' })

  return (
    <div className="page">
      <div className="tool-shell">
        <Panel title="微信收款账单" desc="收款成功账单详情页，右侧实时预览，可一键导出整图。">
          <div className="field-grid">
            <Row2>
              <Field label="付款方">
                <input value={data.payer} onChange={set('payer')} placeholder="请输入付款方" />
              </Field>
              <Field label="收款时间">
                <input value={data.time} onChange={set('time')} placeholder="2026-08-19 16:45" />
              </Field>
            </Row2>
            <Row2>
              <Field label="入账账户">
                <input value={data.account} onChange={set('account')} placeholder="零钱 / 银行卡" />
              </Field>
              <Field label="交易单号">
                <input value={data.tradeNo} onChange={set('tradeNo')} placeholder="请输入交易单号" />
              </Field>
            </Row2>
            <Field label="金额（元）">
              <input value={data.amount} onChange={set('amount')} placeholder="0.00" />
            </Field>
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
                <div className="label">收款成功</div>
                <div className="amount">
                  <small>¥</small>
                  {data.amount}
                </div>
                <div className="detail-list">
                  <div className="detail-item">
                    <span>付款方</span>
                    <span>{data.payer}</span>
                  </div>
                  <div className="detail-item">
                    <span>收款时间</span>
                    <span>{data.time}</span>
                  </div>
                  <div className="detail-item">
                    <span>入账账户</span>
                    <span>{data.account}</span>
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
