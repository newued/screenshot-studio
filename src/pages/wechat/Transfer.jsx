// 微信转账详情
import React, { useRef, useState } from 'react'
import Panel from '../../components/ui/Panel'
import { Field, Row2 } from '../../components/ui/Field'
import Button from '../../components/ui/Button'
import PhoneFrame from '../../components/phone/Phone'
import { exportImage } from '../../lib/exportImage'

const DEFAULT_DATA = {
  note: '周末聚餐 AA 费用',
  time: '2026-08-19 12:30',
  payee: '张三',
  method: '零钱',
  amount: '200.00',
}

export default function WechatTransfer() {
  const [data, setData] = useState(DEFAULT_DATA)
  const screenRef = useRef(null)

  const set = (key) => (e) => setData((prev) => ({ ...prev, [key]: e.target.value }))
  const onExport = () => exportImage(screenRef.current, { filename: 'wechat-transfer.png' })

  return (
    <div className="page">
      <div className="tool-shell">
        <Panel title="微信转账详情" desc="转账成功页面、金额、时间、对方，右侧实时预览，可一键导出整图。">
          <div className="field-grid">
            <Row2>
              <Field label="转账说明">
                <input value={data.note} onChange={set('note')} placeholder="请输入转账说明" />
              </Field>
              <Field label="转账时间">
                <input value={data.time} onChange={set('time')} placeholder="2026-08-19 12:30" />
              </Field>
            </Row2>
            <Row2>
              <Field label="收款人">
                <input value={data.payee} onChange={set('payee')} placeholder="请输入收款人" />
              </Field>
              <Field label="付款方式">
                <input value={data.method} onChange={set('method')} placeholder="零钱 / 银行卡" />
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
          <PhoneFrame time="9:41" navTitle="微信转账" platform="wechat" screenRef={screenRef}>
            <div className="page-white">
              <div className="money-page">
                <div className="success-icon">✓</div>
                <div className="label">转账成功</div>
                <div className="amount">
                  <small>¥</small>
                  {data.amount}
                </div>
                <div className="detail-list">
                  <div className="detail-item">
                    <span>转账说明</span>
                    <span>{data.note}</span>
                  </div>
                  <div className="detail-item">
                    <span>转账时间</span>
                    <span>{data.time}</span>
                  </div>
                  <div className="detail-item">
                    <span>收款人</span>
                    <span>{data.payee}</span>
                  </div>
                  <div className="detail-item">
                    <span>付款方式</span>
                    <span>{data.method}</span>
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
