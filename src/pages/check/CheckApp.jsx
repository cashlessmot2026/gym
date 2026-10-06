import { useEffect, useRef, useState } from 'react'
import { IdCard, QrCode, Nfc, ScanFace, LogOut, CheckCircle2, XCircle, Delete, Power, Usb } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { getSession, setSession, clearSession } from '../../lib/auth'
import { startNfcScan, nfcSupported } from '../../lib/nfc'
import { loadFace, detectFace, bestMatch } from '../../lib/face'
import Login from '../../components/Login'
import { Brand, Tabs, Avatar, StatusBadge, Spinner, Empty } from '../../components/ui'
import { QRScanner, useCamera } from '../../components/Media'

const MODES = [
  { id: 'cedula', label: 'Cédula', icon: IdCard },
  { id: 'qr', label: 'QR', icon: QrCode },
  { id: 'nfc', label: 'NFC', icon: Nfc },
  { id: 'face', label: 'Facial', icon: ScanFace }
]

let chime
function sound(ok) {
  try {
    chime ??= new (window.AudioContext || window.webkitAudioContext)()
    const o = chime.createOscillator(), g = chime.createGain()
    o.frequency.value = ok ? 1046 : 220; o.type = ok ? 'sine' : 'square'
    o.connect(g); g.connect(chime.destination); g.gain.setValueAtTime(0.2, chime.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, chime.currentTime + 0.35); o.start(); o.stop(chime.currentTime + 0.35)
  } catch { /* sin audio */ }
}

export default function CheckApp() {
  const [me, setMe] = useState(() => getSession('check'))
  const [mode, setMode] = useState('cedula')
  const [result, setResult] = useState(null)
  const [recent, setRecent] = useState([])
  const busy = useRef(false)

  const loadRecent = () => q(supabase.from('attendance').select('*, members(full_name, photo)').order('created_at', { ascending: false }).limit(12)).then(setRecent).catch(() => {})
  useEffect(() => { if (me) loadRecent() }, [me])

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
      if (!m) { sound(false); setResult({ ok: false, title: 'No registrado', msg: 'No se encontró ningún cliente con ese dato.' }); return }
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
    } catch (e) {
      setResult({ ok: false, title: 'Error', msg: e.message })
    } finally {
      setTimeout(() => { busy.current = false }, 1500)
    }
  }

  useEffect(() => {
    if (!result) return
    const t = setTimeout(() => setResult(null), 6000)
    return () => clearTimeout(t)
  }, [result])

  if (!me) return <Login scope="check" onLogin={(u) => { setSession('check', u); setMe(u) }} />

  return (
    <div className="kiosk">
      <div style={{ padding: '20px 22px 40px' }}>
        <div className="row between wrap mb">
          <Brand sub="CONTROL DE ACCESO" />
          <div className="row"><span className="small muted">{me.full_name}</span><button className="icon-btn" onClick={() => { clearSession('check'); setMe(null) }}><LogOut size={18} /></button></div>
        </div>
        <Tabs tabs={MODES} value={mode} onChange={setMode} />
        <div className="mt">
          {mode === 'cedula' && <CedulaPad onSubmit={(c) => checkIn({ cedula: c }, 'cedula')} />}
          {mode === 'qr' && <div className="card"><h3>Escanea el código QR del cliente</h3><QRScanner onScan={(t) => checkIn({ qr: t }, 'qr')} /></div>}
          {mode === 'nfc' && <NfcReader onRead={(r) => checkIn({ nfc: r.serial, texts: r.texts }, 'nfc')} />}
          {mode === 'face' && <FaceCheck onMatch={(id) => checkIn({ id }, 'face')} paused={!!result} />}
        </div>
      </div>
      <aside style={{ background: '#0b0b0b', borderLeft: '1px solid var(--line)', padding: 22 }}>
        {result ? (
          <div className={`result ${result.ok ? 'ok' : 'bad'}`}>
            {result.ok ? <CheckCircle2 size={56} className="ok" /> : <XCircle size={56} className="bad" />}
            <h2 className="display" style={{ fontSize: '2.6rem', margin: '8px 0' }}>{result.title}</h2>
            {result.m && <>
              <div style={{ display: 'grid', placeItems: 'center' }}><Avatar lg src={result.m.photo} name={result.m.full_name} /></div>
              <div style={{ fontWeight: 800, fontSize: '1.3rem', marginTop: 10 }}>{result.m.full_name}</div>
              <div className="muted small">C.I. {result.m.cedula} · {result.m.plan_name || 'Sin plan'}</div>
              <div className="mt"><StatusBadge status={result.m.status} days={result.m.days_left} /></div>
              {result.m.status !== 'sin_plan' && <div className="display y" style={{ fontSize: '4rem', lineHeight: 1, marginTop: 10 }}>{result.m.days_left}<span className="small muted" style={{ fontFamily: 'var(--font)' }}> días</span></div>}
            </>}
            <p>{result.msg}</p>
          </div>
        ) : (
          <div className="empty" style={{ padding: 40 }}><ScanFace size={42} className="y" /><p>Esperando check-in…</p></div>
        )}
        <h3 className="mt2">Últimos ingresos</h3>
        <div className="col" style={{ gap: 8 }}>
          {recent.map((r) => (
            <div key={r.id} className="row">
              <Avatar src={r.members?.photo} name={r.members?.full_name} />
              <div className="grow"><div className="small" style={{ fontWeight: 700 }}>{r.members?.full_name}</div>
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
  const press = (k) => setV((x) => (k === 'del' ? x.slice(0, -1) : (x + k).slice(0, 15)))
  const go = () => { if (v) { onSubmit(v); setV('') } }
  return (
    <div className="card" style={{ maxWidth: 460, margin: '0 auto' }}>
      <h3>Ingresa tu número de cédula</h3>
      <input className="input display" style={{ fontSize: '2.4rem', textAlign: 'center', letterSpacing: '.1em' }} value={v} inputMode="numeric" autoFocus
        onChange={(e) => setV(e.target.value.replace(/[^\dA-Za-z-]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <div className="grid g3 mt">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
          <button key={k} className={`btn lg ${k === 'ok' ? 'primary' : ''}`} style={{ fontSize: '1.5rem', padding: 18 }} onClick={() => (k === 'ok' ? go() : press(k))}>
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
  const stopRef = useRef(null)

  const stop = () => { stopRef.current?.(); stopRef.current = null; setOn(false); setLeft(0) }
  const start = async () => {
    setErr('')
    try {
      stopRef.current = await startNfcScan({
        ms: 5000,
        onRead: (r) => { onRead(r); stop() },
        onError: setErr,
        onEnd: () => { setOn(false); setLeft(0) }
      })
      setOn(true); setLeft(5)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000)
    return () => clearInterval(t)
  }, [on])
  useEffect(() => () => stopRef.current?.(), [])

  return (
    <div className="card center" style={{ maxWidth: 520, margin: '0 auto' }}>
      <h3>Lectura de tag NFC</h3>
      <div className={`nfc-pulse ${on ? 'on' : ''}`}><Nfc size={54} /></div>
      <p className="display" style={{ fontSize: '1.8rem', margin: '14px 0 6px' }}>{on ? `LEYENDO… ${left}s` : 'LECTOR APAGADO'}</p>
      <button className={`btn lg ${on ? 'danger' : 'primary'}`} onClick={on ? stop : start} disabled={!nfcSupported()}>
        <Power size={20} /> {on ? 'Apagar' : 'Encender (5 s)'}
      </button>
      {!nfcSupported() && <p className="tiny warn mt">Web NFC requiere Chrome en Android. Alternativa: lector NFC USB abajo.</p>}
      {err && <div className="badge bad mt">{err}</div>}
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
  const { ref, err, ready } = useCamera(true)
  const [members, setMembers] = useState(null)
  const [hint, setHint] = useState('Cargando reconocimiento facial…')
  const [modelOk, setModelOk] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    loadFace().then(() => setModelOk(true))
    q(supabase.from('members').select('id, full_name, face_descriptors').not('face_descriptors', 'is', null).eq('active', true)).then(setMembers)
  }, [])

  useEffect(() => {
    if (!ready || !modelOk || !members) return
    if (!members.length) { setHint('No hay rostros registrados todavía'); return }
    let stop = false
    let streak = { id: null, n: 0 }
    const loop = async () => {
      while (!stop) {
        if (pausedRef.current) { await new Promise((r) => setTimeout(r, 400)); streak = { id: null, n: 0 }; continue }
        const det = await detectFace(ref.current, 0.7).catch(() => null)
        if (!det) { setHint('Mira a la cámara'); streak = { id: null, n: 0 } }
        else if (det.detection.box.width < (ref.current.videoWidth || 640) * 0.18) setHint('Acércate un poco')
        else {
          const r = bestMatch(det.descriptor, members)
          if (r.match) {
            streak = streak.id === r.match.id ? { id: r.match.id, n: streak.n + 1 } : { id: r.match.id, n: 1 }
            setHint(`Verificando… ${Math.min(100, streak.n * 34)}%`)
            if (streak.n >= 3) { onMatch(r.match.id); streak = { id: null, n: 0 }; await new Promise((x) => setTimeout(x, 3000)) }
          } else {
            streak = { id: null, n: 0 }
            setHint(r.ambiguous ? 'Coincidencia ambigua, mira de frente' : 'Rostro no reconocido')
          }
        }
        await new Promise((x) => setTimeout(x, 120))
      }
    }
    setHint('Mira a la cámara')
    loop()
    return () => { stop = true }
  }, [ready, modelOk, members])

  return (
    <div className="card">
      <div className="cam" style={{ maxWidth: 720, margin: '0 auto' }}>
        <video ref={ref} playsInline muted />
        <div className="oval" />
        <div className="hint">{err || (!modelOk ? <><Spinner size={14} /> Cargando IA…</> : hint)}</div>
      </div>
      <p className="tiny muted center mt">{members ? `${members.length} rostros registrados` : '…'} · Umbral estricto 0.45 + 3 confirmaciones consecutivas</p>
      {members && !members.length && <Empty>Registra rostros desde el formulario de inscripción en /admin</Empty>}
    </div>
  )
}
