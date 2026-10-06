import { useEffect, useState } from 'react'
import { CalendarClock, Clock, MapPin, CheckCircle2, Users } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { staffSchedules, occurrences, sessionState, hm, ymd, STATE_LABEL } from '../../lib/classes'
import { Loading, Empty, Avatar, PageTitle, useToast } from '../../components/ui'
import { PushOptIn, NotificationBell, PushBanner, usePushInbox } from '../../components/Notifications'

/** Alertas del coach (banner + alarma) presentes en toda la zona coach. */
export function CoachAlerts({ me }) {
  const inbox = usePushInbox(me, null, { staff: true })
  return <PushBanner n={inbox.banner} onClose={inbox.closeBanner} />
}

/** Clases que dicta el coach: hoy y próximos días, con alumnos inscritos y asistencia. */
export default function CoachClasses({ me }) {
  const toast = useToast()
  const [d, setD] = useState(null)
  const [now, setNow] = useState(new Date())
  const inbox = usePushInbox(me, null, { staff: true })

  const load = async () => {
    try {
      const scheds = await staffSchedules(me.id)
      const occ = occurrences(scheds, 7)
      const classIds = [...new Set(scheds.map((s) => s.class_id))]
      const [roster, books] = classIds.length ? await Promise.all([
        q(supabase.from('class_members').select('class_id, member_id, members(full_name, photo)').in('class_id', classIds)),
        q(supabase.from('class_bookings').select('*, members(full_name, photo)').in('class_id', classIds).gte('date', ymd(new Date())).neq('status', 'cancelado'))
      ]) : [[], []]
      setD({ occ, roster, books })
    } catch (e) { toast(e.message, 'error'); setD({ occ: [], roster: [], books: [] }) }
  }
  useEffect(() => { load(); const t = setInterval(() => { setNow(new Date()); load() }, 60000); return () => clearInterval(t) }, [me.id])

  const markAttendance = async (o, memberId, on) => {
    await q(supabase.from('class_bookings').upsert({
      schedule_id: o.schedule.id, class_id: o.schedule.class_id, member_id: memberId, date: o.date,
      status: on ? 'asistio' : 'reservado', checked_in_at: on ? new Date().toISOString() : null
    }, { onConflict: 'schedule_id,member_id,date' }))
    load()
  }

  return (
    <>
      <PageTitle a="MIS" b="CLASES"><NotificationBell inbox={inbox} /></PageTitle>
      <div className="mb"><PushOptIn member={me} staff compact /></div>
      {!d ? <Loading /> : !d.occ.length ? <Empty>No tienes clases asignadas. El administrador las programa en /admin, pestaña Clases.</Empty> : (
        <div className="col">
          {d.occ.filter((o) => sessionState(o, now) !== 'finalizada' || o.date === ymd(now)).slice(0, 20).map((o) => {
            const st = sessionState(o, now)
            const [cls, label] = STATE_LABEL[st]
            const people = new Map()
            for (const r of d.roster.filter((r) => r.class_id === o.schedule.class_id)) people.set(r.member_id, { ...r.members, group: true })
            for (const b of d.books.filter((b) => b.schedule_id === o.schedule.id && b.date === o.date)) people.set(b.member_id, { ...(people.get(b.member_id) || b.members), status: b.status })
            const list = [...people.entries()]
            return (
              <div key={o.key} className="card" style={{ borderLeft: `4px solid ${o.cls.color || 'var(--y)'}` }}>
                <div className="row between wrap">
                  <div>
                    <div className="tiny y" style={{ fontWeight: 800, textTransform: 'capitalize' }}>{o.date === ymd(now) ? 'Hoy' : new Date(o.date + 'T12:00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric' })}</div>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{o.cls.name}</div>
                    <div className="tiny muted"><Clock size={11} /> {hm(o.schedule.start_time)} · {o.schedule.duration_min} min{o.cls.room ? <> · <MapPin size={11} /> {o.cls.room}</> : ''}</div>
                  </div>
                  <div className="row"><span className="badge"><Users size={11} /> {list.length}/{o.cls.capacity}</span><span className={`badge ${cls}`}>{label}</span></div>
                </div>
                {list.length ? (
                  <div className="col mt" style={{ gap: 6 }}>
                    {list.map(([id, p]) => (
                      <div key={id} className="row">
                        <Avatar src={p?.photo} name={p?.full_name} />
                        <span className="grow small">{p?.full_name}{p?.group && <span className="tiny muted"> · grupo</span>}</span>
                        {o.date === ymd(now) && (
                          <button className={`btn sm ${p?.status === 'asistio' ? 'primary' : 'ghost'}`} onClick={() => markAttendance(o, id, p?.status !== 'asistio')}>
                            <CheckCircle2 size={14} /> {p?.status === 'asistio' ? 'Asistió' : 'Marcar'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <p className="tiny muted mt">Sin alumnos inscritos todavía.</p>}
              </div>
            )
          })}
        </div>
      )}
      <PushBanner n={inbox.banner} onClose={inbox.closeBanner} />
    </>
  )
}
