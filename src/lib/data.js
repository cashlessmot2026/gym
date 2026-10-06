import { supabase, q } from './supabase'
import { addDays, today } from './constants'

export const getTrainingTypes = () => q(supabase.from('training_types').select('*').order('created_at'))
export const getPlans = () => q(supabase.from('plans').select('*').order('days'))
export const getExercises = () => q(supabase.from('exercises').select('*').order('muscle_group').order('name'))
export const getStatus = async (memberId) =>
  (await q(supabase.from('member_status').select('*').eq('member_id', memberId)))[0]

/** Asignaciones propias + las de los grupos a los que pertenece el cliente. */
export async function getMemberAssignments(memberId) {
  const groups = await q(supabase.from('group_members').select('group_id, client_groups(name)').eq('member_id', memberId))
  const ids = groups.map((g) => g.group_id)
  const names = Object.fromEntries(groups.map((g) => [g.group_id, g.client_groups?.name]))
  let query = supabase.from('assignments').select('*, exercise:exercises(*)')
  query = ids.length ? query.or(`member_id.eq.${memberId},group_id.in.(${ids.join(',')})`) : query.eq('member_id', memberId)
  const rows = await q(query.order('sort'))
  return rows.map((r) => ({ ...r, group_name: r.group_id ? names[r.group_id] : null }))
}

/** Expande una rutina en filas de asignación para un cliente o un grupo. */
export async function assignRoutine({ routine, memberId, groupId, weekdays, staffId }) {
  const rows = []
  for (const wd of weekdays) {
    routine.items.forEach((it, i) => rows.push({
      member_id: memberId || null, group_id: groupId || null, routine_id: routine.id, exercise_id: it.exercise_id,
      weekday: wd, sets: it.sets, reps: it.reps, work_sec: it.work_sec, rest_sec: it.rest_sec, weight: it.weight || null,
      sort: i, created_by: staffId
    }))
  }
  return q(supabase.from('assignments').insert(rows))
}

export async function memberHistory(memberId, days = 90) {
  const from = addDays(today(), -days)
  const [sessions, logs, metrics, attendance] = await Promise.all([
    q(supabase.from('workout_sessions').select('*').eq('member_id', memberId).gte('date', from).order('date')),
    q(supabase.from('workout_logs').select('*').eq('member_id', memberId).gte('date', from).order('date')),
    q(supabase.from('body_metrics').select('*').eq('member_id', memberId).order('date')),
    q(supabase.from('attendance').select('*').eq('member_id', memberId).gte('created_at', from).order('created_at'))
  ])
  return { sessions, logs, metrics, attendance }
}
