// Retos 1 vs 1 entre miembros del gimnasio.
import { supabase, q } from './supabase'
import { today, addDays, daysBetween } from './constants'

export const METRICS = [
  { id: 'calorias', label: 'Más calorías quemadas', unit: 'kcal', emoji: '🔥' },
  { id: 'km', label: 'Más kilómetros', unit: 'km', emoji: '🏃' },
  { id: 'sesiones', label: 'Más entrenamientos', unit: 'entrenos', emoji: '💪' },
  { id: 'minutos', label: 'Más minutos activos', unit: 'min', emoji: '⏱️' },
  { id: 'volumen', label: 'Más kilos levantados', unit: 'kg', emoji: '🏋️' }
]
export const metricOf = (id) => METRICS.find((m) => m.id === id) || METRICS[0]

/** Valor de un cliente en una métrica entre dos fechas (incluidas). */
export async function metricValue(memberId, metric, from, to) {
  const toTs = `${to}T23:59:59`
  const [sessions, acts] = await Promise.all([
    q(supabase.from('workout_sessions').select('calories, hr_kcal, total_sec, volume_kg').eq('member_id', memberId).not('ended_at', 'is', null).gte('date', from).lte('date', to)),
    q(supabase.from('activities').select('calories, distance_m, duration_sec').eq('member_id', memberId).gte('started_at', from).lte('started_at', toTs))
  ])
  const s = (arr, f) => arr.reduce((a, x) => a + Number(f(x) || 0), 0)
  switch (metric) {
    case 'calorias': return Math.round(s(sessions, (x) => x.hr_kcal || x.calories) + s(acts, (x) => x.calories))
    case 'km': return Math.round(s(acts, (x) => x.distance_m) / 100) / 10
    case 'sesiones': return sessions.length + acts.length
    case 'minutos': return Math.round((s(sessions, (x) => x.total_sec) + s(acts, (x) => x.duration_sec)) / 60)
    case 'volumen': return Math.round(s(sessions, (x) => x.volume_kg))
    default: return 0
  }
}

export async function listChallenges(memberId) {
  return q(supabase.from('challenges')
    .select('*, challenger:members!challenges_challenger_id_fkey(id, full_name, photo), opponent:members!challenges_opponent_id_fkey(id, full_name, photo)')
    .or(`challenger_id.eq.${memberId},opponent_id.eq.${memberId}`)
    .order('created_at', { ascending: false }))
}

/** Aviso en la bandeja de notificaciones del otro cliente. */
async function notify(to, title, body) {
  await supabase.from('notifications').insert({
    title, body, category: 'reto', url: '/?tab=challenges', recipients: [to],
    audience: { type: 'members', ids: [to] }, status: 'enviada', sent_at: new Date().toISOString()
  })
}

export async function createChallenge({ me, opponent, metric, days, title }) {
  const start = today()
  const end = addDays(start, days - 1)
  const m = metricOf(metric)
  const row = (await q(supabase.from('challenges').insert({
    challenger_id: me.id, opponent_id: opponent.id, metric, title: title || `${m.emoji} ${m.label}`, start_date: start, end_date: end
  }).select()))[0]
  await notify(opponent.id, '⚔️ ¡Te han retado!', `${me.full_name} te reta: ${m.label} en ${days} días. Entra a Retos para aceptar.`)
  return row
}

export async function answerChallenge(ch, me, accept) {
  // Al aceptar, el reto arranca hoy y conserva los días que se eligieron
  const upd = { status: accept ? 'aceptado' : 'rechazado' }
  if (accept) Object.assign(upd, { start_date: today(), end_date: addDays(today(), daysBetween(ch.start_date, ch.end_date)) })
  await q(supabase.from('challenges').update(upd).eq('id', ch.id))
  await notify(ch.challenger_id, accept ? '🔥 Reto aceptado' : 'Reto rechazado', `${me.full_name} ${accept ? 'aceptó' : 'rechazó'} tu reto: ${ch.title}`)
}

/**
 * Actualiza el marcador de los retos aceptados del cliente y cierra los vencidos
 * (gana quien tenga más; empate = sin ganador).
 */
export async function refreshChallenges(memberId) {
  const list = await q(supabase.from('challenges').select('*').eq('status', 'aceptado').or(`challenger_id.eq.${memberId},opponent_id.eq.${memberId}`))
  const t = today()
  for (const ch of list) {
    const end = ch.end_date < t ? ch.end_date : t
    const [a, b] = await Promise.all([
      metricValue(ch.challenger_id, ch.metric, ch.start_date, end),
      metricValue(ch.opponent_id, ch.metric, ch.start_date, end)
    ])
    const upd = { challenger_value: a, opponent_value: b }
    if (ch.end_date < t) Object.assign(upd, { status: 'terminado', winner_id: a === b ? null : a > b ? ch.challenger_id : ch.opponent_id })
    await supabase.from('challenges').update(upd).eq('id', ch.id)
  }
}
