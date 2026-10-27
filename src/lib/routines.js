// Rutinas del gym: las publica el admin o el coach y cualquier cliente las puede hacer.
import { supabase, q } from './supabase'

export const LEVELS = [
  { id: '', label: 'Todos los niveles' },
  { id: 'principiante', label: 'Principiante' },
  { id: 'intermedio', label: 'Intermedio' },
  { id: 'avanzado', label: 'Avanzado' }
]

/** Duración estimada (seg) de una lista de ítems. */
export const routineSeconds = (items = []) =>
  items.reduce((s, it) => s + (Number(it.sets) || 0) * ((Number(it.work_sec) || 0) + (Number(it.rest_sec) || 0)), 0)

/** ¿La rutina está publicada para ese día de la semana? (sin días = cualquier día) */
export const onWeekday = (r, wd) => !r.weekdays?.length || r.weekdays.includes(wd)

/** Rutinas publicadas con sus ejercicios resueltos. */
export async function getPublishedRoutines() {
  const [routines, exercises] = await Promise.all([
    q(supabase.from('routines').select('*, coach:staff(full_name)').eq('published', true).order('updated_at', { ascending: false })),
    q(supabase.from('exercises').select('*'))
  ])
  const byId = Object.fromEntries(exercises.map((e) => [e.id, e]))
  return routines.map((r) => ({
    ...r,
    items: (r.items || []).map((it, i) => ({ ...it, index: i, exercise: byId[it.exercise_id] })).filter((it) => it.exercise)
  }))
}

/** Historial del cliente: sesiones de rutinas y último peso usado por ejercicio. */
export async function getRoutineProgress(memberId) {
  const [sessions, logs] = await Promise.all([
    q(supabase.from('workout_sessions').select('*').eq('member_id', memberId).not('routine_id', 'is', null).order('created_at', { ascending: false }).limit(200)),
    q(supabase.from('workout_logs').select('exercise_id, weight, reps_done, date').eq('member_id', memberId).not('weight', 'is', null).order('date', { ascending: false }).limit(500))
  ])
  const lastWeight = {}
  for (const l of logs) if (l.exercise_id && !(l.exercise_id in lastWeight)) lastWeight[l.exercise_id] = Number(l.weight)
  const byRoutine = {}
  for (const s of sessions.filter((x) => x.ended_at)) {
    const b = (byRoutine[s.routine_id] ??= { times: 0, last: null })
    b.times++; if (!b.last) b.last = s.date
  }
  return { sessions, lastWeight, byRoutine }
}

export async function saveRoutine(f, staffId) {
  const row = {
    name: f.name.trim(), description: f.description?.trim() || null, training_type: f.training_type || null,
    level: f.level || null, weekdays: [...(f.weekdays || [])].sort(), published: f.published !== false,
    items: f.items.map(({ exercise_id, sets, reps, work_sec, rest_sec, weight, notes }) => ({
      exercise_id, sets: Number(sets) || 1, reps: Number(reps) || 0, work_sec: Number(work_sec) || 0, rest_sec: Number(rest_sec) || 0,
      weight: weight === '' || weight == null ? null : Number(weight), notes: notes?.trim() || null
    })),
    updated_at: new Date().toISOString()
  }
  if (!row.name) throw new Error('Ponle un nombre a la rutina')
  if (!row.items.length) throw new Error('Agrega al menos un ejercicio')
  return f.id
    ? q(supabase.from('routines').update(row).eq('id', f.id))
    : q(supabase.from('routines').insert({ ...row, coach_id: staffId }))
}
