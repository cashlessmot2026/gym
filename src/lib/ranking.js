// Ranking histórico por objetivo: cada cliente compite con quienes eligieron
// su mismo objetivo. El puntaje premia la MEJORA respecto a su punto de partida
// (no los totales absolutos) más la constancia.
import { supabase, q } from './supabase'
import { GOALS } from './constants'

const pct = (a, b) => (a && b ? ((b - a) / a) * 100 : 0)
const pos = (x) => Math.max(0, x || 0)
const r1 = (x) => Math.round(x * 10) / 10

/** Primera y última medida con valor de un campo. */
function firstLast(metrics, field) {
  const v = metrics.filter((m) => m[field] != null && Number(m[field]) > 0)
  return v.length >= 2 ? [Number(v[0][field]), Number(v[v.length - 1][field])] : [null, null]
}

/** Mejora media (%) del peso máximo por ejercicio: primer registro vs mejor marca. */
function strengthGain(logs) {
  const by = {}
  for (const l of logs) if (l.weight > 0 && l.exercise_name) (by[l.exercise_name] ??= []).push(Number(l.weight))
  const gains = Object.values(by).filter((w) => w.length >= 2).map((w) => pos(pct(w[0], Math.max(...w))))
  return gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0
}

/** Mejora (%) del volumen por sesión: 4 primeras vs 4 últimas. */
function volumeGain(sessions) {
  const v = sessions.filter((s) => s.volume_kg > 0).map((s) => Number(s.volume_kg))
  if (v.length < 6) return 0
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
  return pos(pct(avg(v.slice(0, 4)), avg(v.slice(-4))))
}

/** Calcula el puntaje de un cliente con todo su historial. */
export function computeScore(member, { sessions, activities, metrics, logs, attendance }) {
  const done = sessions.filter((s) => s.ended_at)
  const kcal = done.reduce((a, s) => a + Number(s.hr_kcal || s.calories || 0), 0) + activities.reduce((a, x) => a + Number(x.calories || 0), 0)
  const km = activities.reduce((a, x) => a + Number(x.distance_m || 0), 0) / 1000
  const minutes = done.reduce((a, s) => a + (s.total_sec || 0), 0) / 60 + activities.reduce((a, x) => a + (x.duration_sec || 0), 0) / 60
  const zoneMin = [...done, ...activities].reduce((a, x) => a + (x.hr_zones ? (x.hr_zones.z3 || 0) + (x.hr_zones.z4 || 0) + (x.hr_zones.z5 || 0) : 0), 0)
  const [w0, w1] = firstLast(metrics, 'weight')
  const [f0, f1] = firstLast(metrics, 'body_fat')
  const [l0, l1] = firstLast(metrics, 'lean_mass')
  const [a0, a1] = firstLast(metrics, 'arm')
  const [c0, c1] = firstLast(metrics, 'chest')

  const detail = []
  const add = (label, value, pts) => { if (pts > 0) detail.push({ label, value, pts: Math.round(pts) }) }

  // Constancia (todos los objetivos)
  const workouts = done.length + activities.length
  add('Entrenamientos', workouts, workouts * 3)
  add('Asistencias', attendance, attendance)

  switch (member.goal) {
    case 'perder_grasa': {
      const lost = pos(-pct(w0, w1))
      add('Peso perdido', `${r1(lost)} %`, lost * 20)
      add('Grasa corporal bajada', `${r1(pos(f0 - f1))} pts`, pos(f0 - f1) * 15)
      add('Calorías quemadas', Math.round(kcal), kcal / 200)
      break
    }
    case 'hipertrofia': {
      add('Brazo ganado', `${r1(pos(a1 - a0))} cm`, pos(a1 - a0) * 20)
      add('Pecho ganado', `${r1(pos(c1 - c0))} cm`, pos(c1 - c0) * 10)
      add('Masa magra ganada', `${r1(pos(l1 - l0))} kg`, pos(l1 - l0) * 20)
      const vg = volumeGain(done)
      add('Volumen por sesión', `+${Math.round(vg)} %`, Math.min(vg, 300))
      break
    }
    case 'fuerza': {
      const g = strengthGain(logs)
      add('Mejora de cargas máximas', `+${Math.round(g)} %`, g * 2)
      break
    }
    case 'resistencia': {
      add('Distancia', `${r1(km)} km`, km * 2)
      add('Minutos en zona 3-5', Math.round(zoneMin), zoneMin / 5)
      break
    }
    case 'recomposicion': {
      add('Masa magra ganada', `${r1(pos(l1 - l0))} kg`, pos(l1 - l0) * 20)
      add('Grasa corporal bajada', `${r1(pos(f0 - f1))} pts`, pos(f0 - f1) * 15)
      break
    }
    default: // salud, competición y sin objetivo: minutos activos
      add('Minutos activos', Math.round(minutes), minutes / 10)
  }
  return { score: detail.reduce((a, d) => a + d.pts, 0), detail }
}

/** Recalcula y guarda el puntaje de un cliente (se llama tras cada sincronización). */
export async function refreshScore(member) {
  const id = member.id
  const [sessions, activities, metrics, logs, att] = await Promise.all([
    q(supabase.from('workout_sessions').select('ended_at, total_sec, calories, hr_kcal, volume_kg, hr_zones, date').eq('member_id', id).order('date')),
    q(supabase.from('activities').select('calories, distance_m, duration_sec, hr_zones').eq('member_id', id)),
    q(supabase.from('body_metrics').select('date, weight, body_fat, lean_mass, arm, chest').eq('member_id', id).order('date')),
    q(supabase.from('workout_logs').select('exercise_name, weight, date').eq('member_id', id).order('date')),
    supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('member_id', id).eq('allowed', true)
  ])
  const r = computeScore(member, { sessions, activities, metrics, logs, attendance: att.count || 0 })
  await q(supabase.from('member_scores').upsert({ member_id: id, goal: member.goal || 'salud', score: r.score, detail: r.detail, updated_at: new Date().toISOString() }))
  return r
}

/**
 * Ranking de un objetivo. Los clientes sin puntaje o con puntaje de hace más de
 * un día se recalculan aquí (máximo 25 por carga para no saturar).
 */
export async function getRanking(goal) {
  const members = await q(supabase.from('members').select('id, full_name, photo, goal, level, active').eq('active', true))
  const scores = await q(supabase.from('member_scores').select('*'))
  const byId = Object.fromEntries(scores.map((s) => [s.member_id, s]))
  const stale = members.filter((m) => !byId[m.id] || byId[m.id].goal !== (m.goal || 'salud') || Date.now() - new Date(byId[m.id].updated_at) > 86400000).slice(0, 25)
  for (const m of stale) {
    try { const r = await refreshScore(m); byId[m.id] = { member_id: m.id, goal: m.goal || 'salud', ...r } } catch { /* sigue con el resto */ }
  }
  return members
    .filter((m) => (m.goal || 'salud') === goal)
    .map((m) => ({ ...m, score: Math.round(byId[m.id]?.score || 0), detail: byId[m.id]?.detail || [] }))
    .sort((a, b) => b.score - a.score)
}

/** Puesto de un cliente dentro de su objetivo (para el perfil). */
export async function myRank(member) {
  const goal = member.goal || 'salud'
  const rows = await q(supabase.from('member_scores').select('member_id, score').eq('goal', goal).order('score', { ascending: false }))
  const i = rows.findIndex((r) => r.member_id === member.id)
  return i < 0 ? null : { pos: i + 1, of: rows.length, goal: GOALS.find((g) => g.id === goal) }
}
