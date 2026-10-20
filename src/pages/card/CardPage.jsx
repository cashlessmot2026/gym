import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Gift, CalendarCheck } from 'lucide-react'
import { getCardByToken, watchCard } from '../../lib/loyalty'
import LoyaltyCard, { Fireworks } from '../../components/LoyaltyCard'
import { Brand, Loading } from '../../components/ui'

/** Tarjeta de fidelidad del cliente temporal: se abre con el link que envía el admin (sin iniciar sesión). */
export default function CardPage() {
  const { token } = useParams()
  const [card, setCard] = useState(undefined)
  const [err, setErr] = useState('')
  const [stamped, setStamped] = useState(false)
  const [party, setParty] = useState(false)
  const prev = useRef(null)

  const load = async () => {
    try {
      const c = await getCardByToken(token)
      const p = prev.current
      if (p && c && c.days_done > p.days_done) { setStamped(true); setTimeout(() => setStamped(false), 2800) }
      if (c && c.gift_days > 0 && (!p || p.gift_days === 0)) { setParty(true); setTimeout(() => setParty(false), 3400) }
      prev.current = c
      setCard(c); setErr('')
    } catch (e) { setErr(e.message); setCard((x) => x ?? null) }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    const vis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [token])
  useEffect(() => { if (card?.id) return watchCard(card.id, load) }, [card?.id])

  return (
    <div className="lc-page">
      <Brand sub="TARJETA DE FIDELIDAD" />
      {card === undefined ? <Loading /> : !card ? (
        <div className="card center col" style={{ alignItems: 'center' }}>
          <CalendarCheck size={40} className="y" />
          <h2 style={{ margin: 0 }}>{err ? 'No encontramos tu tarjeta' : 'Esta tarjeta ya terminó'}</h2>
          <p className="muted" style={{ margin: 0 }}>{err || 'Completaste tu plan. Pide una tarjeta nueva en recepción para seguir entrenando.'}</p>
        </div>
      ) : (
        <>
          <div className="row between small muted"><span>Hola, <b style={{ color: 'var(--tx)' }}>{card.full_name.split(' ')[0]}</b></span><span>Toca la tarjeta para girarla</span></div>
          <LoyaltyCard card={card} justStamped={stamped} />
          <div className="card col" style={{ gap: 8 }}>
            {card.gift_days > 0 ? (
              <p style={{ margin: 0 }}><Gift size={16} className="y" /> <b>¡Completaste tus {card.plan_days} días!</b> Tienes <b className="y">1 día gratis</b>. Muestra el QR en recepción para usarlo; después la tarjeta se cierra.</p>
            ) : (
              <p style={{ margin: 0 }}>Llevas <b className="y">{card.days_done}</b> de <b>{card.plan_days}</b> días. {card.plan_days === 14
                ? <>Te faltan <b>{card.plan_days - card.days_done}</b> para ganar <b className="y">1 día gratis</b>.</>
                : <>Te faltan <b>{card.plan_days - card.days_done}</b> para terminar tu plan.</>}</p>
            )}
            <p className="tiny muted" style={{ margin: 0 }}>Muestra el QR (al girar la tarjeta) en recepción cada día que vengas. Guarda este link o agrégalo a tu pantalla de inicio.</p>
          </div>
        </>
      )}
      <Fireworks show={party} />
    </div>
  )
}
