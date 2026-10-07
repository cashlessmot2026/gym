import { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { Upload, RefreshCw, HeartPulse, Flame, Route, Timer, Footprints, Watch, Settings2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtTime, fmtDateTime } from '../lib/constants'
import { ACCEPT, parseActivityFile, SPORT_ICON } from '../lib/activityFiles'
import { listActivities, saveActivities, syncHealth, latestWeight } from '../lib/activities'
import { connectHealth, healthSupported, healthConsented, openHealthSettings } from '../lib/health'
import { ZONES, hrProfile } from '../lib/hr'
import { Empty, Loading, Modal, Stat, Spinner, useToast } from './ui'
import { tip } from './Analytics'
import RouteMap from './RouteMap'

const km = (m) => `${(Number(m || 0) / 1000).toFixed(2)} km`

/** Pestaña "Actividades" del perfil: pulseras, Health Connect y archivos FIT/TCX/GPX. */
export default function Activities({ member, own, onChanged }) {
  const toast = useToast()
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)
  const [open, setOpen] = useState(null)
  const file = useRef(null)

  const load = () => listActivities(member.id).then(setList).catch((e) => { toast(e.message, 'error'); setList([]) })
  useEffect(() => { load() }, [member.id])

  const done = (n, what) => {
    toast(n ? `✅ ${n} actividad${n > 1 ? 'es' : ''} nueva${n > 1 ? 's' : ''} desde ${what}` : `Sin actividades nuevas en ${what}`, n ? 'success' : 'info')
    load(); onChanged?.()
  }

  const sync = async () => {
    setBusy('sync')
    try {
      if (!healthConsented()) await connectHealth()
      done(await syncHealth(member), 'Health Connect')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }

  const upload = async (files) => {
    if (!files?.length) return
    setBusy('file')
    try {
      const profile = hrProfile(member, await latestWeight(member.id))
      const parsed = [], errors = []
      for (const f of files) { try { parsed.push(await parseActivityFile(f, profile)) } catch (e) { errors.push(e.message) } }
      errors.forEach((m) => toast(m, 'error'))
      if (parsed.length) done(await saveActivities(member, parsed), parsed.length > 1 ? `${parsed.length} archivos` : 'el archivo')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null); if (file.current) file.current.value = '' }
  }

  const totals = useMemo(() => {
    const now = Date.now()
    const sumIn = (days) => (list || []).filter((a) => now - new Date(a.started_at) < days * 86400000)
      .reduce((t, a) => ({ n: t.n + 1, km: t.km + Number(a.distance_m || 0), kcal: t.kcal + Number(a.calories || 0), sec: t.sec + (a.duration_sec || 0) }), { n: 0, km: 0, kcal: 0, sec: 0 })
    return { week: sumIn(7), month: sumIn(30) }
  }, [list])

  return (
    <div className="col">
      {own && (
        <div className="card">
          <div className="row wrap between">
            <div><h3 style={{ margin: 0 }}><Watch size={18} /> Datos de pulsera y reloj</h3>
              <div className="tiny muted">Se suman a tu ranking y a tus retos cada vez que sincronizas.</div></div>
            <div className="row wrap">
              {healthSupported() && <button className="btn primary" disabled={!!busy} onClick={sync}>{busy === 'sync' ? <Spinner size={16} /> : <RefreshCw size={16} />} Sincronizar pulsera</button>}
              {healthSupported() && healthConsented() && <button className="btn sm ghost" onClick={openHealthSettings} title="Permisos de Health Connect"><Settings2 size={16} /></button>}
              <button className="btn" disabled={!!busy} onClick={() => file.current?.click()}>{busy === 'file' ? <Spinner size={16} /> : <Upload size={16} />} Subir FIT / TCX / GPX</button>
              <input ref={file} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload([...e.target.files])} />
            </div>
          </div>
          {!healthSupported() && <p className="tiny muted mb0">En la app Android puedes sincronizar Mi Fitness, Zepp, Garmin Connect o Samsung Health con Health Connect. Desde aquí, exporta el entrenamiento como archivo y súbelo.</p>}
        </div>
      )}

      <div className="grid g4">
        <Stat label="Esta semana" value={totals.week.n} sub={`${(totals.week.km / 1000).toFixed(1)} km`} icon={Route} y />
        <Stat label="Kcal semana" value={Math.round(totals.week.kcal)} icon={Flame} />
        <Stat label="Últimos 30 días" value={totals.month.n} sub={`${(totals.month.km / 1000).toFixed(1)} km`} icon={Route} />
        <Stat label="Tiempo 30 días" value={fmtTime(totals.month.sec)} icon={Timer} />
      </div>

      {!list ? <Loading /> : !list.length ? <Empty>Aún no hay actividades de pulsera o reloj.</Empty> : (
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

/** Tarjeta visible en el perfil: sincroniza Health Connect (pulseras y apps de fitness) y guarda el historial. */
export function HealthSyncCard({ member, onSynced }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(member.health_last_sync)
  const native = healthSupported()

  const run = async (full) => {
    setBusy(true)
    try {
      if (!healthConsented()) await connectHealth()
      let m = member
      if (full) { await supabase.from('members').update({ health_last_sync: null }).eq('id', member.id); m = { ...member, health_last_sync: null } }
      const n = await syncHealth(m)
      setLast(new Date().toISOString())
      toast(n ? `✅ ${n} actividad${n > 1 ? 'es' : ''} nueva${n > 1 ? 's' : ''} · historial actualizado` : 'Historial actualizado (sin actividades nuevas)', 'success')
      onSynced?.()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="card mt" style={{ borderColor: 'var(--y)' }}>
      <div className="row between wrap" style={{ gap: 10 }}>
        <div className="grow" style={{ minWidth: 200 }}>
          <h3 style={{ margin: 0 }}><HeartPulse size={18} className="y" /> Salud y pulsera</h3>
          <div className="tiny muted">
            {native
              ? (last ? `Última sincronización: ${fmtDateTime(last)}` : 'Aún no has sincronizado. Conecta Health Connect para traer tus datos de Mi Fitness, Zepp, Garmin, Samsung Health o Google Fit.')
              : 'La sincronización con Health Connect está en la app Android (APK). Aquí puedes subir archivos FIT, TCX o GPX desde la pestaña ⌚.'}
          </div>
        </div>
        {native && (
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn primary" disabled={busy} onClick={() => run(false)}>{busy ? <Spinner size={16} /> : <RefreshCw size={16} />} {healthConsented() ? 'Sincronizar ahora' : 'Conectar Health Connect'}</button>
            {healthConsented() && <>
              <button className="btn sm" disabled={busy} onClick={() => run(true)} title="Vuelve a leer los últimos 90 días">Reimportar 90 días</button>
              <button className="btn sm ghost" onClick={openHealthSettings} title="Permisos de Health Connect"><Settings2 size={16} /></button>
            </>}
          </div>
        )}
      </div>
    </div>
  )
}
