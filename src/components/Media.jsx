import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Download, ScanFace, SwitchCamera, Watch, Bluetooth, BluetoothOff, HeartPulse, Battery } from 'lucide-react'
import { detectFace, faceQuality, loadFace, snapshot, drawBox, faceBackend } from '../lib/face'
import { listenRemoteButton } from '../lib/remote'
import { onWatch, pairWatch, unpairWatch, watchState, bleSupported, savedWatch, reconnectWatch } from '../lib/watch'
import { Spinner, useToast } from './ui'

// ---------- Cámara ----------
// 640×480 basta para el reconocimiento y es mucho más rápido de procesar que HD.
export function useCamera(active = true, facingMode = 'user', width = 640, height = 480) {
  const ref = useRef(null)
  const [err, setErr] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!active) return
    let stream
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) { setErr('Este navegador no permite usar la cámara (se requiere HTTPS).'); return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: width }, height: { ideal: height } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream = s
        const v = ref.current
        if (!v) return
        v.srcObject = s
        const start = () => v.play().then(() => setReady(true)).catch(() => setReady(true))
        if (v.readyState >= 1) start(); else v.onloadedmetadata = start
      })
      .catch((e) => setErr(e?.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en el navegador.' : 'No se pudo acceder a la cámara.'))
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); setReady(false) }
  }, [active, facingMode, width, height])
  return { ref, err, ready }
}

/** Preferencia de cámara (frontal 'user' / trasera 'environment'), recordada por pantalla. */
export function useFacing(key, initial = 'user') {
  const k = `iy_cam_${key}`
  const [facing, setFacing] = useState(() => localStorage.getItem(k) || initial)
  const toggle = () => setFacing((f) => { const n = f === 'user' ? 'environment' : 'user'; localStorage.setItem(k, n); return n })
  return [facing, toggle]
}

/** Botón para alternar cámara frontal / trasera (se muestra si hay más de una cámara o es un móvil/tablet). */
export function CameraSwitch({ facing, onToggle, disabled }) {
  const [multi, setMulti] = useState(() => window.matchMedia?.('(pointer: coarse)').matches)
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((d) => {
      if (d.filter((x) => x.kind === 'videoinput').length > 1) setMulti(true)
    }).catch(() => {})
  }, [])
  if (!multi) return null
  return (
    <button type="button" className="btn sm cam-switch" onClick={onToggle} disabled={disabled} title="Cambiar cámara">
      <SwitchCamera size={16} /> {facing === 'user' ? 'Frontal' : 'Trasera'}
    </button>
  )
}

/**
 * Registro facial para el formulario de inscripción.
 * Detección continua con recuadro en vivo y captura AUTOMÁTICA de 5 muestras
 * cuando el rostro cumple la calidad (frontal, buena luz, tamaño adecuado).
 * Si en 10 s no lo logra, ofrece una captura manual con requisitos más flexibles.
 */
export function FaceEnroll({ onDone, samples = 5 }) {
  const [facing, toggleFacing] = useFacing('enroll', 'user')
  const { ref, err, ready } = useCamera(true, facing)
  const canvasRef = useRef(null)
  const [models, setModels] = useState(false)
  const [modelErr, setModelErr] = useState('')
  const [hint, setHint] = useState('Cargando reconocimiento facial…')
  const [level, setLevel] = useState(0)
  const [count, setCount] = useState(0)
  const [done, setDone] = useState(false)
  const [manual, setManual] = useState(false)
  const [round, setRound] = useState(0)
  const st = useRef({ collected: [], best: null, last: 0, lastDet: null, started: 0 })
  const [fps, setFps] = useState(0)

  useEffect(() => {
    loadFace().then(() => setModels(true)).catch(() => setModelErr('No se pudieron cargar los modelos de IA. Revisa la conexión y recarga.'))
  }, [])

  useEffect(() => {
    if (!ready || !models) return
    let stop = false
    st.current = { collected: [], best: null, last: 0, lastDet: null, started: Date.now() }
    setCount(0); setDone(false); setManual(false)
    const finish = () => {
      const s = st.current
      setDone(true); setHint('¡Rostro registrado!'); setLevel(2)
      onDone({ descriptors: s.collected, photo: s.best ? snapshot(ref.current, 320, s.best.box) : snapshot(ref.current) })
    }
    const loop = async () => {
      while (!stop) {
        const v = ref.current
        if (!v || v.readyState < 2) { await sleep(100); continue }
        const t0 = performance.now()
        const det = await detectFace(v, 0.4).catch(() => null)
        if (stop) break
        setFps((f) => Math.round((f * 0.7 + 1000 / Math.max(1, performance.now() - t0) * 0.3) * 10) / 10)
        const q = faceQuality(det, v)
        const s = st.current
        s.lastDet = det
        drawBox(canvasRef.current, v, det, q.ok ? '#22c55e' : '#FFD60A')
        setLevel(q.level)
        if (s.collected.length < samples) {
          if (q.ok && Date.now() - s.last > 300) {
            s.collected.push(Array.from(det.descriptor).map((x) => +x.toFixed(5)))
            s.last = Date.now()
            if (!s.best || det.detection.score > s.best.score) s.best = { score: det.detection.score, box: det.detection.box }
            setCount(s.collected.length)
            setHint(s.collected.length < samples ? `Capturando ${s.collected.length}/${samples}… no te muevas` : '¡Listo!')
            if (s.collected.length >= samples) { finish(); break }
          } else if (!q.ok) setHint(q.msg)
          if (!s.collected.length && Date.now() - s.started > 10000) setManual(true)
        }
        await sleep(60)
      }
    }
    setHint('Coloca tu rostro dentro del óvalo')
    loop()
    return () => { stop = true }
  }, [ready, models, round, facing])

  // Captura manual: acepta cualquier rostro detectado (útil con poca luz o cámaras de baja calidad)
  const captureManual = async () => {
    const v = ref.current
    const list = []
    let best = null
    for (let i = 0; i < 12 && list.length < 3; i++) {
      const det = await detectFace(v, 0.3).catch(() => null)
      if (det) {
        list.push(Array.from(det.descriptor).map((x) => +x.toFixed(5)))
        if (!best || det.detection.score > best.score) best = { score: det.detection.score, box: det.detection.box }
      }
      await sleep(150)
    }
    if (!list.length) { setHint('No se detecta ningún rostro. Acércate y busca más luz.'); return }
    const merged = [...st.current.collected, ...list]
    st.current.collected = merged
    setCount(Math.min(samples, merged.length)); setDone(true); setHint('¡Rostro registrado!')
    onDone({ descriptors: merged, photo: snapshot(v, 320, best.box) })
  }

  const loadingStage = modelErr || err || (!ready ? 'Abriendo cámara…' : !models ? 'Cargando reconocimiento facial…' : null)
  return (
    <div className="col">
      <div className={`cam face-cam lvl-${done ? 2 : level} ${facing === 'environment' ? 'rear' : ''}`}>
        <video ref={ref} playsInline muted autoPlay />
        <canvas ref={canvasRef} />
        <div className="oval" />
        {loadingStage && <div className="cam-loading">{!(modelErr || err) && <Spinner size={28} />}<span>{loadingStage}</span></div>}
        {!loadingStage && <div className="hint">{hint}</div>}
        <div className="cam-tools"><CameraSwitch facing={facing} onToggle={toggleFacing} /></div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {Array.from({ length: samples }).map((_, i) => <div key={i} className="grow" style={{ height: 8, borderRadius: 6, background: i < count ? 'var(--ok)' : 'var(--card2)', transition: '.2s' }} />)}
      </div>
      <p className="tiny muted center" style={{ margin: 0 }}>Mira de frente, con buena luz y sin gorra ni lentes oscuros. La captura es automática.</p>
      {models && <p className="tiny muted center" style={{ margin: 0, opacity: 0.6 }}>Motor IA: {faceBackend().toUpperCase()} · {fps ? `${fps} detecciones/s` : 'iniciando…'}</p>}
      <div className="row">
        {manual && !done && <button type="button" className="btn grow" onClick={captureManual}><ScanFace size={16} /> Capturar ahora</button>}
        {done && <button type="button" className="btn grow" onClick={() => setRound((r) => r + 1)}><CheckCircle2 size={16} /> Repetir captura</button>}
      </div>
    </div>
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- Escáner QR ----------
export function QRScanner({ onScan, active = true }) {
  const id = useRef('qr-' + Math.random().toString(36).slice(2)).current
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!active) return
    let scanner
    let last = 0
    let mounted = true
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (!mounted) return
      scanner = new Html5Qrcode(id, { verbose: false })
      scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text) => {
        if (Date.now() - last > 3000) { last = Date.now(); onScan(text) }
      }, () => {}).catch(() => setErr('No se pudo abrir la cámara para escanear'))
    })
    return () => { mounted = false; scanner?.isScanning && scanner.stop().catch(() => {}) }
  }, [active])
  return (
    <div>
      <div id={id} style={{ borderRadius: 16, overflow: 'hidden', background: '#000', minHeight: 260 }} />
      {err && <div className="badge bad mt">{err}</div>}
    </div>
  )
}

// ---------- Código QR ----------
export function QRImage({ value, size = 220, name, download = true }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (value) QRCode.toDataURL(value, { width: size * 2, margin: 1, color: { dark: '#000000', light: '#ffffff' }, errorCorrectionLevel: 'H' }).then(setUrl)
  }, [value, size])
  if (!url) return null
  const save = () => {
    // Tarjeta de socio: QR + nombre + código, lista para imprimir o enviar
    const c = document.createElement('canvas'); c.width = 600; c.height = 820
    const g = c.getContext('2d')
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, 600, 820)
    g.fillStyle = '#FFD60A'; g.fillRect(0, 0, 600, 110)
    g.fillStyle = '#000'; g.font = 'bold 54px Bebas Neue, Arial'; g.textAlign = 'center'; g.fillText('IRONYELLOW GYM', 300, 75)
    const img = new Image()
    img.onload = () => {
      g.fillStyle = '#fff'; g.fillRect(70, 150, 460, 460); g.drawImage(img, 80, 160, 440, 440)
      g.fillStyle = '#fff'; g.font = 'bold 34px Inter, Arial'; g.fillText(name || '', 300, 680)
      g.fillStyle = '#FFD60A'; g.font = 'bold 30px monospace'; g.fillText(value, 300, 735)
      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `QR_${(name || value).replace(/\s+/g, '_')}.png`; a.click()
    }
    img.src = url
  }
  return (
    <div className="qr-card">
      <img src={url} width={size} height={size} alt={value} style={{ display: 'block', margin: '0 auto' }} />
      <div style={{ fontFamily: 'monospace', fontWeight: 800, marginTop: 6 }}>{value}</div>
      {download && <button type="button" className="btn sm mt" style={{ background: '#000', color: '#FFD60A' }} onClick={save}><Download size={14} /> Descargar tarjeta</button>}
    </div>
  )
}

// ---------- Smartwatch ----------
export function useWatch() {
  const [s, setS] = useState({ ...watchState })
  useEffect(() => {
    const u = [
      onWatch('status', () => setS({ ...watchState })),
      onWatch('hr', () => setS({ ...watchState })),
      onWatch('battery', () => setS({ ...watchState }))
    ]
    reconnectWatch()
    return () => u.forEach((f) => f())
  }, [])
  return s
}

export function WatchPanel({ compact }) {
  const toast = useToast()
  const s = useWatch()
  const [busy, setBusy] = useState(false)
  const saved = savedWatch()
  const pair = async () => {
    setBusy(true)
    try { const d = await pairWatch(); toast(`Vinculado: ${d.name || 'smartwatch'}`, 'success') } catch (e) { toast(e.message || 'No se pudo vincular', 'error') } finally { setBusy(false) }
  }
  if (compact) {
    return s.connected
      ? <span className="badge ok"><Watch size={12} /> {s.device?.name || 'Reloj'} {s.hr ? `· ${s.hr} lpm` : ''}</span>
      : <button className="btn sm" onClick={pair} disabled={busy || !bleSupported()}>{busy ? <Spinner size={14} /> : <Bluetooth size={14} />} Vincular reloj</button>
  }
  return (
    <div className="card">
      <div className="row between">
        <div className="row"><Watch className="y" /><h3 style={{ margin: 0 }}>Botón / dispositivo Bluetooth</h3></div>
        {s.connected ? <span className="badge ok">Conectado</span> : <span className="badge">Desconectado</span>}
      </div>
      <p className="small muted">Detén el contador sin tocar el teléfono con <b>cualquier dispositivo Bluetooth que tenga un botón</b>:</p>
      <ul className="small muted" style={{ paddingLeft: 18, marginTop: 0 }}>
        <li><b>Control de selfie, auriculares, teclado o pulsador:</b> emparéjalo en los ajustes de Bluetooth del teléfono. No hace falta nada más.</li>
        <li><b>Botón BLE (tipo iTag), banda o reloj con pulso:</b> vincúlalo aquí abajo. También muestra tu frecuencia cardiaca.</li>
        <li><b>Smartwatch (Wear OS, Galaxy, Apple Watch):</b> usa los controles de música del reloj. Pausa/Play pausa el contador; Siguiente completa la serie.</li>
      </ul>
      {s.connected && (
        <div className="row wrap mb">
          <span className="badge y">{s.device?.name || 'Dispositivo'}</span>
          {s.hr && <span className="hr-live"><HeartPulse size={16} /> {s.hr} lpm</span>}
          {s.battery != null && <span className="badge"><Battery size={12} /> {s.battery}%</span>}
        </div>
      )}
      {!bleSupported() && <p className="tiny warn">Bluetooth no disponible en este navegador: usa la app nativa Android o Chrome.</p>}
      <div className="row wrap">
        <button className="btn primary" onClick={pair} disabled={busy || !bleSupported()}>{busy ? <Spinner /> : <Bluetooth size={16} />} {s.connected || saved ? 'Vincular otro' : 'Vincular dispositivo BLE'}</button>
        {(s.connected || saved) && <button className="btn ghost" onClick={unpairWatch}><BluetoothOff size={16} /> Desvincular</button>}
      </div>
      <ButtonTester />
    </div>
  )
}

/** Probador: muestra si la app recibe el botón del control / reloj / dispositivo. */
function ButtonTester() {
  const [on, setOn] = useState(false)
  const [hits, setHits] = useState([])
  useEffect(() => {
    if (!on) return
    const off = listenRemoteButton((src) => setHits((h) => [{ src, t: new Date() }, ...h].slice(0, 4)))
    const t = setTimeout(() => setOn(false), 20000)
    return () => { off(); clearTimeout(t) }
  }, [on])
  return (
    <div className="mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <div className="row between wrap">
        <b className="small">Probar botón</b>
        <button type="button" className={`btn sm ${on ? 'primary' : ''}`} onClick={() => { setHits([]); setOn(!on) }}>{on ? 'Escuchando… (20 s)' : 'Iniciar prueba'}</button>
      </div>
      {on && !hits.length && <p className="tiny muted">Presiona el botón de tu dispositivo ahora.</p>}
      {hits.map((h, i) => <div key={i} className="tiny ok">✔ Botón detectado ({h.src}) · {h.t.toLocaleTimeString('es')}</div>)}
    </div>
  )
}
