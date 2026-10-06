import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Clock, MapPin, Users, DoorOpen, CheckCircle2, X, AlarmClock } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { memberSchedules, occurrences, sessionState, canEnter, hm, ymd, STATE_LABEL, scheduleClassAlerts, ENTER_BEFORE_MIN } from '../../lib/classes'
import { fmtTime } from '../../lib/constants'
import { Loading, Empty, Spinner, useToast } from '../../components/ui'

const dayLabel = (date) => {
  const t = ymd(new Date())
  const m = new Date(); m.setDate(m.getDate() + 1)
  if (date === t) return 'Hoy'
  if (date === ymd(m)) return 'Mañana'
  return new Date(date + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })
}

/** Clases grupales del cliente: próximas sesiones, reservar ("Asistir") y "Entrar" a la clase. */
export default function Classes({ member }) {
  const toast = useToast()
  const [d, setD] = useState(null)
  const [now, setNow] = useState(new Date())
  const [busy, setBusy] = useState(null)

  const load = async () => {
    try {
      const { schedules, roster } = await memberSchedules(member)
      const occ = occurrences(schedules, 7)
      const ids = [...new Set(occ.map((o) => o.schedule.id))]
      const books = ids.length ? await q(supabase.from('class_bookings').select('*').in('schedule_id', ids).gte('date', ymd(new Date())).neq('status', 'cancelado')) : []
      const rosterIds = {}
      if (schedules.length) {
        const r = await q(supabase.from('class_members').select('class_id, member_id').in('class_id', [...new Set(schedules.map((s) => s.class_id))]))
        for (const x of r) (rosterIds[x.class_id] ??= new Set()).add(x.member_id)
      }
      setD({ occ, roster, books, rosterIds })
    } catch (e) { toast(e.message, 'error'); setD({ occ: [], roster: new Set(), books: [], rosterIds: {} }) }
  }
  useEffect(() => { load() }, [member.id])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t) }, [])

  const mine = (o) => d.books.find((b) => b.schedule_id === o.schedule.id && b.date === o.date && b.member_id === member.id)
  // Cupos ocupados = grupo fijo ∪ reservas de ese día (sin contar dos veces)
  const taken = (o) => new Set([...(d.rosterIds[o.schedule.class_id] || []), ...d.books.filter((b) => b.schedule_id === o.schedule.id && b.date === o.date).map((b) => b.member_id)]).size

  const act = async (o, status) => {
    setBusy(o.key)
    try {
      const b = mine(o)
      if (status === 'reservado' && !b && !d.roster.has(o.schedule.class_id) && taken(o) >= o.cls.capacity) { toast('La clase está llena', 'error'); return }
      const row = { schedule_id: o.schedule.id, class_id: o.schedule.class_id, member_id: member.id, date: o.date, status, checked_in_at: status === 'asistio' ? new Date().toISOString() : b?.checked_in_at || null }
      await q(supabase.from('class_bookings').upsert(row, { onConflict: 'schedule_id,member_id,date' }))
      toast(status === 'asistio' ? '¡Asistencia registrada! Buena clase 🥊' : status === 'reservado' ? 'Cupo reservado. Te avisaremos 10 minutos antes ⏰' : 'Reserva cancelada', 'success')
      await load()
      scheduleClassAlerts({ member_id: member.id }).catch(() => {})
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }

  const groups = useMemo(() => {
    if (!d) return []
    const g = {}
    for (const o of d.occ) if (sessionState(o, now) !== 'finalizada' || o.date === ymd(now)) (g[o.date] ??= []).push(o)
    return Object.entries(g)
  }, [d, now])

  if (!d) return <Loading />
  if (!d.occ.length) return <Empty>Todavía no hay clases programadas para tus modalidades. El gimnasio publicará los horarios pronto.</Empty>

  const next = d.occ.find((o) => sessionState(o, now) !== 'finalizada' && (mine(o) || d.roster.has(o.schedule.class_id))) || d.occ.find((o) => sessionState(o, now) !== 'finalizada')
  const secs = next ? Math.max(0, (next.start - now) / 1000) : 0

  return (
    <div className="col">
      {next && (
        <div className="card hl class-hero" style={{ borderColor: next.cls.color || 'var(--y)' }}>
          <div className="row between wrap">
            <div>
              <div className="tiny y" style={{ fontWeight: 800, letterSpacing: '.1em' }}>PRÓXIMA CLASE · {dayLabel(next.date).toUpperCase()}</div>
              <div className="display" style={{ fontSize: '2.2rem', lineHeight: 1.05 }}>{next.cls.name}</div>
              <div className="small muted"><Clock size={12} /> {hm(next.schedule.start_time)} · {next.schedule.duration_min} min{next.cls.room ? <> · <MapPin size={12} /> {next.cls.room}</> : ''}{next.cls.coach?.full_name ? ` · Coach ${next.cls.coach.full_name}` : ''}</div>
            </div>
            <div className="center">
              {sessionState(next, now) === 'en_curso' ? <span className="badge ok">En curso</span> : <><div className="display y" style={{ fontSize: '2.6rem' }}>{secs > 86400 ? `${Math.floor(secs / 86400)}d` : fmtTime(secs)}</div><div className="tiny muted">para empezar</div></>}
            </div>
          </div>
          <SessionActions o={next} b={mine(next)} inGroup={d.roster.has(next.schedule.class_id)} now={now} busy={busy === next.key} onAct={act} full={taken(next) >= next.cls.capacity} />
        </div>
      )}

      <p className="tiny muted" style={{ margin: 0 }}><AlarmClock size={12} /> Recibirás una alerta con sonido 10 minutos antes de tus clases (grupo fijo o reservadas). Puedes entrar desde {ENTER_BEFORE_MIN} minutos antes.</p>

      {groups.map(([date, list]) => (
        <div key={date}>
          <div className="group-h y" style={{ textTransform: 'capitalize' }}>{dayLabel(date)}</div>
          <div className="col" style={{ gap: 10 }}>
            {list.map((o) => {
              const st = sessionState(o, now)
              const [cls, label] = STATE_LABEL[st]
              const t = taken(o)
              return (
                <div key={o.key} className={`class-card ${st}`} style={{ borderLeftColor: o.cls.color || 'var(--y)' }}>
                  <div className="class-time"><div className="display">{hm(o.schedule.start_time)}</div><div className="tiny muted">{o.schedule.duration_min} min</div></div>
                  <div className="grow">
                    <div className="row wrap" style={{ gap: 6 }}><b>{o.cls.name}</b>{d.roster.has(o.schedule.class_id) && <span className="badge y">Tu grupo</span>}<span className={`badge ${cls}`}>{label}</span></div>
                    <div className="tiny muted">{o.cls.training_type}{o.cls.coach?.full_name ? ` · Coach ${o.cls.coach.full_name}` : ''}{o.cls.room ? ` · ${o.cls.room}` : ''} · <Users size={11} /> {t}/{o.cls.capacity}</div>
                    <SessionActions o={o} b={mine(o)} inGroup={d.roster.has(o.schedule.class_id)} now={now} busy={busy === o.key} onAct={act} full={t >= o.cls.capacity} compact />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function SessionActions({ o, b, inGroup, now, busy, onAct, full, compact }) {
  const st = sessionState(o, now)
  const cls = compact ? 'btn sm' : 'btn'
  if (b?.status === 'asistio') return <div className="mt"><span className="badge ok"><CheckCircle2 size={12} /> Asististe</span></div>
  if (st === 'finalizada') return null
  return (
    <div className="row wrap mt" style={{ gap: 6 }}>
      {canEnter(o, now) && <button className={`${cls} primary`} disabled={busy} onClick={() => onAct(o, 'asistio')}>{busy ? <Spinner size={14} /> : <DoorOpen size={16} />} Entrar a la clase</button>}
      {!canEnter(o, now) && (b?.status === 'reservado'
        ? <><span className="badge ok"><CheckCircle2 size={12} /> Reservado</span><button className={`${cls} ghost`} disabled={busy} onClick={() => onAct(o, 'cancelado')}><X size={14} /> Cancelar</button></>
        : inGroup
          ? <><span className="badge y">Inscrito por tu grupo</span><button className={cls} disabled={busy} onClick={() => onAct(o, 'reservado')}><CalendarClock size={14} /> Confirmar asistencia</button></>
          : <button className={`${cls} primary`} disabled={busy || full} onClick={() => onAct(o, 'reservado')}>{busy ? <Spinner size={14} /> : <CalendarClock size={14} />} {full ? 'Clase llena' : 'Asistir'}</button>)}
    </div>
  )
}
