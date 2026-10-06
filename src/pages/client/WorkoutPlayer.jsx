import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipForward, CheckCircle2, X, HeartPulse, Watch, CirclePlay } from 'lucide-react'
import { fmtTime } from '../../lib/constants'
import { onWatch, enableMediaControls, disableMediaControls, updateMediaTitle } from '../../lib/watch'
import { videoSearch } from '../../lib/exerciseLibrary'
import { useWatch, WatchPanel } from '../../components/Media'

let actx
function beep(freq = 880, ms = 140) {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)()
    const o = actx.createOscillator(), g = actx.createGain()
    o.frequency.value = freq; o.connect(g); g.connect(actx.destination)
    g.gain.setValueAtTime(0.25, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + ms / 1000)
    o.start(); o.stop(actx.currentTime + ms / 1000)
  } catch { /* sin audio */ }
  navigator.vibrate?.(ms)
}

/**
 * Contador del ejercicio: series × (trabajo + descanso) asignados por el coach.
 * Botón del smartwatch: detiene el contador de trabajo (serie completada) o salta el descanso.
 * Controles multimedia del reloj: Pausa / Play / Siguiente.
 */
export default function WorkoutPlayer({ item, onFinish, onClose }) {
  const ex = item.exercise
  const watch = useWatch()
  const [phase, setPhase] = useState('ready')
  const [set, setSet] = useState(1)
  const [paused, setPaused] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [reps, setReps] = useState(item.reps)
  const [weight, setWeight] = useState(item.weight || '')
  const [times, setTimes] = useState([])
  const t = useRef({ start: 0, pausedAt: null, pausedTotal: 0, lastBeep: null })
  const startedAt = useRef(null)

  const elapsed = () => {
    const r = t.current
    if (!r.start) return 0
    const p = r.pausedTotal + (r.pausedAt ? Date.now() - r.pausedAt : 0)
    return (Date.now() - r.start - p) / 1000
  }
  const startPhase = (ph) => { t.current = { start: Date.now(), pausedAt: null, pausedTotal: 0, lastBeep: null }; setPaused(false); setPhase(ph) }

  const target = phase === 'work' ? item.work_sec : phase === 'rest' ? item.rest_sec : 0
  const el = phase === 'work' || phase === 'rest' ? elapsed() : 0
  const remaining = Math.max(0, target - el)

  const begin = () => {
    startedAt.current = Date.now()
    beep(1200, 200)
    startPhase('work')
    enableMediaControls({
      title: ex.name, artist: `Serie 1/${item.sets}`,
      onPause: () => api.current.pause(true), onPlay: () => api.current.pause(false), onNext: () => api.current.button()
    })
  }

  const finished = useRef(false)
  const completeSet = useCallback(() => {
    if (finished.current) return
    const work = Math.round(elapsed())
    const entry = { set, work, rest: 0, reps: Number(reps) || 0, weight: Number(weight) || null }
    const next = [...times, entry]
    setTimes(next)
    beep(660, 250)
    if (set >= item.sets) {
      finished.current = true
      setPhase('done')
      disableMediaControls()
      onFinish({ setTimes: next, reps: Number(reps) || 0, weight: Number(weight) || null, startedAt: startedAt.current, completed: true })
    } else if (item.rest_sec > 0) {
      startPhase('rest')
      updateMediaTitle(`Descanso · ${ex.name}`, `Siguiente: serie ${set + 1}/${item.sets}`)
    } else {
      setSet((s) => s + 1); startPhase('work')
    }
  }, [set, reps, weight, times, item])

  const nextSet = useCallback(() => {
    const rest = Math.round(elapsed())
    setTimes((x) => x.map((e, i) => (i === x.length - 1 ? { ...e, rest } : e)))
    setSet((s) => s + 1)
    beep(1200, 200)
    startPhase('work')
    updateMediaTitle(ex.name, `Serie ${set + 1}/${item.sets}`)
  }, [set, item])

  const togglePause = (force) => {
    const r = t.current
    const want = typeof force === 'boolean' ? force : !paused
    if (want && !r.pausedAt) r.pausedAt = Date.now()
    if (!want && r.pausedAt) { r.pausedTotal += Date.now() - r.pausedAt; r.pausedAt = null }
    setPaused(want)
  }

  // Botón universal (reloj BLE, barra espaciadora, botón "Siguiente" multimedia)
  const button = () => {
    if (phase === 'ready') return begin()
    if (paused) return togglePause(false)
    if (phase === 'work') return completeSet()
    if (phase === 'rest') return nextSet()
  }
  const api = useRef({})
  api.current = { pause: togglePause, button }

  useEffect(() => {
    const off = onWatch('button', () => api.current.button())
    const key = (e) => { if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); api.current.button() } }
    window.addEventListener('keydown', key)
    return () => { off(); window.removeEventListener('keydown', key); disableMediaControls() }
  }, [])

  useEffect(() => {
    if (phase !== 'work' && phase !== 'rest') return
    const id = setInterval(() => {
      setNow(Date.now())
      if (t.current.pausedAt) return
      const rem = target - elapsed()
      const sec = Math.ceil(rem)
      if (sec <= 3 && sec > 0 && t.current.lastBeep !== sec) { t.current.lastBeep = sec; beep(520, 90) }
      if (rem <= 0) {
        if (phase === 'work') api.current.workEnd?.()
        else api.current.restEnd?.()
      }
    }, 200)
    return () => clearInterval(id)
  }, [phase, target])
  api.current.workEnd = completeSet
  api.current.restEnd = nextSet

  const pct = target ? Math.min(1, el / target) : 0
  const R = 140, C = 2 * Math.PI * R
  const close = () => {
    if (times.length && phase !== 'done') {
      onFinish({ setTimes: times, reps: Number(reps) || 0, weight: Number(weight) || null, startedAt: startedAt.current, completed: false })
    }
    onClose()
  }

  return (
    <div className="overlay">
      <div className="modal" style={{ width: 'min(560px, 100%)' }}>
        <div className="modal-h">
          <div>
            <div className="tiny muted" style={{ fontWeight: 700, letterSpacing: '.1em' }}>{ex.muscle_group?.toUpperCase()}</div>
            <h2>{ex.name}</h2>
          </div>
          <button className="icon-btn" onClick={close}><X /></button>
        </div>

        <div className="row between wrap mb">
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="badge y">{item.sets} series</span><span className="badge">{item.reps} reps</span>
            <span className="badge">{fmtTime(item.work_sec)} trabajo</span><span className="badge">{fmtTime(item.rest_sec)} descanso</span>
          </div>
          <WatchPanel compact />
        </div>

        <div className="timer-ring">
          <svg viewBox="0 0 320 320">
            <circle cx="160" cy="160" r={R} fill="none" stroke="#1f1f1f" strokeWidth="16" />
            <circle cx="160" cy="160" r={R} fill="none" stroke={phase === 'rest' ? '#60a5fa' : '#FFD60A'} strokeWidth="16" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * pct} style={{ transition: 'stroke-dashoffset .2s linear' }} />
          </svg>
          <div className="timer-center">
            <span className={`phase ${phase === 'work' ? 'work' : phase === 'rest' ? 'rest' : 'ready'}`}>
              {phase === 'ready' ? 'LISTO' : phase === 'work' ? (paused ? 'PAUSA' : 'TRABAJO') : phase === 'rest' ? (paused ? 'PAUSA' : 'DESCANSO') : 'COMPLETADO'}
            </span>
            <div className="timer-num">{phase === 'ready' ? fmtTime(item.work_sec) : phase === 'done' ? '✔' : fmtTime(Math.ceil(remaining))}</div>
            <div className="muted small">Serie {Math.min(set, item.sets)} de {item.sets}</div>
            {watch.hr && <div className="hr-live small mt"><HeartPulse size={14} /> {watch.hr} lpm</div>}
          </div>
        </div>

        <div className="sets-dots mt">
          {Array.from({ length: item.sets }).map((_, i) => <span key={i} className={i < times.length ? 'done' : i === times.length && phase !== 'ready' ? 'cur' : ''} />)}
        </div>

        <div className="grid g2 mt">
          <div className="field"><label>Repeticiones realizadas</label><input className="input" type="number" value={reps} onChange={(e) => setReps(e.target.value)} /></div>
          <div className="field"><label>Peso (kg)</label><input className="input" type="number" step="0.5" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="opcional" /></div>
        </div>

        <div className="row mt" style={{ justifyContent: 'center' }}>
          {phase === 'ready' && <button className="btn primary lg block" onClick={begin}><Play size={20} /> Comenzar</button>}
          {(phase === 'work' || phase === 'rest') && (
            <>
              <button className="btn lg" onClick={() => togglePause()}>{paused ? <Play size={20} /> : <Pause size={20} />}</button>
              {phase === 'work'
                ? <button className="btn primary lg grow" onClick={completeSet}><CheckCircle2 size={20} /> Serie completada</button>
                : <button className="btn primary lg grow" onClick={nextSet}><SkipForward size={20} /> Saltar descanso</button>}
            </>
          )}
          {phase === 'done' && <button className="btn primary lg block" onClick={onClose}><CheckCircle2 size={20} /> Ejercicio terminado</button>}
        </div>

        {times.length > 0 && (
          <div className="table-wrap mt"><table className="t">
            <thead><tr><th>Serie</th><th>Trabajo</th><th>Descanso</th><th>Reps</th><th>Kg</th></tr></thead>
            <tbody>{times.map((x) => <tr key={x.set}><td>{x.set}</td><td>{fmtTime(x.work)}</td><td>{x.rest ? fmtTime(x.rest) : '—'}</td><td>{x.reps}</td><td>{x.weight || '—'}</td></tr>)}</tbody>
          </table></div>
        )}

        <div className="row between mt">
          <span className="tiny muted"><Watch size={12} /> Botón del reloj / barra espaciadora = detener contador</span>
          <a className="btn sm ghost" href={videoSearch(ex.name)} target="_blank" rel="noreferrer"><CirclePlay size={14} /> Técnica</a>
        </div>
        {item.notes && <p className="small muted">📝 {item.notes}</p>}
      </div>
    </div>
  )
}
