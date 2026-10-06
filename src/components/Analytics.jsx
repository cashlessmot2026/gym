import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts'
import { Activity, Clock, Flame, Dumbbell, CalendarCheck, TrendingUp } from 'lucide-react'
import { memberHistory } from '../lib/data'
import { fmtTime, fmtDate } from '../lib/constants'
import { Stat, Loading, Empty } from './ui'

export const CHART = ['#FFD60A', '#f5f5f5', '#a3a3a3', '#facc15', '#737373', '#fde68a', '#525252', '#ca8a04', '#d4d4d4', '#854d0e']
export const tip = { contentStyle: { background: '#111', border: '1px solid #333', borderRadius: 10 }, labelStyle: { color: '#FFD60A' } }
const axis = { stroke: '#666', fontSize: 11 }

export function MemberAnalytics({ memberId, days = 60 }) {
  const [d, setD] = useState(null)
  useEffect(() => { memberHistory(memberId, days).then(setD) }, [memberId, days])

  const k = useMemo(() => {
    if (!d) return null
    const totalSec = d.sessions.reduce((s, x) => s + (x.total_sec || 0), 0)
    const kcal = d.sessions.reduce((s, x) => s + Number(x.calories || 0), 0)
    const vol = d.logs.reduce((s, x) => s + (x.weight || 0) * (x.reps_done || 0) * (x.sets_done || 0), 0)
    const byWeek = {}
    for (const s of d.sessions) {
      const dt = new Date(s.date + 'T12:00:00'); dt.setDate(dt.getDate() - dt.getDay())
      const key = dt.toISOString().slice(5, 10)
      byWeek[key] ??= { semana: key, sesiones: 0, minutos: 0 }
      byWeek[key].sesiones++; byWeek[key].minutos += Math.round((s.total_sec || 0) / 60)
    }
    const byMuscle = {}
    for (const l of d.logs) byMuscle[l.muscle_group || 'Otro'] = (byMuscle[l.muscle_group || 'Otro'] || 0) + (l.sets_done || 0)
    const compliance = d.logs.length ? Math.round((d.logs.filter((l) => l.completed).length / d.logs.length) * 100) : 0
    const exProgress = {}
    for (const l of d.logs) if (l.weight) (exProgress[l.exercise_name] ??= []).push({ fecha: l.date.slice(5), kg: Number(l.weight) })
    const topEx = Object.entries(exProgress).sort((a, b) => b[1].length - a[1].length).slice(0, 1)[0]
    return {
      totalSec, kcal, vol, compliance,
      weeks: Object.values(byWeek),
      muscles: Object.entries(byMuscle).map(([name, value]) => ({ name, value })),
      body: d.metrics.map((m) => ({ fecha: m.date.slice(5), peso: m.weight && Number(m.weight), grasa: m.body_fat && Number(m.body_fat), imc: m.bmi && Number(m.bmi) })),
      topEx
    }
  }, [d])

  if (!d) return <Loading />
  return (
    <div className="col">
      <div className="grid g4">
        <Stat label="Sesiones" value={d.sessions.length} icon={Activity} y sub={`últimos ${days} días`} />
        <Stat label="Tiempo total" value={fmtTime(k.totalSec)} icon={Clock} />
        <Stat label="Calorías" value={Math.round(k.kcal)} icon={Flame} sub="estimadas (MET)" />
        <Stat label="Asistencias" value={d.attendance.length} icon={CalendarCheck} sub={`cumplimiento ${k.compliance}%`} />
      </div>
      <div className="grid g2">
        <div className="card">
          <h3>Actividad semanal</h3>
          {k.weeks.length ? (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={k.weeks}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="semana" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
                <Bar dataKey="minutos" fill="#FFD60A" radius={[6, 6, 0, 0]} /><Bar dataKey="sesiones" fill="#555" radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          ) : <Empty>Sin sesiones registradas</Empty>}
        </div>
        <div className="card">
          <h3>Series por grupo muscular</h3>
          {k.muscles.length ? (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart><Pie data={k.muscles} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                {k.muscles.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}</Pie><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
            </ResponsiveContainer>
          ) : <Empty>Sin ejercicios registrados</Empty>}
        </div>
        <div className="card">
          <h3>Composición corporal</h3>
          {k.body.length ? (
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={k.body}><CartesianGrid stroke="#222" /><XAxis dataKey="fecha" {...axis} /><YAxis {...axis} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="peso" stroke="#FFD60A" strokeWidth={3} dot /><Line dataKey="grasa" stroke="#f5f5f5" strokeWidth={2} /><Line dataKey="imc" stroke="#777" strokeWidth={2} /></LineChart>
            </ResponsiveContainer>
          ) : <Empty>Sin medidas registradas</Empty>}
        </div>
        <div className="card">
          <h3><TrendingUp size={16} className="y" /> Progreso de carga {k.topEx ? `· ${k.topEx[0]}` : ''}</h3>
          {k.topEx ? (
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={k.topEx[1]}><CartesianGrid stroke="#222" /><XAxis dataKey="fecha" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
                <Line dataKey="kg" stroke="#FFD60A" strokeWidth={3} /></LineChart>
            </ResponsiveContainer>
          ) : <Empty>Registra pesos en tus ejercicios para ver el progreso</Empty>}
        </div>
      </div>
      <div className="card">
        <h3><Dumbbell size={16} className="y" /> Últimos entrenamientos</h3>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Fecha</th><th>Ejercicio</th><th>Grupo</th><th>Series</th><th>Reps</th><th>Peso</th><th>Tiempo</th><th>Estado</th></tr></thead>
          <tbody>{d.logs.slice(-15).reverse().map((l) => (
            <tr key={l.id}><td>{fmtDate(l.date)}</td><td>{l.exercise_name}</td><td>{l.muscle_group}</td><td>{l.sets_done}/{l.sets_target}</td><td>{l.reps_done}</td>
              <td>{l.weight ? l.weight + ' kg' : '—'}</td><td>{fmtTime((l.set_times || []).reduce((s, x) => s + (x.work || 0) + (x.rest || 0), 0))}</td>
              <td>{l.completed ? <span className="badge ok">Completo</span> : <span className="badge warn">Parcial</span>}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  )
}
