import { useEffect, useRef, useState } from 'react'
import { Bell, BellRing, BellOff, X, Megaphone, Tag, Calendar, Info, Clock } from 'lucide-react'
import { supabase, q } from '../lib/supabase'
import { enablePush, disablePush, pushPermission, pushSupport, syncPush, listenPushMessages, isForMember, isForStaff, showNativeNow, isNative } from '../lib/push'
import { playAlarm } from '../lib/alarm'
import { scheduleClassAlerts } from '../lib/classes'
import { fmtDateTime } from '../lib/constants'
import { Spinner, Empty, useToast } from './ui'

export const CATEGORY = {
  promo: { label: 'Promoción', icon: Tag },
  publicidad: { label: 'Publicidad', icon: Megaphone },
  aviso: { label: 'Aviso', icon: Info },
  evento: { label: 'Evento', icon: Calendar },
  recordatorio: { label: 'Recordatorio', icon: Clock },
  clase: { label: 'Clase', icon: BellRing }
}

/**
 * Bandeja de notificaciones del cliente:
 * carga el historial, escucha Realtime (app abierta) y mensajes del Service Worker / nativo.
 */
export function usePushInbox(member, onOpenUrl, { staff = false } = {}) {
  const owner = staff ? { staff_id: member.id } : { member_id: member.id }
  const mine = (n) => (staff ? isForStaff(n, member.id) : isForMember(n, member.id))
  const [items, setItems] = useState([])
  const [banner, setBanner] = useState(null)
  const shown = useRef(new Set())
  const readKey = `iy_push_read_${member.id}`
  const [lastRead, setLastRead] = useState(() => localStorage.getItem(readKey) || '1970-01-01')

  const show = (n) => {
    if (!n?.id || shown.current.has(n.id)) return
    shown.current.add(n.id)
    setBanner(n)
    if (n.category === 'clase') playAlarm(); else navigator.vibrate?.([80, 40, 80])
    // App nativa en segundo plano: además, notificación del sistema
    if (isNative() && document.visibilityState !== 'visible') showNativeNow(n)
  }

  useEffect(() => {
    const base = supabase.from('notifications').select('*').neq('status', 'error')
    q((staff ? base.contains('audience', { staff_ids: [member.id] }) : base.or(`recipients.is.null,recipients.cs.{${member.id}}`))
      .order('created_at', { ascending: false }).limit(50))
      .then((r) => { setItems(r); r.forEach((n) => shown.current.add(n.id)) })
      .catch(() => {})

    syncPush(owner)
    // App Android: reprograma las alertas de clase al volver a la app
    let resumeOff = null
    if (isNative()) import('@capacitor/app').then(({ App }) => {
      const h = App.addListener('resume', () => { if (pushPermission() === 'granted') scheduleClassAlerts(owner).catch(() => {}) })
      resumeOff = () => Promise.resolve(h).then((x) => x?.remove?.())
    })

    const ch = supabase.channel(`push-${member.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, ({ new: n }) => {
        if (!mine(n)) return
        setItems((x) => [n, ...x.filter((y) => y.id !== n.id)])
        show({ ...n, image: n.image_url })
      })
      .subscribe()

    const off = listenPushMessages({
      onMessage: (p) => show(p),
      onOpen: (d) => d.url && onOpenUrl?.(d.url)
    })
    return () => { supabase.removeChannel(ch); off(); resumeOff?.() }
  }, [member.id])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 9000)
    return () => clearTimeout(t)
  }, [banner])

  const unread = items.filter((n) => n.created_at > lastRead).length
  const markRead = () => { const now = new Date().toISOString(); localStorage.setItem(readKey, now); setLastRead(now) }
  return { items, unread, markRead, banner, closeBanner: () => setBanner(null) }
}

export function PushBanner({ n, onClose, onOpen }) {
  if (!n) return null
  const C = CATEGORY[n.category] || CATEGORY.promo
  return (
    <div className="push-banner" onClick={() => { onOpen?.(n.url); onClose() }}>
      {n.image && <img src={n.image} alt="" />}
      <div className="row" style={{ alignItems: 'flex-start', padding: 14 }}>
        <div className="brand-logo" style={{ width: 36, height: 36 }}><C.icon size={18} /></div>
        <div className="grow">
          <div className="tiny y" style={{ fontWeight: 800, letterSpacing: '.08em' }}>{C.label.toUpperCase()} · AHORA</div>
          <div style={{ fontWeight: 800 }}>{n.title}</div>
          <div className="small muted">{n.body}</div>
        </div>
        <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onClose() }}><X size={16} /></button>
      </div>
    </div>
  )
}

export function NotificationBell({ inbox, onOpen }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="btn sm bell" onClick={() => { setOpen(true); inbox.markRead() }} aria-label="Notificaciones">
        {inbox.unread ? <BellRing size={16} className="y" /> : <Bell size={16} />}
        {inbox.unread > 0 && <span className="bell-dot">{inbox.unread > 9 ? '9+' : inbox.unread}</span>}
      </button>
      {open && (
        <div className="overlay" style={{ placeItems: 'stretch end', padding: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="drawer">
            <div className="modal-h"><h2>Notificaciones</h2><button className="icon-btn" onClick={() => setOpen(false)}><X /></button></div>
            {!inbox.items.length && <Empty>No tienes notificaciones todavía</Empty>}
            <div className="col">
              {inbox.items.map((n) => {
                const C = CATEGORY[n.category] || CATEGORY.promo
                return (
                  <div key={n.id} className="card card-click" style={{ padding: 0, overflow: 'hidden' }} onClick={() => { onOpen?.(n.url); setOpen(false) }}>
                    {n.image_url && <img src={n.image_url} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />}
                    <div style={{ padding: 14 }}>
                      <div className="row between"><span className="badge y"><C.icon size={11} /> {C.label}</span><span className="tiny muted">{fmtDateTime(n.created_at)}</span></div>
                      <div style={{ fontWeight: 800, marginTop: 8 }}>{n.title}</div>
                      <div className="small muted">{n.body}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Tarjeta para activar/desactivar las notificaciones push en este dispositivo. */
export function PushOptIn({ member, compact, staff = false }) {
  const owner = staff ? { staff_id: member.id } : { member_id: member.id }
  const toast = useToast()
  const [perm, setPerm] = useState(pushPermission())
  const [busy, setBusy] = useState(false)
  const support = pushSupport()

  const on = async () => {
    setBusy(true)
    try { await enablePush(owner); setPerm('granted'); toast('🔔 Notificaciones activadas', 'success') } catch (e) { setPerm(pushPermission()); toast(e.message, 'error') } finally { setBusy(false) }
  }
  const off = async () => {
    setBusy(true)
    try { await disablePush(); toast('Notificaciones desactivadas en este dispositivo') } finally { setBusy(false); setPerm(pushPermission() === 'granted' && support === 'web' ? 'paused' : pushPermission()) }
  }

  if (compact) {
    if (perm === 'granted' || !support) return null
    return (
      <div className="card hl row between wrap">
        <div className="row"><BellRing className="y" /><div><b>Activa las notificaciones</b><div className="small muted">Recibe promociones y la alerta con alarma 10 minutos antes de tus clases, aunque la app esté cerrada.</div></div></div>
        <button className="btn primary" onClick={on} disabled={busy || perm === 'denied'}>{busy ? <Spinner /> : <Bell size={16} />} {perm === 'denied' ? 'Bloqueadas en el navegador' : 'Activar'}</button>
      </div>
    )
  }
  return (
    <div className="card">
      <div className="row between"><div className="row"><Bell className="y" /><h3 style={{ margin: 0 }}>Notificaciones push</h3></div>
        {perm === 'granted' ? <span className="badge ok">Activas</span> : perm === 'denied' ? <span className="badge bad">Bloqueadas</span> : <span className="badge">Inactivas</span>}</div>
      <p className="small muted">Recibe en este dispositivo promociones, avisos y la alerta con alarma 10 minutos antes de cada clase, con la app abierta o cerrada.</p>
      {!support && <p className="tiny warn">No soportado en este navegador. En iPhone instala la app en la pantalla de inicio (iOS 16.4+).</p>}
      {perm === 'denied' && <p className="tiny warn">Las bloqueaste: habilítalas en la configuración del sitio del navegador.</p>}
      <div className="row">
        {perm === 'granted'
          ? <button className="btn ghost" onClick={off} disabled={busy}><BellOff size={16} /> Desactivar</button>
          : <button className="btn primary" onClick={on} disabled={busy || !support || perm === 'denied'}>{busy ? <Spinner /> : <Bell size={16} />} Activar</button>}
      </div>
    </div>
  )
}
