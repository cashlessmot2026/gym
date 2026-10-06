// Clases grupales: horarios semanales, ocurrencias por fecha, estado y alertas locales.
import { supabase, q } from './supabase'

export const ALERT_MIN = 10          // aviso antes de la clase
export const ENTER_BEFORE_MIN = 15   // se puede "entrar" desde 15 min antes hasta el final

const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const hm = (t) => String(t || '').slice(0, 5)

/** Fecha/hora local de inicio de un horario en una fecha concreta. */
export const startAt = (date, time) => new Date(`${date}T${hm(time)}:00`)

/**
 * Ocurrencias de los horarios en los próximos `days` días (incluye hoy).
 * schedules: [{ id, weekday, start_time, duration_min, gym_classes: {...} }]
 */
export function occurrences(schedules, days = 7, from = new Date()) {
  const out = []
  const base = new Date(from); base.setHours(0, 0, 0, 0)
  for (let i = 0; i < days; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i)
    const date = ymd(d)
    for (const s of schedules) {
      if (s.weekday !== d.getDay() || s.active === false) continue
      const start = startAt(date, s.start_time)
      const end = new Date(start.getTime() + (s.duration_min || 60) * 60000)
      out.push({ key: `${s.id}_${date}`, schedule: s, cls: s.gym_classes, date, start, end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Estado de una sesión respecto a la hora actual. */
export function sessionState(o, now = new Date()) {
  if (now >= o.end) return 'finalizada'
  if (now >= o.start) return 'en_curso'
  if (o.start - now <= ENTER_BEFORE_MIN * 60000) return 'abierta'
  return 'proxima'
}
export const STATE_LABEL = { proxima: ['', 'Próxima'], abierta: ['warn', 'Por empezar'], en_curso: ['ok', 'En curso'], finalizada: ['', 'Finalizada'] }
export const canEnter = (o, now = new Date()) => ['abierta', 'en_curso'].includes(sessionState(o, now))

/** Horarios relevantes para un cliente: clases de sus modalidades + clases de las que es parte del grupo. */
export async function memberSchedules(member) {
  const [roster, classes] = await Promise.all([
    q(supabase.from('class_members').select('class_id').eq('member_id', member.id)),
    q(supabase.from('gym_classes').select('id, training_type').eq('active', true))
  ])
  const mine = new Set(roster.map((r) => r.class_id))
  const modes = member.training_modes || []
  const ids = classes.filter((c) => mine.has(c.id) || modes.includes(c.training_type)).map((c) => c.id)
  if (!ids.length) return { schedules: [], roster: mine }
  const schedules = await q(supabase.from('class_schedules').select('*, gym_classes(*, coach:staff(full_name))').in('class_id', ids).eq('active', true))
  return { schedules: schedules.filter((s) => s.gym_classes?.active), roster: mine }
}

/** Horarios que dicta un coach (asignado a la clase o al horario). */
export async function staffSchedules(staffId) {
  const [byClass, bySched] = await Promise.all([
    q(supabase.from('gym_classes').select('id').eq('coach_id', staffId).eq('active', true)),
    q(supabase.from('class_schedules').select('id').eq('coach_id', staffId))
  ])
  const classIds = byClass.map((c) => c.id)
  const parts = []
  if (classIds.length) parts.push(`class_id.in.(${classIds.join(',')})`)
  if (bySched.length) parts.push(`id.in.(${bySched.map((s) => s.id).join(',')})`)
  if (!parts.length) return []
  const rows = await q(supabase.from('class_schedules').select('*, gym_classes(*)').or(parts.join(',')).eq('active', true))
  // si el horario tiene otro coach asignado, no es de este coach
  return rows.filter((s) => s.gym_classes?.active && (!s.coach_id || s.coach_id === staffId))
}

/**
 * App Android: programa en el teléfono las alertas (canal "clases", con alarma) 10 min antes
 * de cada clase de los próximos 7 días. Funciona con la app cerrada y sin internet.
 */
export async function scheduleClassAlerts(owner) {
  if (!window.Capacitor?.isNativePlatform?.() || localStorage.getItem('iy_push_native') !== 'granted') return 0
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  let occ = []
  if (owner.member_id) {
    const [m] = await q(supabase.from('members').select('id, training_modes').eq('id', owner.member_id))
    if (!m) return 0
    const { schedules, roster } = await memberSchedules(m)
    const today = ymd(new Date())
    const books = await q(supabase.from('class_bookings').select('schedule_id, date').eq('member_id', m.id).gte('date', today).neq('status', 'cancelado'))
    const booked = new Set(books.map((b) => `${b.schedule_id}_${b.date}`))
    // alerta para su grupo fijo y para las clases que reservó
    occ = occurrences(schedules, 7).filter((o) => roster.has(o.schedule.class_id) || booked.has(o.key))
  } else if (owner.staff_id) {
    occ = occurrences(await staffSchedules(owner.staff_id), 7)
  }
  const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }))
  const old = pending.notifications.filter((n) => n.extra?.kind === 'clase')
  if (old.length) await LocalNotifications.cancel({ notifications: old.map((n) => ({ id: n.id })) })
  const now = Date.now()
  const list = occ
    .map((o) => ({ o, at: new Date(o.start.getTime() - ALERT_MIN * 60000) }))
    .filter(({ at }) => at.getTime() > now + 5000)
    .slice(0, 40)
    .map(({ o, at }) => ({
      id: 700000 + (Math.abs([...o.key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 200000),
      title: owner.staff_id ? `⏰ Clase ${o.cls.name} en ${ALERT_MIN} minutos` : `⏰ Tu clase de ${o.cls.name} empieza en ${ALERT_MIN} minutos`,
      body: `Hoy a las ${hm(o.schedule.start_time)}${o.cls.room ? ' · ' + o.cls.room : ''}. ¡Prepárate!`,
      channelId: 'clases',
      schedule: { at, allowWhileIdle: true },
      extra: { kind: 'clase', url: owner.staff_id ? '/coach' : '/?tab=classes' }
    }))
  if (list.length) await LocalNotifications.schedule({ notifications: list })
  return list.length
}
