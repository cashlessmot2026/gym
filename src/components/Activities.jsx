import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { HeartPulse, Flame, Route, Timer, Footprints } from 'lucide-react'
import { fmtTime, fmtDateTime } from '../lib/constants'
import { SPORT_ICON } from '../lib/sports'
import { listActivities } from '../lib/activities'
import { ZONES } from '../lib/hr'
import { Empty, Loading, Modal, Stat, useToast } from './ui'
import { tip } from './Analytics'
import RouteMap from './RouteMap'

const km = (m) => `${(Number(m || 0) / 1000).toFixed(2)} km`

/** Pestaña "Actividades" del perfil: historial de tus entrenamientos. */
export default function Activities({ member }) {
  const toast = useToast()
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => { listActivities(member.id).then(setList).catch((e) => { toast(e.message, 'error'); setList([]) }) }, [member.id])

  const totals = useMemo(() => {
    const now = Date.now()
    const sumIn = (days) => (list || []).filter((a) => now - new Date(a.started_at) < days * 86400000)
      .reduce((t, a) => ({ n: t.n + 1, km: t.km + Number(a.distance_m || 0), kcal: t.kcal + Number(a.calories || 0), sec: t.sec + (a.duration_sec || 0) }), { n: 0, km: 0, kcal: 0, sec: 0 })
    return { week: sumIn(7), month: sumIn(30) }
  }, [list])

  return (
    <div className="col">
      <div className="grid g4">
        <Stat label="Esta semana" value={totals.week.n} sub={`${(totals.week.km / 1000).toFixed(1)} km`} icon={Route} y />
        <Stat label="Kcal semana" value={Math.round(totals.week.kcal)} icon={Flame} />
        <Stat label="Últimos 30 días" value={totals.month.n} sub={`${(totals.month.km / 1000).toFixed(1)} km`} icon={Route} />
        <Stat label="Tiempo 30 días" value={fmtTime(totals.month.sec)} icon={Timer} />
      </div>

      {!list ? <Loading /> : !list.length ? <Empty>Aún no hay actividades. Termina una rutina en <b>Entrenar</b> y aparecerá aquí.</Empty> : (
        <div className="act-list">
          {list.map((a) => (
            <button key={a.id} className="act-card" onClick={() => setOpen(a)}>
              <div className="act-ic">{SPORT_ICON[a.sport] || '⌚'}</div>
              <div className="grow" style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 800, textTransform: 'capitalize' }}>{a.title || a.sport}</div>
                <div className="tiny muted">{fmtDateTime(a.started_at)} · {a.device || a.source.toUpperCase()}</div>
                <div className="row wrap small mt-s" style={{ gap: 10 }}>
                  <span><Timer size={13} /> {fmtTime(a.duration_sec)}</span>
                  {a.distance_m > 0 && <span><Route size={13} /> {km(a.distance_m)}</span>}
                  {a.calories > 0 && <span><Flame size={13} /> {Math.round(a.calories)} kcal</span>}
                  {a.avg_hr && <span className="hr-live"><HeartPulse size={13} /> {a.avg_hr} lpm</span>}
                </div>
              </div>
              {a.route && <span className="badge y">Mapa</span>}
            </button>
          ))}
        </div>
      )}
      {open && <ActivityDetail a={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

export function ZoneBar({ zones }) {
  if (!zones) return null
  const total = ZONES.reduce((s, z) => s + (zones[z.id] || 0), 0)
  if (!total) return null
  return (
    <div>
      <div className="zone-bar">{ZONES.map((z) => zones[z.id] > 0 && <div key={z.id} style={{ flex: zones[z.id], background: z.color }} title={`${z.label}: ${zones[z.id]} min`} />)}</div>
      <div className="row wrap tiny mt-s" style={{ gap: 10 }}>{ZONES.map((z) => <span key={z.id}><i className="dot" style={{ background: z.color }} /> {z.label} {zones[z.id] || 0} min</span>)}</div>
    </div>
  )
}

function ActivityDetail({ a, onClose }) {
  const data = (a.hr_series || []).map(([s, hr]) => ({ min: +(s / 60).toFixed(1), hr }))
  return (
    <Modal title={`${SPORT_ICON[a.sport] || '⌚'} ${a.title || a.sport}`} onClose={onClose} wide>
      <div className="tiny muted mb">{fmtDateTime(a.started_at)} · {a.device || a.source.toUpperCase()}</div>
      <div className="grid g4 mb">
        <Stat label="Duración" value={fmtTime(a.duration_sec)} icon={Timer} y />
        <Stat label="Distancia" value={km(a.distance_m)} icon={Route} />
        <Stat label="Calorías" value={Math.round(a.calories || 0)} icon={Flame} />
        {a.steps > 0 ? <Stat label="Pasos" value={a.steps} icon={Footprints} /> : <Stat label="Pulso" value={a.avg_hr ? `${a.avg_hr}/${a.max_hr}` : '—'} sub="medio / máx" icon={HeartPulse} />}
      </div>
      {a.route && <div className="mb"><RouteMap route={a.route} height={300} /></div>}
      {data.length > 1 && (
        <div className="card mb">
          <h3><HeartPulse size={16} /> Pulso · medio {a.avg_hr} · máx {a.max_hr} lpm</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data}>
              <CartesianGrid stroke="#262626" vertical={false} />
              <XAxis dataKey="min" stroke="#666" fontSize={11} unit=" min" />
              <YAxis stroke="#666" fontSize={11} domain={['dataMin - 10', 'dataMax + 5']} width={34} />
              <Tooltip {...tip} formatter={(v) => [`${v} lpm`, 'Pulso']} />
              <Area dataKey="hr" stroke="#ef4444" fill="#ef4444" fillOpacity={0.18} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <ZoneBar zones={a.hr_zones} />
    </Modal>
  )
}

