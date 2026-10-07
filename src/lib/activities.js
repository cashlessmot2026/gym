// Historial de actividad del cliente: sus rutinas hechas en la app (tabla workout_sessions)
// y las actividades guardadas anteriormente (tabla activities).
// Tras terminar una rutina se actualizan el ranking y los retos.
import { supabase, q } from './supabase'
import { refreshScore } from './ranking'
import { refreshChallenges } from './challenges'

/** Ranking + retos al día tras terminar una rutina o guardar medidas. */
export async function afterSync(member) {
  await Promise.all([refreshScore(member), refreshChallenges(member.id)]).catch((e) => console.warn('[sync]', e))
}

/** Rutinas terminadas en la app, con el mismo formato que las actividades. */
async function listWorkouts(memberId, limit) {
  const rows = await q(supabase.from('workout_sessions').select('*').eq('member_id', memberId).not('ended_at', 'is', null).order('started_at', { ascending: false }).limit(limit))
  return rows.map((s) => ({
    id: `ws-${s.id}`, source: 'rutina', sport: 'fuerza', title: 'Rutina de entrenamiento', started_at: s.started_at,
    duration_sec: s.total_sec || 0, distance_m: 0, calories: Number(s.calories) || 0, steps: 0,
    avg_hr: s.avg_hr, max_hr: s.max_hr, hr_zones: s.hr_zones || null, hr_series: null, route: null, device: 'IronYellow'
  }))
}

/** Historial unificado (más reciente primero). */
export async function listActivities(memberId, limit = 60) {
  const [saved, workouts] = await Promise.all([
    q(supabase.from('activities').select('*').eq('member_id', memberId).order('started_at', { ascending: false }).limit(limit)),
    listWorkouts(memberId, limit).catch(() => [])
  ])
  return [...saved, ...workouts].sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, limit)
}

/** Resumen diario guardado anteriormente (si existe). */
export const listHealthDaily = (memberId, days = 120) => {
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  return q(supabase.from('health_daily').select('*').eq('member_id', memberId).gte('day', from).order('day'))
}
