// 微信零钱页：参考真实截图还原"我的零钱"
import React, { useRef, useState } from 'react'
import Panel from '../../components/ui/Panel'
import { Field, Row2 } from '../../components/ui/Field'
import Button from '../../components/ui/Button'
import PhoneFrame from '../../components/phone/Phone'
import { exportImage } from '../../lib/exportImage'

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="#c5c5c5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4l6 6-6 6" />
    </svg>
  )
}

export default function Balance() {
  const [balance, setBalance] = useState('2.69')
  const [yieldRate, setYieldRate] = useState('0.94%')
  const screenRef = useRef(null)

  const onExport = () => exportImage(screenRef.current, { filename: 'wechat-balance.png' })

  return (
    <div className="page">
      <div className="tool-shell">
        <Panel title="微信零钱" desc="参考真实截图还原「我的零钱」页面：余额、零钱通入口、充值/提现按钮。">
          <div className="field-grid">
            <Row2>
              <Field label="余额金额（元）">
                <input value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="七日年化">
                <input value={yieldRate} onChange={(e) => setYieldRate(e.target.value)} placeholder="0.94%" />
              </Field>
            </Row2>
          </div>
          <div className="btn-row">
            <Button onClick={onExport}>导出整图</Button>
          </div>
        </Panel>

        <aside className="preview-col">
          <PhoneFrame time="20:56" navTitle="" rightNavTitle="零钱明细" platform="wechat" back more={false} screenRef={screenRef}>
            <div className="page-white">
              <div className="wechat-balance">
                <div className="wb-balance-icon"><img src="/icons/weixinyue.svg" alt="零钱" /></div>
                <div className="wb-balance-label">我的零钱</div>
                <div className="wb-balance-amount">
                  <small>¥</small>
                  {balance}
                </div>

                <div className="wb-licaitong">
                  <div className="wb-licaitong-icon"><img src="/icons/lingqiantong.svg" alt="零钱通" /></div>
                  <div className="wb-licaitong-text">
                    <div className="wb-licaitong-title">转入零钱通，能赚又能花</div>
                    <div className="wb-licaitong-sub">零钱通 七日年化{yieldRate}</div>
                  </div>
                  <div className="wb-licaitong-arrow"><ArrowIcon /></div>
                </div>

                <div className="wb-balance-actions">
                  <button className="wb-btn wb-btn-recharge">充值</button>
                  <button className="wb-btn wb-btn-withdraw">提现</button>
                </div>

                <div className="wb-balance-footer">
                  <span className="wb-link">常见问题</span>
                  <span className="wb-footer-note">本服务由财付通提供</span>
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
