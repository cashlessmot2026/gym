import { useEffect, useMemo, useState } from 'react'
import { Dumbbell, Flag, Clock, CheckCircle2, ArrowLeft, Play, History, ListChecks, ClipboardList, Flame, Layers } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { WEEKDAYS, WEEKDAYS_SHORT, fmtTime, fmtDate, today } from '../../lib/constants'
import { getPublishedRoutines, getRoutineProgress, routineSeconds, onWeekday } from '../../lib/routines'
import { Loading, Empty, Stat, useToast } from '../../components/ui'
import WorkoutPlayer from './WorkoutPlayer'
import Training, { closeSession, DaySummary } from './Training'

/** Pestaña "Entrenar": rutinas del gym (de todos) y el plan personal del cliente. */
export default function TrainingHub({ member, status, types }) {
  const [mode, setMode] = useState('gym')
  return (
    <div className="col">
      <div className="row wrap" style={{ gap: 6 }}>
        <button className={`chip ${mode === 'gym' ? 'on' : ''}`} onClick={() => setMode('gym')}><ListChecks size={14} /> Rutinas del gym</button>
        <button className={`chip ${mode === 'plan' ? 'on' : ''}`} onClick={() => setMode('plan')}><ClipboardList size={14} /> Mi plan</button>
      </div>
      {mode === 'gym' ? <GymRoutines member={member} types={types} /> : <Training member={member} status={status} types={types} />}
    </div>
  )
}

function GymRoutines({ member, types }) {
  const toast = useToast()
  const [routines, setRoutines] = useState(null)
  const [prog, setProg] = useState({ sessions: [], lastWeight: {}, byRoutine: {} })
  const [day, setDay] = useState(new Date().getDay())
  const [open, setOpen] = useState(null)
  const [summary, setSummary] = useState(null)

  const loadProgress = () => getRoutineProgress(member.id).then(setProg).catch(() => {})
  useEffect(() => {
    getPublishedRoutines().then(setRoutines).catch((e) => { toast(e.message, 'error'); setRoutines([]) })
    loadProgress()
  }, [member.id])

  const countByDay = useMemo(() => WEEKDAYS.map((_, i) => (routines || []).filter((r) => onWeekday(r, i)).length), [routines])
  const openToday = new Set(prog.sessions.filter((s) => !s.ended_at && s.date === today()).map((s) => s.routine_id))

  if (!routines) return <Loading />
  if (open) {
    return <RoutineRun routine={open} member={member} types={types} lastWeight={prog.lastWeight}
      onBack={() => { setOpen(null); loadProgress() }}
      onFinished={(s) => { setOpen(null); setSummary(s); loadProgress() }} />
  }

  const list = routines.filter((r) => onWeekday(r, day))
  const done = prog.sessions.filter((s) => s.ended_at)
  return (
    <>
      <div className="days">
        {WEEKDAYS_SHORT.map((d, i) => (
          <div key={d} className={`day ${day === i ? 'on' : ''} ${i === new Date().getDay() ? 'today' : ''} ${countByDay[i] ? 'has' : ''}`} onClick={() => setDay(i)}>
            <div className="dn">{d}</div><div className="dc">{countByDay[i]}</div><div className="tiny" style={{ opacity: .7 }}>rutinas</div>
          </div>
        ))}
      </div>
      <h2 className="display" style={{ fontSize: '2rem', margin: 0 }}>{WEEKDAYS[day].toUpperCase()} <span className="y">· {list.length} rutina{list.length === 1 ? '' : 's'}</span></h2>

      {!list.length && <Empty>No hay rutinas publicadas para este día.</Empty>}
      <div className="grid g2">
        {list.map((r) => {
          const p = prog.byRoutine[r.id]
          return (
            <div key={r.id} className="card">
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{r.name}</div>
                {openToday.has(r.id) ? <span className="badge warn">En curso</span> : p ? <span className="badge ok">Hecha {p.times}×</span> : null}
              </div>
              {r.description && <div className="small muted" style={{ marginTop: 4 }}>{r.description}</div>}
              <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                <span className="badge y"><Dumbbell size={11} /> {r.items.length} ejercicios</span>
                <span className="badge"><Clock size={11} /> ~{fmtTime(routineSeconds(r.items))}</span>
                {r.training_type && <span className="badge">{r.training_type}</span>}
                {r.level && <span className="badge" style={{ textTransform: 'capitalize' }}>{r.level}</span>}
              </div>
              <ul className="small" style={{ paddingLeft: 18, margin: '10px 0' }}>
                {r.items.slice(0, 6).map((it) => <li key={it.index}>{it.exercise.name} <span className="muted">{it.sets}×{it.reps}{it.weight ? ` · ${it.weight} kg` : ''}</span></li>)}
                {r.items.length > 6 && <li className="muted">+{r.items.length - 6} más</li>}
              </ul>
              <div className="row between wrap" style={{ gap: 6 }}>
                <span className="tiny muted">{r.coach?.full_name ? `Por ${r.coach.full_name}` : ''}{p?.last ? ` · última vez ${fmtDate(p.last)}` : ''}</span>
                <button className="btn primary" onClick={() => setOpen(r)}><Play size={16} /> {openToday.has(r.id) ? 'Continuar' : 'Empezar'}</button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h3><History size={16} className="y" /> Mi historial de rutinas</h3>
        {done.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Fecha</th><th>Rutina</th><th>Duración</th><th>Ejercicios</th><th>Series</th><th>Volumen</th><th>kcal</th></tr></thead>
            <tbody>{done.slice(0, 20).map((s) => (
              <tr key={s.id}><td>{fmtDate(s.date)}</td><td><b>{s.routine_name || 'Rutina'}</b></td><td>{fmtTime(s.total_sec)}</td><td>{s.exercises_done}</td><td>{s.sets_done}</td>
                <td>{s.volume_kg ? `${Math.round(s.volume_kg)} kg` : '—'}</td><td>{Math.round(s.calories || 0)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>Cuando termines tu primera rutina aparecerá aquí.</Empty>}
      </div>
      {summary && <DaySummary s={summary} onClose={() => setSummary(null)} />}
    </>
  )
}

/** Una rutina en curso: cada ejercicio abre el contador y se guarda al terminarlo. */
function RoutineRun({ routine, member, types, lastWeight, onBack, onFinished }) {
  const toast = useToast()
  const [session, setSession] = useState(null)
  const [logs, setLogs] = useState(null)
  const [playing, setPlaying] = useState(null)
  const [bodyKg, setBodyKg] = useState(70)
  const [finishing, setFinishing] = useState(false)

  // Retoma la sesión abierta de hoy para esta rutina, si existe
  useEffect(() => {
    (async () => {
      const s = (await q(supabase.from('workout_sessions').select('*').eq('member_id', member.id).eq('routine_id', routine.id).eq('date', today()).is('ended_at', null).order('created_at', { ascending: false }).limit(1)))[0]
      if (s) { setSession(s); setLogs(await q(supabase.from('workout_logs').select('*').eq('session_id', s.id))) } else setLogs([])
    })().catch((e) => { toast(e.message, 'error'); setLogs([]) })
    q(supabase.from('body_metrics').select('weight').eq('member_id', member.id).order('date', { ascending: false }).limit(1)).then((r) => r[0]?.weight && setBodyKg(Number(r[0].weight))).catch(() => {})
  }, [routine.id])

  const items = routine.items.map((it) => ({
    ...it, id: `${routine.id}:${it.index}`,
    weight: lastWeight[it.exercise_id] ?? it.weight, suggested: it.weight
  }))

  if (!logs) return <Loading />
  const doneIdx = new Set(logs.filter((l) => l.completed).map((l) => l.item_index))
  const progress = items.length ? Math.round((items.filter((i) => doneIdx.has(i.index)).length / items.length) * 100) : 0
  const next = items.find((i) => !doneIdx.has(i.index))

  const ensureSession = async () => {
    if (session) return session
    const s = (await q(supabase.from('workout_sessions').insert({ member_id: member.id, date: today(), started_at: new Date().toISOString(), routine_id: routine.id, routine_name: routine.name }).select()))[0]
    setSession(s)
    return s
  }

  const onFinishExercise = async (item, r) => {
    try {
      const s = await ensureSession()
      const row = {
        session_id: s.id, member_id: member.id, routine_id: routine.id, item_index: item.index, exercise_id: item.exercise_id,
        exercise_name: item.exercise.name, muscle_group: item.exercise.muscle_group, date: today(),
        sets_target: item.sets, reps_target: item.reps, sets_done: r.setTimes.length, reps_done: r.reps,
        weight: r.weight, work_sec: item.work_sec, rest_sec: item.rest_sec, set_times: r.setTimes, completed: r.completed
      }
      const saved = (await q(supabase.from('workout_logs').insert(row).select()))[0]
      setLogs((x) => [...x, saved])
      toast(r.completed ? `✅ ${item.exercise.name} completado` : `Progreso parcial guardado: ${item.exercise.name}`, 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const finish = async () => {
    if (!session || !logs.length) return toast('Aún no has completado ningún ejercicio', 'error')
    if (doneIdx.size < items.length && !window.confirm(`Te faltan ${items.length - doneIdx.size} ejercicios. ¿Finalizar la rutina igual?`)) return
    setFinishing(true)
    const met = types.find((t) => t.name === routine.training_type)?.met || 5
    try { onFinished(await closeSession({ session, logs, member, bodyKg, metOf: () => met })) }
    catch (e) { toast(e.message, 'error'); setFinishing(false) }
  }

  const sets = logs.reduce((s, l) => s + (l.sets_done || 0), 0)
  const volume = logs.reduce((s, l) => s + (l.weight || 0) * (l.reps_done || 0) * (l.sets_done || 0), 0)

  return (
    <div className="col">
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn" onClick={onBack}><ArrowLeft size={16} /></button>
        <div className="grow">
          <h2 className="display" style={{ fontSize: '2rem', margin: 0 }}>{routine.name.toUpperCase()}</h2>
          {routine.description && <div className="small muted">{routine.description}</div>}
        </div>
      </div>
      <div className="grid g3">
        <Stat label="Progreso" value={progress + '%'} icon={CheckCircle2} y sub={`${doneIdx.size} de ${items.length} ejercicios`} />
        <Stat label="Series hechas" value={sets} icon={Layers} sub={`de ${items.reduce((s, i) => s + i.sets, 0)}`} />
        <Stat label="Volumen" value={`${Math.round(volume)} kg`} icon={Flame} sub={session ? 'Rutina en curso' : 'Sin iniciar'} />
      </div>
      <div className="progress"><div style={{ width: progress + '%' }} /></div>

      <div className="col" style={{ gap: 8 }}>
        {items.map((i) => {
          const done = doneIdx.has(i.index)
          const partial = !done && logs.some((l) => l.item_index === i.index)
          return (
            <div key={i.id} className={`ex ${done ? 'done' : ''}`} onClick={() => setPlaying(i)}>
              {i.exercise.image_url ? <img className="ex-img" src={i.exercise.image_url} alt="" style={{ background: '#fff' }} /> : <div className="ex-img"><Dumbbell /></div>}
              <div className="grow">
                <div style={{ fontWeight: 700 }}>{i.index + 1}. {i.exercise.name}</div>
                <div className="tiny muted">{i.sets} × {i.reps} · {fmtTime(i.work_sec)} trabajo · {fmtTime(i.rest_sec)} desc.{i.suggested ? ` · ${i.suggested} kg sugerido` : ''}</div>
                {lastWeight[i.exercise_id] != null && <div className="tiny y">Tu último peso: {lastWeight[i.exercise_id]} kg</div>}
                {i.notes && <div className="tiny muted">📝 {i.notes}</div>}
              </div>
              {done ? <CheckCircle2 className="ok" /> : <span className="badge y">{partial ? 'Seguir' : next?.index === i.index ? 'Siguiente' : 'Iniciar'}</span>}
            </div>
          )
        })}
      </div>

      <button className="btn primary lg block" onClick={finish} disabled={finishing || !logs.length}><Flag size={18} /> Finalizar rutina y ver estadísticas</button>
      {playing && <WorkoutPlayer item={playing} member={member} onFinish={(r) => onFinishExercise(playing, r)} onClose={() => setPlaying(null)} />}
    </div>
  )
}
