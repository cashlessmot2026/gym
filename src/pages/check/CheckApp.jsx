import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IdCard, QrCode, Nfc, ScanFace, CheckCircle2, XCircle, Delete, Power, Usb, Maximize, Minimize, Clock } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { startNfcScan, nfcSupported, nfcStatus, openNfcSettings } from '../../lib/nfc'
import { loadFace, detectFace, bestMatch, drawBox, preloadFace } from '../../lib/face'
import { Brand, Avatar, StatusBadge, Spinner, Empty } from '../../components/ui'
import { QRScanner, useCamera, useFacing, CameraSwitch } from '../../components/Media'

const MODES = [
  { id: 'cedula', label: 'Cédula', icon: IdCard },
  { id: 'qr', label: 'Código QR', short: 'QR', icon: QrCode },
  { id: 'nfc', label: 'Tag NFC', short: 'NFC', icon: Nfc },
  { id: 'face', label: 'Facial', icon: ScanFace }
]
const MODE_KEY = 'iy_check_mode'
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

let chime
function sound(ok) {
  try {
    chime ??= new (window.AudioContext || window.webkitAudioContext)()
    const o = chime.createOscillator(), g = chime.createGain()
    o.frequency.value = ok ? 1046 : 220; o.type = ok ? 'sine' : 'square'
    o.connect(g); g.connect(chime.destination); g.gain.setValueAtTime(0.2, chime.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, chime.currentTime + 0.35); o.start(); o.stop(chime.currentTime + 0.35)
  } catch { /* sin audio */ }
  navigator.vibrate?.(ok ? 120 : [80, 60, 80])
}

// Nombre corto para la lista pública del kiosco (privacidad)
const shortName = (n = '') => { const [a, b] = n.split(' '); return b ? `${a} ${b[0]}.` : a }

/**
 * Kiosco de control de acceso (sin inicio de sesión): cédula, QR, NFC y reconocimiento facial.
 * Diseño adaptable: móvil (Android/iPhone), tablet y PC.
 */
export default function CheckApp() {
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || 'cedula')
  const [result, setResult] = useState(null)
  const [recent, setRecent] = useState([])
  const [now, setNow] = useState(new Date())
  const [full, setFull] = useState(false)
  const busy = useRef(false)
  const nav = useNavigate()
  const native = !!window.Capacitor?.isNativePlatform?.()

  const pick = (m) => { setMode(m); localStorage.setItem(MODE_KEY, m) }
  const loadRecent = () => q(supabase.from('attendance').select('*, members(full_name, photo)').order('created_at', { ascending: false }).limit(10)).then(setRecent).catch(() => {})

  useEffect(() => {
    loadRecent()
    preloadFace() // la IA facial queda lista en segundo plano
    const t = setInterval(() => setNow(new Date()), 1000)
    // Mantener la pantalla encendida en tablets/kioscos (si el navegador lo permite)
    let lock
    const wake = async () => { try { lock = await navigator.wakeLock?.request('screen') } catch { /* no soportado */ } }
    wake()
    const vis = () => document.visibilityState === 'visible' && wake()
    document.addEventListener('visibilitychange', vis)
    const fs = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', fs)
    return () => { clearInterval(t); lock?.release?.(); document.removeEventListener('visibilitychange', vis); document.removeEventListener('fullscreenchange', fs) }
  }, [])

  const canFull = !!document.documentElement.requestFullscreen
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}))

  /** Valida y registra la asistencia. by: {cedula}|{qr}|{nfc,texts}|{id} */
  const checkIn = async (by, method) => {
    if (busy.current) return
    busy.current = true
    try {
      let query = supabase.from('member_status').select('*')
      if (by.id) query = query.eq('member_id', by.id)
      else if (by.cedula) query = query.eq('cedula', by.cedula.trim())
      else if (by.qr) query = query.eq('qr_code', by.qr.trim())
      else if (by.nfc) {
        // sólo caracteres seguros para el filtro de PostgREST
        const safe = (s) => String(s).trim().replace(/[^A-Za-z0-9:_-]/g, '')
        const uid = safe(by.nfc)
        const codes = (by.texts || []).map(safe).filter(Boolean).map((t) => `qr_code.eq.${t}`)
        query = query.or([`nfc_uid.eq.${uid}`, `nfc_uid.eq.${uid.toUpperCase()}`, `nfc_uid.eq.${uid.toLowerCase()}`, ...codes].join(','))
      }
      const [m] = await q(query.limit(1))
      if (!m) { sound(false); setResult({ ok: false, title: 'No registrado', msg: by.nfc ? `Tag leído (${by.nfc}) pero no está asignado a ningún cliente. Asígnalo desde la ficha del cliente.` : 'No se encontró ningún cliente con ese dato.' }); return }
      const allowed = m.active && (m.status === 'activa' || m.status === 'por_vencer')
      const [last] = await q(supabase.from('attendance').select('created_at').eq('member_id', m.member_id).order('created_at', { ascending: false }).limit(1))
      if (!last || Date.now() - new Date(last.created_at).getTime() > 60000) {
        await q(supabase.from('attendance').insert({ member_id: m.member_id, method, allowed }))
      }
      sound(allowed)
      setResult({
        ok: allowed, m, title: allowed ? '¡Bienvenido!' : 'Acceso denegado',
        msg: allowed ? (m.status === 'por_vencer' ? `Tu membresía vence en ${m.days_left} días. ¡Renueva pronto!` : `Te quedan ${m.days_left} días de membresía.`)
          : !m.active ? 'Usuario inactivo. Acércate a recepción.' : m.status === 'vencida' ? 'Tu membresía está vencida. Pasa por recepción para renovar.' : 'No tienes un plan activo.'
      })
      loadRecent()
    } catch {
      sound(false)
      setResult({ ok: false, title: 'Sin conexión', msg: 'No se pudo validar. Revisa la conexión a internet.' })
    } finally {
      setTimeout(() => { busy.current = false }, 1500)
    }
  }

  useEffect(() => {
    if (!result) return
    const t = setTimeout(() => setResult(null), 6000)
    return () => clearTimeout(t)
  }, [result])

  return (
    <div className="kiosk">
      <section className="kiosk-main">
        <header className="kiosk-head">
          <Brand sub="CONTROL DE ACCESO" />
          <div className="kiosk-clock">
            <div className="display">{now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="tiny muted">{now.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          </div>
          {native && <button className="btn sm ghost" onClick={() => nav('/')}>Salir</button>}
          {canFull && <button className="icon-btn kiosk-fs" onClick={toggleFull} title="Pantalla completa">{full ? <Minimize size={20} /> : <Maximize size={20} />}</button>}
        </header>

        <nav className="mode-grid" aria-label="Método de ingreso">
          {MODES.map((m) => (
            <button key={m.id} className={`mode-btn ${mode === m.id ? 'on' : ''}`} onClick={() => pick(m.id)}>
              <m.icon /><span className="mode-l">{m.label}</span><span className="mode-s">{m.short || m.label}</span>
            </button>
          ))}
        </nav>

        <div className="kiosk-reader">
          {mode === 'cedula' && <CedulaPad onSubmit={(c) => checkIn({ cedula: c }, 'cedula')} />}
          {mode === 'qr' && <div className="card reader-card"><h3 className="center">Muestra tu código QR a la cámara</h3><QRScanner onScan={(t) => checkIn({ qr: t }, 'qr')} /></div>}
          {mode === 'nfc' && <NfcReader onRead={(r) => checkIn({ nfc: r.serial, texts: r.texts }, 'nfc')} />}
          {mode === 'face' && <FaceCheck onMatch={(id) => checkIn({ id }, 'face')} paused={!!result} />}
        </div>
      </section>

      <aside className="kiosk-side">
        <div className={`result-wrap ${result ? 'show' : ''}`} onClick={() => setResult(null)}>
          {result ? (
            <div className={`result ${result.ok ? 'ok' : 'bad'}`}>
              {result.ok ? <CheckCircle2 size={64} className="ok" /> : <XCircle size={64} className="bad" />}
              <h2 className="display result-title">{result.title}</h2>
              {result.m && <>
                <div style={{ display: 'grid', placeItems: 'center' }}><Avatar lg src={result.m.photo} name={result.m.full_name} /></div>
                <div style={{ fontWeight: 800, fontSize: '1.3rem', marginTop: 10 }}>{result.m.full_name}</div>
                <div className="muted small">{result.m.plan_name || 'Sin plan'}</div>
                <div className="mt"><StatusBadge status={result.m.status} days={result.m.days_left} /></div>
                {result.m.status !== 'sin_plan' && <div className="display y" style={{ fontSize: '4rem', lineHeight: 1, marginTop: 10 }}>{result.m.days_left}<span className="small muted" style={{ fontFamily: 'var(--font)' }}> días</span></div>}
              </>}
              <p>{result.msg}</p>
              <div className="tiny muted">Toca para cerrar</div>
            </div>
          ) : (
            <div className="empty waiting"><ScanFace size={42} className="y" /><p>Esperando check-in…</p></div>
          )}
        </div>
        <h3 className="mt2 row" style={{ gap: 6 }}><Clock size={16} className="y" /> Últimos ingresos</h3>
        <div className="col" style={{ gap: 8 }}>
          {recent.map((r) => (
            <div key={r.id} className="row">
              <Avatar src={r.members?.photo} name={r.members?.full_name} />
              <div className="grow"><div className="small" style={{ fontWeight: 700 }}>{shortName(r.members?.full_name)}</div>
                <div className="tiny muted">{new Date(r.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} · {r.method.toUpperCase()}</div></div>
              {r.allowed ? <CheckCircle2 size={18} className="ok" /> : <XCircle size={18} className="bad" />}
            </div>
          ))}
          {!recent.length && <span className="muted small">Sin registros</span>}
        </div>
      </aside>
    </div>
  )
}

function CedulaPad({ onSubmit }) {
  const [v, setV] = useState('')
  // En pantallas táctiles se usa el teclado propio (evita que se abra el teclado del sistema)
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const press = (k) => setV((x) => (k === 'del' ? x.slice(0, -1) : (x + k).slice(0, 15)))
  const go = () => { if (v) { onSubmit(v); setV('') } }
  return (
    <div className="card reader-card pad">
      <h3 className="center">Ingresa tu número de cédula</h3>
      <input className="input display pad-input" value={v} inputMode="numeric" readOnly={touch} autoFocus={!touch} placeholder="• • • • • •"
        onChange={(e) => setV(e.target.value.replace(/[^\dA-Za-z-]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <div className="pad-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
          <button key={k} className={`btn pad-key ${k === 'ok' ? 'primary' : ''}`} onClick={() => (k === 'ok' ? go() : press(k))} aria-label={k === 'del' ? 'Borrar' : k === 'ok' ? 'Confirmar' : k}>
            {k === 'del' ? <Delete /> : k === 'ok' ? <CheckCircle2 /> : k}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Lector NFC con botón de encendido/apagado: queda activo 5 segundos. */
function NfcReader({ onRead }) {
  const [on, setOn] = useState(false)
  const [left, setLeft] = useState(0)
  const [err, setErr] = useState('')
  const [usb, setUsb] = useState('')
  const [st, setSt] = useState(null)       // estado del NFC del dispositivo
  const [lastUid, setLastUid] = useState('')
  const [logs, setLogs] = useState([])
  const stopRef = useRef(null)
  const native = !!window.Capacitor?.isNativePlatform?.()
  const log = (m) => setLogs((l) => [...l.slice(-5), `${new Date().toLocaleTimeString('es')}  ${m}`])
  useEffect(() => { nfcStatus().then(setSt) }, [])

  const stop = () => { stopRef.current?.(); stopRef.current = null; setOn(false); setLeft(0) }
  // En el APK el lector es continuo (queda encendido mientras estés en este modo); en el navegador dura 5 s
  const start = async () => {
    setErr(''); setOn(true); log('Encendiendo el lector…')
    try {
      stopRef.current = await startNfcScan({
        ms: native ? 0 : 5000, log,
        onRead: (r) => { setLastUid(r.serial || '(sin UID)'); onRead(r); if (!native) stop() },
        onError: setErr,
        onEnd: () => { setOn(false); setLeft(0) }
      })
      setLeft(native ? 0 : 5)
    } catch (e) { setOn(false); setErr(e.message); log('Error: ' + e.message) }
  }
  // APK: al elegir "Tag NFC" el lector se enciende solo
  useEffect(() => { if (native) start() }, [])
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000)
    return () => clearInterval(t)
  }, [on])
  useEffect(() => () => stopRef.current?.(), [])

  return (
    <div className="card center reader-card">
      <h3>Lectura de tag NFC</h3>
      <div className={`nfc-pulse ${on ? 'on' : ''}`}><Nfc size={54} /></div>
      <p className="display" style={{ fontSize: '1.8rem', margin: '14px 0 6px' }}>{on ? (native ? 'LEYENDO… ACERCA EL TAG' : `LEYENDO… ${left}s`) : 'LECTOR APAGADO'}</p>
      <button className={`btn lg ${on ? 'danger' : 'primary'}`} onClick={on ? stop : start} disabled={!nfcSupported()}>
        <Power size={20} /> {on ? 'Apagar' : native ? 'Encender lector' : 'Encender (5 s)'}
      </button>
      {!nfcSupported() && <p className="tiny warn mt">{isIOS() ? 'iPhone y iPad no permiten leer NFC desde el navegador: usa cédula, QR o facial, o un lector NFC USB/Bluetooth.' : 'Web NFC requiere Chrome en Android. Alternativa: lector NFC USB abajo.'}</p>}
      {err && <div className="badge bad mt">{err}</div>}
      {native && /apagado/i.test(err) && <button className="btn sm mt" onClick={() => openNfcSettings().catch((e) => setErr(e.message))}>Abrir ajustes de NFC</button>}
      {st && <p className="tiny mt" style={{ color: st.supported && st.enabled ? 'var(--ok)' : 'var(--bad)' }}>{st.kind === 'native' ? '📱 Lector nativo · ' : ''}{st.detail}</p>}
      {lastUid && <p className="tiny muted">Último tag leído: <b>{lastUid}</b></p>}
      {native && logs.length > 0 && <pre className="tiny muted" style={{ textAlign: 'left', whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{logs.map((l, i) => <div key={i}>{l}</div>)}</pre>}
      <div className="mt2" style={{ textAlign: 'left' }}>
        <label className="tiny muted" style={{ fontWeight: 700 }}><Usb size={12} /> LECTOR USB (modo teclado): haz clic y pasa el tag</label>
        <input className="input mt" value={usb} placeholder="UID del tag" onChange={(e) => setUsb(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && usb.trim()) { onRead({ serial: usb.trim(), texts: [usb.trim()] }); setUsb('') } }} />
      </div>
    </div>
  )
}

/**
 * Reconocimiento facial continuo: compara contra todos los clientes con rostro
 * registrado. Exige 3 coincidencias consecutivas del mismo cliente para confirmar.
 */
function FaceCheck({ onMatch, paused }) {
  const [facing, toggleFacing] = useFacing('check', 'user')
  const { ref, err, ready } = useCamera(true, facing)
  const canvasRef = useRef(null)
  const [members, setMembers] = useState(null)
  const [hint, setHint] = useState('Cargando reconocimiento facial…')
  const [modelOk, setModelOk] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const membersRef = useRef([])
  membersRef.current = members || []

  useEffect(() => {
    loadFace().then(() => setModelOk(true)).catch(() => setHint('No se pudo cargar la IA facial. Revisa la conexión.'))
    // Rostros registrados; se refresca cada minuto para incluir inscripciones nuevas
    const load = () => q(supabase.from('members').select('id, full_name, face_descriptors').not('face_descriptors', 'is', null).eq('active', true))
      .then((r) => setMembers(r.filter((m) => Array.isArray(m.face_descriptors) && m.face_descriptors.length))).catch(() => setMembers([]))
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!ready || !modelOk || !members) return
    let stop = false
    let streak = { id: null, n: 0 }
    const loop = async () => {
      while (!stop) {
        if (pausedRef.current) { await new Promise((r) => setTimeout(r, 400)); streak = { id: null, n: 0 }; continue }
        const det = await detectFace(ref.current, 0.5).catch(() => null)
        drawBox(canvasRef.current, ref.current, det)
        if (!det) { setHint('Mira a la cámara'); streak = { id: null, n: 0 } }
        else if (det.detection.box.width < (ref.current.videoWidth || 640) * 0.1) setHint('Acércate un poco')
        else {
          const list = membersRef.current
          const r = list.length ? bestMatch(det.descriptor, list) : { match: null, none: true }
          if (r.match) {
            streak = streak.id === r.match.id ? { id: r.match.id, n: streak.n + 1 } : { id: r.match.id, n: 1 }
            setHint(`Verificando… ${Math.min(100, streak.n * 34)}%`)
            if (streak.n >= 3) { onMatch(r.match.id); streak = { id: null, n: 0 }; await new Promise((x) => setTimeout(x, 3000)) }
          } else {
            streak = { id: null, n: 0 }
            setHint(r.none ? 'Rostro detectado, pero aún no hay rostros registrados' : r.ambiguous ? 'Coincidencia ambigua, mira de frente' : 'Rostro no reconocido. ¿Ya registraste tu rostro?')
          }
        }
        await new Promise((x) => setTimeout(x, 60))
      }
    }
    setHint('Mira a la cámara')
    loop()
    return () => { stop = true }
  }, [ready, modelOk, members === null, facing])

  return (
    <div className="card reader-card wide">
      <div className={`cam ${facing === 'environment' ? 'rear' : ''}`}>
        <video ref={ref} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
        <div className="oval" />
        <div className="cam-tools"><CameraSwitch facing={facing} onToggle={toggleFacing} /></div>
        <div className="hint">{err || (!modelOk ? <><Spinner size={14} /> Cargando IA…</> : hint)}</div>
      </div>
      <p className="tiny muted center mt">{members ? `${members.length} rostros registrados` : '…'} · 3 confirmaciones consecutivas</p>
      {members && !members.length && <Empty>Registra rostros desde el formulario de inscripción en /admin</Empty>}
    </div>
  )
}
