import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { cardQr } from '../lib/loyalty'

const Star = ({ filled, burst }) => (
  <svg viewBox="0 0 24 24" className={`lc-slot${filled ? ' on' : ''}${burst ? ' burst' : ''}`} aria-hidden>
    <path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5l-6 3.4 1.3-6.7-5-4.7 6.8-.8z" />
  </svg>
)

const fmt = (iso) => new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '')
const spaced = (code) => (code || '').replace(/(.{4})/g, '$1 ').trim()

function Qr({ value, size = 128 }) {
  const [url, setUrl] = useState('')
  useEffect(() => { QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' }).then(setUrl) }, [value, size])
  return url ? <img src={url} alt={value} /> : null
}

/** Tarjeta tipo crédito: frente = días (estrellas), dorso = fechas confirmadas + QR. Toca para girarla. */
export default function LoyaltyCard({ card, justStamped }) {
  const [flipped, setFlipped] = useState(false)
  const { full_name, code, plan_days, days_done } = card
  const ready = (card.gift_days || 0) > 0
  const filled = Math.min(days_done, plan_days)
  const dated = (card.visits || []).filter((v) => v.kind === 'dia').sort((a, b) => b.created_at.localeCompare(a.created_at))
  const flip = () => setFlipped((f) => !f)
  const prev = useRef(days_done)
  useEffect(() => { if (days_done !== prev.current) { prev.current = days_done; setFlipped(false) } }, [days_done])

  return (
    <div className="lc-scene">
      <div role="button" tabIndex={0} className={`lc-card${flipped ? ' flipped' : ''}${ready ? ' ready' : ''}`}
        onClick={flip} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), flip())}
        aria-label={flipped ? 'Ver frente de la tarjeta' : 'Ver dorso de la tarjeta'}>
        <span className="lc-face lc-front">
          <span className="lc-sheen" />
          <span className="lc-row">
            <span className="lc-biz">MERCURY FITNESS CLUB</span>
            <span className="lc-chip" aria-hidden />
          </span>
          {ready ? (
            <span className="lc-redeem">
              <span className="lc-redeem-txt">
                <b>¡Ya tienes tu día gratis disponible!</b>
                <i>Redímelo mostrando este QR en recepción.</i>
              </span>
              <span className="lc-redeem-qr"><Qr value={cardQr(code)} /></span>
            </span>
          ) : (
            <>
              <span className="lc-count">
                <b>{days_done}</b>
                <i>de {plan_days} días{plan_days === 14 ? ' · 1 gratis al final' : ''}</i>
              </span>
              <span className="lc-slots" aria-label={`${filled} de ${plan_days} días`}>
                {Array.from({ length: plan_days }, (_, i) => <Star key={i} filled={i < filled} burst={justStamped && i === filled - 1} />)}
              </span>
            </>
          )}
          <span className="lc-row">
            <span className="lc-holder">{full_name}</span>
            <span className="lc-num">{spaced(code)}</span>
          </span>
          {justStamped && (
            <span className="lc-stamp" role="status">
              <svg viewBox="0 0 120 120" aria-hidden><circle cx="60" cy="60" r="46" className="ring" /><path d="M38 62l15 15 30-34" className="tick" /></svg>
              <em>+1 día</em>
            </span>
          )}
        </span>

        <span className="lc-face lc-back">
          <span className="lc-stripe" />
          <span className="lc-back-body">
            <span className="lc-log">
              <b>Días confirmados</b>
              {dated.length === 0 && <i className="lc-empty">Aún no hay días. Muestra tu QR en recepción.</i>}
              {dated.slice(0, 5).map((v, i) => (
                <span key={i} className="lc-entry"><time>{fmt(v.created_at)}</time><span>Día {dated.length - i}</span></span>
              ))}
            </span>
            <span className="lc-qr"><Qr value={cardQr(code)} /><small>{code}</small></span>
          </span>
        </span>
      </div>
    </div>
  )
}

const COLORS = ['#FFD60A', '#FFC300', '#FF6B8B', '#7AB8FF', '#FFFFFF', '#22C55E']

/** Juegos pirotécnicos a pantalla completa mientras `show` sea true. */
export function Fireworks({ show, duration = 3200 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!show) return
    const cv = ref.current
    if (!cv || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const ctx = cv.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr)
    let parts = [], raf, nextBurst = 0
    const start = performance.now()
    let last = start
    const burst = () => {
      const x = (0.15 + Math.random() * 0.7) * W, y = (0.12 + Math.random() * 0.4) * H
      const c = COLORS[(Math.random() * COLORS.length) | 0], n = 46
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, sp = (1.5 + Math.random() * 3.2) * dpr
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, c, r: (1.2 + Math.random() * 1.6) * dpr })
      }
    }
    const tick = (t) => {
      const dt = Math.min((t - last) / 16.7, 3); last = t
      if (t - start < duration - 900 && t >= nextBurst) { burst(); nextBurst = t + 260 + Math.random() * 280 }
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'
      parts = parts.filter((p) => p.life > 0)
      for (const p of parts) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.045 * dpr * dt; p.vx *= 0.985; p.life -= 0.013 * dt
        ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.c
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill()
      }
      if (t - start < duration) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, W, H)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H) }
  }, [show, duration])
  if (!show) return null
  return <canvas ref={ref} aria-hidden style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 60 }} />
}
