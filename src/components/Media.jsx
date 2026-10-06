import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Download, ScanFace, SwitchCamera, Watch, Bluetooth, HeartPulse, Camera, Radar, Plus, X } from 'lucide-react'
import { detectFace, faceQuality, loadFace, snapshot, drawBox, faceBackend } from '../lib/face'
import { listenRemoteButton, listRemotes, saveRemote, removeRemote, keyLabel } from '../lib/remote'
import { onWatch, pairWatch, watchState, bleSupported, reconnectWatch, checkBle, openBleSettings, scanDevices, connectToDevice, bondedDevices, isNativeApp, savedDevices, removeDevice } from '../lib/watch'
import { Modal, Spinner, useToast } from './ui'

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

const KIND = {
  selfie: { label: 'Botón de selfie', icon: Camera, desc: 'Control remoto de cámara (sube el volumen al presionarlo).' },
  rastreador: { label: 'Botón rastreador', icon: Radar, desc: 'Llavero tipo iTag / localizador Bluetooth con botón.' },
  pulsera: { label: 'Pulsera o reloj', icon: Watch, desc: 'Xiaomi Smart Band, Amazfit, Galaxy, Polar…: pulso en vivo y controles de música.' }
}

/** Panel "Mis dispositivos": botones de selfie, rastreadores y pulseras agregados. */
export function WatchPanel({ compact }) {
  const s = useWatch()
  const [add, setAdd] = useState(false)
  const [remotes, setRemotes] = useState(listRemotes())
  const [, force] = useState(0)
  const ble = savedDevices()
  const modal = add && <AddDevice onClose={() => { setAdd(false); setRemotes(listRemotes()); force((x) => x + 1) }} />

  if (compact) {
    const count = ble.length + remotes.length
    return <>
      {s.connected || remotes.length
        ? <button className="btn sm" onClick={() => setAdd(true)}><Bluetooth size={14} className="ok" /> {count} disp.{s.hr ? ` · ${s.hr} lpm` : ''}</button>
        : <button className="btn sm" onClick={() => setAdd(true)} disabled={!bleSupported() && !isNativeApp()}><Bluetooth size={14} /> Agregar botón</button>}
      {modal}
    </>
  }

  return (
    <div className="card">
      <div className="row between">
        <div className="row"><Bluetooth className="y" /><h3 style={{ margin: 0 }}>Mis dispositivos</h3></div>
        <button className="btn sm primary" onClick={() => setAdd(true)}><Plus size={14} /> Agregar</button>
      </div>
      <p className="small muted">Detén el contador presionando un botón de selfie, un rastreador o tu pulsera, sin tocar el teléfono.</p>
      <div className="col" style={{ gap: 8 }}>
        {remotes.map((r) => (
          <div key={r.descriptor || r.name} className="row device-row">
            <div className="ex-img" style={{ width: 38, height: 38 }}><Camera size={18} /></div>
            <div className="grow"><b className="small">{r.name || 'Botón de selfie'}</b><div className="tiny muted">Botón de selfie · {keyLabel(r.key)}</div></div>
            <span className="badge ok">Listo</span>
            <button className="icon-btn" title="Quitar" onClick={() => setRemotes(removeRemote(r.descriptor || r.name))}><X size={16} /></button>
          </div>
        ))}
        {ble.map((d) => {
          const st = s.devices?.[d.deviceId]
          const K = KIND[d.kind] || KIND.rastreador
          return (
            <div key={d.deviceId} className="row device-row">
              <div className="ex-img" style={{ width: 38, height: 38 }}><K.icon size={18} /></div>
              <div className="grow"><b className="small">{d.name}</b><div className="tiny muted">{K.label}{st?.hr ? ` · ❤️ ${st.hr} lpm` : ''}</div></div>
              <span className={`badge ${st?.connected ? 'ok' : ''}`}>{st?.connected ? 'Conectado' : 'Desconectado'}</span>
              <button className="icon-btn" title="Quitar" onClick={async () => { await removeDevice(d.deviceId); force((x) => x + 1) }}><X size={16} /></button>
            </div>
          )
        })}
        {!remotes.length && !ble.length && <p className="tiny muted center" style={{ margin: 6 }}>Aún no has agregado dispositivos.</p>}
      </div>
      {ble.length > 0 && !s.connected && <button className="btn sm mt" onClick={() => reconnectWatch().then(() => force((x) => x + 1))}><Bluetooth size={14} /> Reconectar</button>}
      <ButtonTester />
      {modal}
    </div>
  )
}

/** Probador: muestra si la app recibe el botón y de qué dispositivo viene. */
function ButtonTester() {
  const [on, setOn] = useState(false)
  const [hits, setHits] = useState([])
  useEffect(() => {
    if (!on) return
    const off = listenRemoteButton((src, info) => setHits((h) => [{ src, info, t: new Date() }, ...h].slice(0, 4)))
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
      {hits.map((h, i) => <div key={i} className="tiny ok">✔ {h.info?.device || h.src}{h.info?.key ? ` · ${keyLabel(h.info.key)}` : ''} · {h.t.toLocaleTimeString('es')}</div>)}
    </div>
  )
}

/** Asistente para agregar un dispositivo según su tipo. */
function AddDevice({ onClose }) {
  const [kind, setKind] = useState(null)
  return (
    <Modal title={kind ? `Agregar ${KIND[kind].label.toLowerCase()}` : 'Agregar dispositivo'} onClose={onClose}>
      {!kind && (
        <div className="col">
          {Object.entries(KIND).map(([k, v]) => (
            <button key={k} className="ex" style={{ textAlign: 'left', width: '100%' }} onClick={() => setKind(k)}>
              <div className="ex-img"><v.icon size={22} /></div>
              <div className="grow"><b>{v.label}</b><div className="tiny muted">{v.desc}</div></div>
            </button>
          ))}
          {!isNativeApp() && <p className="tiny warn">En el navegador sólo funcionan los controles que actúan como teclado y los dispositivos BLE compatibles con Chrome. Para todo, usa la app Android.</p>}
        </div>
      )}
      {kind === 'selfie' && <SelfieFlow onDone={onClose} />}
      {kind === 'rastreador' && <BleScanner kind="rastreador" onDone={onClose} />}
      {kind === 'pulsera' && <BleScanner kind="pulsera" onDone={onClose} />}
      {kind && <button className="btn ghost block mt" onClick={() => setKind(null)}>← Elegir otro tipo</button>}
    </Modal>
  )
}

/**
 * Botón de selfie: se empareja en Ajustes de Bluetooth (funciona como teclado y envía "subir volumen")
 * y la app lo agrega al detectar la pulsación, identificándolo por su nombre.
 */
function SelfieFlow({ onDone }) {
  const toast = useToast()
  const [bonded, setBonded] = useState([])
  const [hit, setHit] = useState(null)
  useEffect(() => { bondedDevices().then((r) => setBonded(r || [])) }, [])
  useEffect(() => {
    const off = listenRemoteButton((src, info) => { if (src !== 'ble') setHit({ ...info, src }) })
    return off
  }, [])
  const addIt = () => {
    saveRemote({ name: hit.device || 'Botón de selfie', key: hit.key, descriptor: hit.descriptor || hit.device || hit.key })
    toast(`Agregado: ${hit.device || 'botón de selfie'}`, 'success'); onDone()
  }
  const selfies = (bonded || []).filter((b) => /shutter|selfie|remote|camera|bt/i.test(b.name || ''))
  return (
    <div className="col">
      <div className="step"><span className="step-n">1</span><div className="grow">
        <b className="small">Emparéjalo en el teléfono</b>
        <div className="tiny muted">Enciéndelo (suele titilar una luz azul) y en <b>Ajustes → Bluetooth</b> toca su nombre (por ejemplo "AB Shutter3"). No necesita contraseña.</div>
        {isNativeApp() && <button className="btn sm mt" onClick={() => openBleSettings('bluetooth')}>Abrir ajustes de Bluetooth</button>}
        {selfies.length > 0 && <div className="tiny ok mt">✔ Emparejado: {selfies.map((b) => b.name).join(', ')}</div>}
      </div></div>
      <div className={`step ${hit ? 'done' : 'active'}`}><span className="step-n">2</span><div className="grow">
        <b className="small">Presiona el botón ahora</b>
        {!hit
          ? <div className="tiny muted"><Spinner size={12} /> Esperando la pulsación… (la app captura "subir volumen" para que no cambie el volumen)</div>
          : <div className="small ok">✔ Detectado: <b>{hit.device || 'control Bluetooth'}</b> · {keyLabel(hit.key)}</div>}
      </div></div>
      <button className="btn primary block" disabled={!hit} onClick={addIt}><Plus size={16} /> Agregar este botón</button>
      {!isNativeApp() && <p className="tiny muted">En el navegador el volumen no llega a la web: si tu botón sólo sube el volumen, usa la app Android.</p>}
    </div>
  )
}

/** Buscador BLE de la app (rastreadores y pulseras): lista en vivo, resalta el que se presiona y conecta. */
function BleScanner({ kind, onDone }) {
  const toast = useToast()
  const [check, setCheck] = useState(null)
  const [list, setList] = useState([])
  const [scanning, setScanning] = useState(false)
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(null)
  const [connected, setConnected] = useState(null)
  const [presses, setPresses] = useState(0)
  const [now, setNow] = useState(Date.now())
  const stopRef = useRef(null)
  const add = (t) => setLog((l) => [...l, t])

  const start = async () => {
    setLog([]); setList([])
    if (!isNativeApp()) {
      // Navegador: selector de Web Bluetooth
      try { const d = await pairWatch(add); setConnected(d) } catch (e) { add('❌ ' + (e.message || 'Cancelado')) }
      return
    }
    const c = await checkBle()
    setCheck(c)
    if (!c.ok) return
    try {
      setScanning(true)
      stopRef.current = await scanDevices(setList, 25000)
      setTimeout(() => setScanning(false), 25000)
    } catch (e) { setScanning(false); add('⚠️ No se pudo buscar: ' + (e.message || e)) }
  }
  useEffect(() => { start(); return () => stopRef.current?.() }, [])
  useEffect(() => onWatch('button', () => setPresses((n) => n + 1)), [])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [])

  const connect = async (d) => {
    stopRef.current?.(); setScanning(false)
    setBusy(d.device.deviceId); setLog([]); setPresses(0)
    try {
      await connectToDevice({ ...d.device, name: d.name || d.device.name || KIND[kind].label }, add, kind)
      setConnected(d)
      toast('Dispositivo agregado', 'success')
    } catch (e) { add('❌ ' + (e.message || 'No se pudo conectar')) } finally { setBusy(null) }
  }
  const bars = (rssi) => (rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1)
  // Pulseras primero si se busca pulsera; rastreadores primero si se busca rastreador
  const sorted = [...list].sort((a, b) => ((now - b.activeAt < 4000) - (now - a.activeAt < 4000)) || ((b.kind === kind) - (a.kind === kind)) || b.rssi - a.rssi)

  return (
    <div className="col">
      {kind === 'rastreador' && <div className="tiny muted">Presiona el botón del rastreador mientras busca: el que se active aparecerá arriba marcado como <b className="y">¡Presionado!</b>. Si lo usabas con otra app (iTag, Tile…), desvincúlalo allí primero.</div>}
      {kind === 'pulsera' && (
        <div className="card" style={{ background: 'var(--bg2)', padding: 12 }}>
          <b className="small">Xiaomi Smart Band 9 Active y similares</b>
          <ol className="tiny muted" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
            <li>En la pulsera o en la app <b>Mi Fitness</b>, activa <b>"Compartir frecuencia cardíaca"</b> (Heart rate broadcast / data sharing).</li>
            <li>Inicia un entrenamiento en la pulsera si no aparece: muchas sólo transmiten el pulso durante un ejercicio.</li>
            <li>Toca la pulsera en la lista. La app leerá tu pulso en vivo.</li>
            <li>Para detener el contador desde la pulsera usa su <b>control de música</b> (Pausa/Play/Siguiente). La pantalla de "cámara remota" de la pulsera sólo funciona con la app de cámara.</li>
          </ol>
        </div>
      )}
      {check && !check.ok && (
        <div className="card hl">
          <b className="small">{check.msg}</b>
          <div className="row wrap mt" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={() => openBleSettings(check.problem)}>Abrir ajustes</button>
            <button className="btn sm" onClick={start}>Reintentar</button>
          </div>
        </div>
      )}
      {isNativeApp() && !connected && (
        <>
          <div className="row between">
            <span className="small muted">{scanning ? <><Spinner size={12} /> Buscando…</> : `${list.length} encontrados`}</span>
            <button className="btn sm" onClick={start} disabled={scanning}>Buscar de nuevo</button>
          </div>
          <div className="col" style={{ gap: 6, maxHeight: '36vh', overflowY: 'auto' }}>
            {sorted.map((d) => {
              const active = now - d.activeAt < 4000
              return (
                <button key={d.device.deviceId} className={`ex ${active ? 'pulse-on' : ''}`} style={{ textAlign: 'left', width: '100%' }} disabled={!!busy} onClick={() => connect(d)}>
                  <div className="ex-img" style={{ width: 40, height: 40 }}>{d.kind === 'pulsera' ? <Watch size={18} /> : d.kind === 'rastreador' ? <Radar size={18} /> : <Bluetooth size={18} />}</div>
                  <div className="grow">
                    <div style={{ fontWeight: 700 }}>{d.name || 'Sin nombre'} {active && <span className="badge y">¡Presionado!</span>}</div>
                    <div className="tiny muted">{d.kind ? KIND[d.kind].label + ' · ' : ''}{d.device.deviceId}</div>
                  </div>
                  <span className="tiny muted">{'▮'.repeat(bars(d.rssi))}{'▯'.repeat(4 - bars(d.rssi))}</span>
                  {busy === d.device.deviceId && <Spinner size={16} />}
                </button>
              )
            })}
            {!list.length && check?.ok && !scanning && <p className="tiny muted center">No se encontró nada. Acércalo, presiona su botón y busca de nuevo.</p>}
          </div>
        </>
      )}
      {log.length > 0 && (
        <div className="card" style={{ background: 'var(--bg2)', padding: 12 }}>
          {log.map((l, i) => <div key={i} className="tiny" style={{ padding: '2px 0' }}>{l}</div>)}
          {connected && kind === 'rastreador' && <div className={`small mt ${presses ? 'ok' : 'muted'}`}>{presses ? `✔ Botón detectado ${presses} ${presses === 1 ? 'vez' : 'veces'}` : 'Presiona el botón del rastreador para confirmar…'}</div>}
          {connected && kind === 'pulsera' && <HrLive />}
        </div>
      )}
      {connected && <button className="btn primary block" onClick={onDone}><CheckCircle2 size={16} /> Listo</button>}
    </div>
  )
}

function HrLive() {
  const s = useWatch()
  return <div className={`small mt ${s.hr ? 'ok' : 'muted'}`}>{s.hr ? <span className="hr-live"><HeartPulse size={14} /> {s.hr} lpm en vivo</span> : 'Esperando pulso… activa "Compartir frecuencia cardíaca" en la pulsera.'}</div>
}
