import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts'
import { Footprints, Flame, Route, Timer, HeartPulse, Moon, Trophy, TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react'
import { listActivities, listHealthDaily } from '../lib/activities'
import { fmtTime } from '../lib/constants'
import { SPORT_ICON } from '../lib/sports'
import { Loading, Empty, Stat, useToast } from './ui'
import { CHART, tip } from './Analytics'
import { ZoneBar } from './Activities'

const DAY = 86400000
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const short = (day) => { const [, m, d] = day.split('-'); return `${d}/${m}` }
const sum = (a, f) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0)
const avg = (a, f) => { const v = a.map(f).filter((x) => x > 0); return v.length ? v.reduce((t, x) => t + x, 0) / v.length : 0 }
const fmtK = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString('es'))

function Delta({ now, prev, unit = '' }) {
  if (!prev) return <span className="tiny muted">sin datos previos</span>
  const p = Math.round(((now - prev) / prev) * 100)
  const Icon = p > 0 ? TrendingUp : p < 0 ? TrendingDown : Minus
  return <span className="tiny" style={{ color: p > 0 ? 'var(--ok)' : p < 0 ? 'var(--bad)' : 'var(--mut)' }}><Icon size={12} /> {p > 0 ? '+' : ''}{p}% vs. periodo anterior{unit}</span>
}

/**
 * Analítica de salud: suma todo el historial guardado (actividades + resumen diario de Health Connect),
 * lo calcula por periodo y muestra tendencias, récords y comparación con el periodo anterior.
 */
export default function HealthAnalytics({ member }) {
  const toast = useToast()
  const [acts, setActs] = useState(null)
  const [daily, setDaily] = useState(null)
  const [days, setDays] = useState(30)

  useEffect(() => {
    listActivities(member.id, 1000).then(setActs).catch((e) => { toast(e.message, 'error'); setActs([]) })
    listHealthDaily(member.id, 400).then(setDaily).catch(() => setDaily([]))
  }, [member.id])

  const data = useMemo(() => {
    if (!acts || !daily) return null
    const now = Date.now()
    const inRange = (t, from, to) => t >= from && t < to
    const cur = [now - days * DAY, now + DAY], prev = [now - 2 * days * DAY, now - days * DAY]
    const A = (r) => acts.filter((a) => inRange(new Date(a.started_at).getTime(), r[0], r[1]))
    const D = (r) => daily.filter((d) => inRange(new Date(d.day + 'T12:00:00').getTime(), r[0], r[1]))
    const aC = A(cur), aP = A(prev), dC = D(cur), dP = D(prev)

    // Serie diaria del periodo: pasos, calorías (resumen del día o, si falta, suma de actividades), pulso y sueño
    const byDay = new Map(dC.map((d) => [d.day, d]))
    const series = []
    for (let i = days - 1; i >= 0; i--) {
      const day = iso(new Date(now - i * DAY))
      const d = byDay.get(day) || {}
      const dayActs = aC.filter((a) => iso(new Date(a.started_at)) === day)
      series.push({
        day, label: short(day), steps: d.steps || 0, kcal: Math.round(d.calories || sum(dayActs, (a) => a.calories)),
        avg_hr: d.avg_hr || null, resting_hr: d.resting_hr || null, sleep_h: d.sleep_min ? +(d.sleep_min / 60).toFixed(1) : null
      })
    }

    // Semanas (lunes) de las actividades del periodo
    const weeks = new Map()
    aC.forEach((a) => {
      const dt = new Date(a.started_at); const k = iso(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - ((dt.getDay() + 6) % 7)))
      const w = weeks.get(k) || { week: short(k), km: 0, min: 0, n: 0 }
      w.km += Number(a.distance_m || 0) / 1000; w.min += (a.duration_sec || 0) / 60; w.n++; weeks.set(k, w)
    })
    const weekly = [...weeks.entries()].sort().map(([, w]) => ({ ...w, km: +w.km.toFixed(1), min: Math.round(w.min) }))

    // Deportes por tiempo
    const sports = {}
    aC.forEach((a) => { sports[a.sport || 'otro'] = (sports[a.sport || 'otro'] || 0) + (a.duration_sec || 0) / 60 })
    const sportData = Object.entries(sports).map(([name, value]) => ({ name: `${SPORT_ICON[name] || '⌚'} ${name}`, value: Math.round(value) })).sort((a, b) => b.value - a.value)

    // Zonas de pulso acumuladas
    const zones = {}
    aC.forEach((a) => Object.entries(a.hr_zones || {}).forEach(([z, m]) => { zones[z] = (zones[z] || 0) + Number(m || 0) }))

    const total = {
      n: acts.length, km: sum(acts, (a) => a.distance_m) / 1000, kcal: sum(acts, (a) => a.calories), sec: sum(acts, (a) => a.duration_sec),
      steps: sum(daily, (d) => d.steps), days: daily.length, first: [...acts.map((a) => a.started_at.slice(0, 10)), ...daily.map((d) => d.day)].sort()[0]
    }
    const period = {
      n: aC.length, km: sum(aC, (a) => a.distance_m) / 1000, min: sum(aC, (a) => a.duration_sec) / 60, kcal: sum(series, (s) => s.kcal),
      steps: sum(dC, (d) => d.steps), stepsAvg: avg(dC, (d) => d.steps), restHr: avg(dC, (d) => d.resting_hr), avgHr: avg(dC, (d) => d.avg_hr),
      sleepAvg: avg(dC, (d) => d.sleep_min) / 60
    }
    const before = { min: sum(aP, (a) => a.duration_sec) / 60, kcal: sum(dP, (d) => d.calories) || sum(aP, (a) => a.calories), steps: sum(dP, (d) => d.steps), restHr: avg(dP, (d) => d.resting_hr) }

    const best = (arr, f) => arr.reduce((b, x) => (f(x) > (b ? f(b) : 0) ? x : b), null)
    const records = {
      dist: best(acts, (a) => Number(a.distance_m)), long: best(acts, (a) => a.duration_sec), maxhr: best(acts, (a) => a.max_hr),
      steps: best(daily, (d) => d.steps), kcal: best(daily, (d) => Number(d.calories))
    }
    return { series, weekly, sportData, zones, total, period, before, records, hasDaily: daily.length > 0, has: acts.length > 0 || daily.length > 0 }
  }, [acts, daily, days])

  if (!data) return <Loading />
  if (!data.has) return <Empty>Aún no hay datos para analizar. Termina una rutina en <b>Entrenar</b> (con tu reloj conectado por Bluetooth se guarda también el pulso) y la analítica se irá sumando aquí.</Empty>
  const { series, weekly, sportData, zones, total, period, before, records, hasDaily } = data
  const hasSteps = series.some((s) => s.steps), hasHr = series.some((s) => s.avg_hr || s.resting_hr), hasSleep = series.some((s) => s.sleep_h)
  const hasZones = Object.values(zones).some((v) => v > 0)
  const tick = Math.max(0, Math.ceil(series.length / 8) - 1)

  return (
    <div className="col">
      <div className="card">
        <div className="row between wrap">
          <h3 style={{ margin: 0 }}><Trophy size={16} className="y" /> Total acumulado</h3>
          <span className="tiny muted">desde {total.first || '—'} · {total.days} días con datos</span>
        </div>
        <div className="grid g4 mt">
          <Stat label="Actividades" value={total.n} icon={Activity} y />
          <Stat label="Distancia" value={`${total.km.toFixed(1)} km`} icon={Route} />
          {hasDaily && <Stat label="Pasos" value={fmtK(total.steps)} icon={Footprints} />}
          <Stat label="Calorías (actividades)" value={fmtK(total.kcal)} sub={fmtTime(total.sec)} icon={Flame} />
        </div>
      </div>

      <div className="row wrap" style={{ gap: 6 }}>
        {[7, 30, 90].map((d) => <button key={d} className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>Últimos {d} días</button>)}
      </div>

      <div className="grid g4">
        {hasDaily && <div className="card"><div className="tiny muted"><Footprints size={13} /> Pasos / día</div><div className="display" style={{ fontSize: '2rem' }}>{fmtK(period.stepsAvg)}</div><Delta now={period.steps} prev={before.steps} /></div>}
        <div className="card"><div className="tiny muted"><Timer size={13} /> Ejercicio</div><div className="display" style={{ fontSize: '2rem' }}>{Math.round(period.min)} min</div><Delta now={period.min} prev={before.min} /></div>
        <div className="card"><div className="tiny muted"><Flame size={13} /> Calorías</div><div className="display" style={{ fontSize: '2rem' }}>{fmtK(period.kcal)}</div><Delta now={period.kcal} prev={before.kcal} /></div>
        {hasDaily && <div className="card"><div className="tiny muted"><HeartPulse size={13} /> Pulso en reposo</div><div className="display" style={{ fontSize: '2rem' }}>{period.restHr ? Math.round(period.restHr) : '—'}<span className="small muted"> lpm</span></div>
          {period.restHr && before.restHr ? <span className="tiny" style={{ color: period.restHr <= before.restHr ? 'var(--ok)' : 'var(--bad)' }}>{period.restHr <= before.restHr ? 'Mejor' : 'Más alto'} que el periodo anterior ({Math.round(before.restHr)})</span> : <span className="tiny muted">sin comparación</span>}</div>}
      </div>

      {hasSteps && (
        <div className="card"><h3><Footprints size={16} /> Pasos por día</h3>
          <ResponsiveContainer width="100%" height={220}><BarChart data={series}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="label" stroke="#666" fontSize={10} interval={tick} /><YAxis stroke="#666" fontSize={11} width={40} /><Tooltip {...tip} formatter={(v) => [v.toLocaleString('es'), 'Pasos']} /><Bar dataKey="steps" fill="#FFD60A" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
      )}

      <div className="grid g2">
        <div className="card"><h3><Flame size={16} /> Calorías por día</h3>
          <ResponsiveContainer width="100%" height={200}><AreaChart data={series}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="label" stroke="#666" fontSize={10} interval={tick} /><YAxis stroke="#666" fontSize={11} width={40} /><Tooltip {...tip} formatter={(v) => [`${v} kcal`, 'Calorías']} /><Area dataKey="kcal" stroke="#f97316" fill="#f97316" fillOpacity={0.2} strokeWidth={2} /></AreaChart></ResponsiveContainer></div>
        {hasHr && <div className="card"><h3><HeartPulse size={16} /> Pulso medio y en reposo</h3>
          <ResponsiveContainer width="100%" height={200}><LineChart data={series}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="label" stroke="#666" fontSize={10} interval={tick} /><YAxis stroke="#666" fontSize={11} width={34} domain={['dataMin - 5', 'dataMax + 5']} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="avg_hr" name="Medio" stroke="#ef4444" dot={false} strokeWidth={2} connectNulls /><Line dataKey="resting_hr" name="Reposo" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls /></LineChart></ResponsiveContainer></div>}
      </div>

      <div className="grid g2">
        {weekly.length > 0 && <div className="card"><h3><Route size={16} /> Distancia y tiempo por semana</h3>
          <ResponsiveContainer width="100%" height={200}><BarChart data={weekly}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="week" stroke="#666" fontSize={10} /><YAxis yAxisId="a" stroke="#666" fontSize={11} width={34} /><YAxis yAxisId="b" orientation="right" stroke="#666" fontSize={11} width={34} /><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="a" dataKey="km" name="km" fill="#FFD60A" radius={[4, 4, 0, 0]} /><Bar yAxisId="b" dataKey="min" name="min" fill="#3b82f6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}
        {sportData.length > 0 && <div className="card"><h3><Activity size={16} /> Tiempo por deporte (min)</h3>
          <ResponsiveContainer width="100%" height={200}><PieChart><Pie data={sportData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>{sportData.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}</Pie><Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div>}
      </div>

      {hasSleep && <div className="card"><h3><Moon size={16} /> Sueño (horas) · promedio {period.sleepAvg.toFixed(1)} h</h3>
        <ResponsiveContainer width="100%" height={180}><BarChart data={series}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="label" stroke="#666" fontSize={10} interval={tick} /><YAxis stroke="#666" fontSize={11} width={30} /><Tooltip {...tip} formatter={(v) => [`${v} h`, 'Sueño']} /><Bar dataKey="sleep_h" fill="#8b5cf6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}

      {hasZones && <div className="card"><h3><HeartPulse size={16} /> Tiempo en zonas de pulso (periodo)</h3><ZoneBar zones={zones} /></div>}

      <div className="card"><h3><Trophy size={16} className="y" /> Récords personales</h3>
        <div className="grid g4">
          <Rec l="Mayor distancia" v={records.dist ? `${(records.dist.distance_m / 1000).toFixed(2)} km` : null} d={records.dist?.started_at} />
          <Rec l="Entrenamiento más largo" v={records.long ? fmtTime(records.long.duration_sec) : null} d={records.long?.started_at} />
          <Rec l="Pulso máximo" v={records.maxhr ? `${records.maxhr.max_hr} lpm` : null} d={records.maxhr?.started_at} />
          <Rec l="Día con más pasos" v={records.steps ? records.steps.steps.toLocaleString('es') : null} d={records.steps?.day} />
        </div>
      </div>
    </div>
  )
}

const Rec = ({ l, v, d }) => (
  <div><div className="tiny muted">{l}</div><div style={{ fontWeight: 800, fontSize: '1.2rem' }}>{v || '—'}</div>{d && <div className="tiny muted">{String(d).slice(0, 10)}</div>}</div>
)
