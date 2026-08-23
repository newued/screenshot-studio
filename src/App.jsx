import React, { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ToastHost from './components/ui/Toast'

// 路由懒加载：页面级代码分割，首屏只加载 Home + 公共依赖
const Home = lazy(() => import('./pages/Home'))
const WechatGroup = lazy(() => import('./pages/wechat/Group'))
const Balance = lazy(() => import('./pages/wechat/Balance'))
const WechatSingle = lazy(() => import('./pages/wechat/Single'))
const QqChat = lazy(() => import('./pages/qq/Chat'))
const WechatBill = lazy(() => import('./pages/wechat/Bill'))
const Placeholder = lazy(() => import('./pages/Placeholder'))

// 其余页面已全部实现，无占位路由
const PENDING = []

function PageLoading() {
  return <div className="page-loading">加载中…</div>
}

export default function App() {
  return (
    <AppShell>
      <ToastHost />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/wechat/group" element={<WechatGroup />} />
          <Route path="/wechat/balance" element={<Balance />} />
          <Route path="/wechat/single" element={<WechatSingle />} />
          <Route path="/qq/chat" element={<QqChat />} />
          <Route path="/wechat/bill" element={<WechatBill key="bill" defaultType="pay_person" />} />
          <Route path="/wechat/pay" element={<WechatBill key="pay" defaultType="pay_merchant" />} />
          <Route path="/wechat/transfer" element={<WechatBill key="transfer" defaultType="transfer" />} />
          <Route path="/wechat/receive-bill" element={<WechatBill key="receive-bill" defaultType="receive" />} />
          {PENDING.map((p) => (
            <Route key={p.path} path={p.path} element={<Placeholder title={p.title} />} />
          ))}
        </Routes>
      </Suspense>
    </AppShell>
  )
}