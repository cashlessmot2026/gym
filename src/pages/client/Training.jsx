import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'
import { Dumbbell, Flag, Clock, Flame, Layers, Trophy, HeartPulse, CalendarDays, Users, CheckCircle2 } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { getMemberAssignments } from '../../lib/data'
import { WEEKDAYS, WEEKDAYS_SHORT, fmtTime, today } from '../../lib/constants'
import { kcalFromMet } from '../../lib/fitness'
import { hrStats } from '../../lib/watch'
import { Loading, Empty, Modal, Stat, StatusBadge, useToast } from '../../components/ui'
import { CHART, tip } from '../../components/Analytics'
import WorkoutPlayer from './WorkoutPlayer'

export default function Training({ member, status, types }) {
  const toast = useToast()
  const [items, setItems] = useState(null)
  const [day, setDay] = useState(new Date().getDay())
  const [playing, setPlaying] = useState(null)
  const [session, setSession] = useState(null)
  const [logs, setLogs] = useState([])
  const [summary, setSummary] = useState(null)
  const [bodyKg, setBodyKg] = useState(70)

  useEffect(() => {
    getMemberAssignments(member.id).then(setItems).catch((e) => { toast(e.message, 'error'); setItems([]) })
    q(supabase.from('workout_sessions').select('*').eq('member_id', member.id).eq('date', today()).is('ended_at', null).order('created_at', { ascending: false }).limit(1))
      .then(async (s) => {
        if (s[0]) {
          setSession(s[0])
          setLogs(await q(supabase.from('workout_logs').select('*').eq('session_id', s[0].id)))
        }
      })
    q(supabase.from('body_metrics').select('weight').eq('member_id', member.id).order('date', { ascending: false }).limit(1)).then((r) => r[0]?.weight && setBodyKg(Number(r[0].weight)))
  }, [member.id])

  const countByDay = useMemo(() => {
    const c = Array(7).fill(0)
    for (const i of items || []) c[i.weekday]++
    return c
  }, [items])

  const grouped = useMemo(() => {
    const g = {}
    for (const i of (items || []).filter((x) => x.weekday === day)) (g[i.exercise?.muscle_group || 'Otro'] ??= []).push(i)
    return g
  }, [items, day])

  const doneIds = new Set(logs.filter((l) => l.completed).map((l) => l.assignment_id))
  const dayItems = Object.values(grouped).flat()
  const progress = dayItems.length ? Math.round((dayItems.filter((i) => doneIds.has(i.id)).length / dayItems.length) * 100) : 0

  const ensureSession = async () => {
    if (session) return session
    const s = (await q(supabase.from('workout_sessions').insert({ member_id: member.id, date: today(), started_at: new Date().toISOString() }).select()))[0]
    setSession(s)
    return s
  }

  const onFinishExercise = async (item, r) => {
    try {
      const s = await ensureSession()
      const row = {
        session_id: s.id, member_id: member.id, assignment_id: item.id, exercise_id: item.exercise_id,
        exercise_name: item.exercise.name, muscle_group: item.exercise.muscle_group, date: today(),
        sets_target: item.sets, reps_target: item.reps, sets_done: r.setTimes.length, reps_done: r.reps,
        weight: r.weight, work_sec: item.work_sec, rest_sec: item.rest_sec, set_times: r.setTimes, completed: r.completed
      }
      const saved = (await q(supabase.from('workout_logs').insert(row).select()))[0]
      setLogs((x) => [...x, saved])
      toast(r.completed ? `✅ ${item.exercise.name} completado` : `Progreso parcial guardado: ${item.exercise.name}`, 'success')
    } catch (e) { toast(e.message, 'error') }
  }

  const finishRoutine = async () => {
    if (!session || !logs.length) return toast('Aún no has completado ningún ejercicio', 'error')
    const started = new Date(session.started_at).getTime()
    const total = Math.round((Date.now() - started) / 1000)
    const active = logs.reduce((s, l) => s + (l.set_times || []).reduce((a, x) => a + x.work, 0), 0)
    const metOf = (name) => types.find((t) => t.name === items.find((i) => i.exercise?.name === name)?.exercise?.training_type)?.met || 5
    const kcal = logs.reduce((s, l) => s + kcalFromMet(metOf(l.exercise_name), bodyKg, (l.set_times || []).reduce((a, x) => a + x.work + x.rest, 0)), 0)
    const hr = hrStats(started)
    const upd = {
      ended_at: new Date().toISOString(), total_sec: total, active_sec: active, exercises_done: logs.filter((l) => l.completed).length,
      sets_done: logs.reduce((s, l) => s + (l.sets_done || 0), 0), volume_kg: logs.reduce((s, l) => s + (l.weight || 0) * (l.reps_done || 0) * (l.sets_done || 0), 0),
      calories: kcal, avg_hr: hr.avg, max_hr: hr.max
    }
    await q(supabase.from('workout_sessions').update(upd).eq('id', session.id))
    setSummary({ ...session, ...upd, logs })
    setSession(null); setLogs([])
  }

  if (!items) return <Loading />
  const isToday = day === new Date().getDay()

  return (
    <div className="col">
      <div className="grid g3">
        <div className={`stat ${status?.status === 'vencida' ? '' : 'y'}`}>
          <CalendarDays className="ic" size={22} />
          <div className="l">Días restantes</div>
          <div className="v">{status?.days_left ?? 0}</div>
          <div className="small"><StatusBadge status={status?.status} days={status?.days_left} /> {status?.plan_name && <b> · {status.plan_name}</b>}</div>
        </div>
        <Stat label="Ejercicios de hoy" value={countByDay[new Date().getDay()]} icon={Dumbbell} sub={WEEKDAYS[new Date().getDay()]} />
        <Stat label="Progreso del día" value={progress + '%'} icon={Trophy} sub={session ? 'Rutina en curso' : 'Sin iniciar'} />
      </div>

      <div className="days">
        {WEEKDAYS_SHORT.map((d, i) => (
          <div key={d} className={`day ${day === i ? 'on' : ''} ${i === new Date().getDay() ? 'today' : ''} ${countByDay[i] ? 'has' : ''}`} onClick={() => setDay(i)}>
            <div className="dn">{d}</div><div className="dc">{countByDay[i]}</div><div className="tiny" style={{ opacity: .7 }}>ejerc.</div>
          </div>
        ))}
      </div>

      <div className="row between wrap">
        <h2 className="display" style={{ fontSize: '2rem', margin: 0 }}>{WEEKDAYS[day].toUpperCase()} <span className="y">· {dayItems.length} ejercicios</span></h2>
        {session && <button className="btn primary" onClick={finishRoutine}><Flag size={16} /> Finalizar rutina y ver estadísticas</button>}
      </div>
      {dayItems.length > 0 && <div className="progress"><div style={{ width: progress + '%' }} /></div>}

      {!dayItems.length && <Empty>Tu coach no ha programado ejercicios para este día.</Empty>}
      {Object.entries(grouped).map(([g, list]) => (
        <div key={g}>
          <div className="group-h y">{g}</div>
          <div className="grid g2">
            {list.map((i) => {
              const done = doneIds.has(i.id)
              return (
                <div key={i.id} className={`ex ${done ? 'done' : ''}`} onClick={() => isToday ? setPlaying(i) : toast('Puedes ver la rutina, pero solo entrenar la del día de hoy', 'info')}>
                  {i.exercise?.image_url ? <img className="ex-img" src={i.exercise.image_url} alt="" style={{ background: '#fff' }} /> : <div className="ex-img"><Dumbbell /></div>}
                  <div className="grow">
                    <div style={{ fontWeight: 700 }}>{i.exercise?.name}</div>
                    <div className="tiny muted">{i.sets} × {i.reps} · {fmtTime(i.work_sec)} trabajo · {fmtTime(i.rest_sec)} desc.{i.weight ? ` · ${i.weight} kg` : ''}</div>
                    {i.group_name && <span className="badge tiny mt" style={{ marginTop: 4 }}><Users size={10} /> {i.group_name}</span>}
                  </div>
                  {done ? <CheckCircle2 className="ok" /> : <span className="badge y">{isToday ? 'Iniciar' : 'Ver'}</span>}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {playing && <WorkoutPlayer item={playing} onFinish={(r) => onFinishExercise(playing, r)} onClose={() => setPlaying(null)} />}
      {summary && <DaySummary s={summary} onClose={() => setSummary(null)} />}
    </div>
  )
}

function DaySummary({ s, onClose }) {
  const perEx = s.logs.map((l) => ({
    name: l.exercise_name.length > 14 ? l.exercise_name.slice(0, 13) + '…' : l.exercise_name,
    trabajo: (l.set_times || []).reduce((a, x) => a + x.work, 0),
    descanso: (l.set_times || []).reduce((a, x) => a + x.rest, 0)
  }))
  const byMuscle = Object.entries(s.logs.reduce((m, l) => ({ ...m, [l.muscle_group]: (m[l.muscle_group] || 0) + (l.sets_done || 0) }), {})).map(([name, value]) => ({ name, value }))
  const density = s.total_sec ? Math.round((s.active_sec / s.total_sec) * 100) : 0
  return (
    <Modal title="🏆 Resumen del día" onClose={onClose} wide>
      <div className="grid g4">
        <Stat label="Duración total" value={fmtTime(s.total_sec)} icon={Clock} y />
        <Stat label="Tiempo activo" value={fmtTime(s.active_sec)} icon={Dumbbell} sub={`densidad ${density}%`} />
        <Stat label="Series" value={s.sets_done} icon={Layers} sub={`${s.exercises_done} ejercicios completos`} />
        <Stat label="Calorías" value={Math.round(s.calories)} icon={Flame} sub={s.volume_kg ? `Volumen ${Math.round(s.volume_kg)} kg` : 'estimadas (MET)'} />
      </div>
      {s.avg_hr && <div className="row mt"><span className="hr-live"><HeartPulse size={16} /> FC media {s.avg_hr} lpm · máx {s.max_hr} lpm</span></div>}
      <div className="grid g2 mt">
        <div className="card"><h3>Tiempo por ejercicio (s)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={perEx}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="name" stroke="#666" fontSize={10} /><YAxis stroke="#666" fontSize={11} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="trabajo" stackId="a" fill="#FFD60A" /><Bar dataKey="descanso" stackId="a" fill="#3b82f6" radius={[6, 6, 0, 0]} /></BarChart>
          </ResponsiveContainer></div>
        <div className="card"><h3>Series por grupo muscular</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart><Pie data={byMuscle} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85}>{byMuscle.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}</Pie><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
          </ResponsiveContainer></div>
      </div>
      <div className="table-wrap mt"><table className="t">
        <thead><tr><th>Ejercicio</th><th>Series</th><th>Reps</th><th>Kg</th><th>Trabajo</th><th>Descanso</th><th>Estado</th></tr></thead>
        <tbody>{s.logs.map((l) => {
          const w = (l.set_times || []).reduce((a, x) => a + x.work, 0), r = (l.set_times || []).reduce((a, x) => a + x.rest, 0)
          return <tr key={l.id}><td>{l.exercise_name}</td><td>{l.sets_done}/{l.sets_target}</td><td>{l.reps_done}</td><td>{l.weight || '—'}</td><td>{fmtTime(w)}</td><td>{fmtTime(r)}</td>
            <td>{l.completed ? <span className="badge ok">Completo</span> : <span className="badge warn">Parcial</span>}</td></tr>
        })}</tbody>
      </table></div>
    </Modal>
  )
}
