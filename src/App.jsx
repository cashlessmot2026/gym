import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ToastProvider, Loading } from './components/ui'

const ClientApp = lazy(() => import('./pages/client/ClientApp'))
const AdminApp = lazy(() => import('./pages/admin/AdminApp'))
const CoachApp = lazy(() => import('./pages/coach/CoachApp'))
const CheckApp = lazy(() => import('./pages/check/CheckApp'))
const CardPage = lazy(() => import('./pages/card/CardPage'))

// 4 interfaces: cliente (/), administración (/admin, oculta), coach (/coach) y check-in (/check)
// + tarjeta de fidelidad pública del cliente temporal (/tarjeta/<token>)
export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
        <Suspense fallback={<div className="main"><Loading /></div>}>
          <Routes>
            <Route path="/" element={<ClientApp />} />
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="/coach/*" element={<CoachApp />} />
            <Route path="/check/*" element={<CheckApp />} />
            <Route path="/tarjeta/:token" element={<CardPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  )
}
