import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Download, ScanFace, Watch, Bluetooth, BluetoothOff, HeartPulse, Battery } from 'lucide-react'
import { detectFace, faceQuality, loadFace, snapshot } from '../lib/face'
import { onWatch, pairWatch, unpairWatch, watchState, bleSupported, savedWatch, reconnectWatch } from '../lib/watch'
import { Spinner, useToast } from './ui'

// ---------- Cámara ----------
export function useCamera(active = true, facingMode = 'user') {
  const ref = useRef(null)
  const [err, setErr] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!active) return
    let stream
    let cancelled = false
    navigator.mediaDevices?.getUserMedia({ video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return }
        stream = s
        if (ref.current) { ref.current.srcObject = s; ref.current.onloadedmetadata = () => { ref.current.play(); setReady(true) } }
      })
      .catch(() => setErr('No se pudo acceder a la cámara. Revisa los permisos.'))
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); setReady(false) }
  }, [active, facingMode])
  return { ref, err, ready }
}

/**
 * Enrolamiento facial para el formulario de inscripción:
 * toma 5 muestras de alta calidad (frontal, buena luz, tamaño adecuado).
 */
export function FaceEnroll({ onDone, samples = 5 }) {
  const { ref, err, ready } = useCamera(true)
  const [models, setModels] = useState(false)
  const [hint, setHint] = useState('Cargando modelos de IA…')
  const [got, setGot] = useState([])
  const [running, setRunning] = useState(false)
  const photoRef = useRef(null)

  useEffect(() => { loadFace().then(() => { setModels(true); setHint('Coloca tu rostro dentro del óvalo') }) }, [])

  useEffect(() => {
    if (!running || !ready || !models) return
    let stop = false
    const collected = []
    const loop = async () => {
      while (!stop && collected.length < samples) {
        const det = await detectFace(ref.current, 0.5)
        const q = faceQuality(det, ref.current)
        setHint(q.msg)
        if (q.ok) {
          const d = Array.from(det.descriptor).map((v) => +v.toFixed(5))
          // evita muestras casi idénticas: exige pequeña variación entre capturas
          const dup = collected.some((c) => c.reduce((s, v, i) => s + (v - d[i]) ** 2, 0) < 0.002)
          if (!dup) {
            collected.push(d)
            if (!photoRef.current) photoRef.current = snapshot(ref.current)
            setGot([...collected])
            setHint(`Muestra ${collected.length}/${samples} — gira levemente la cabeza`)
            await new Promise((r) => setTimeout(r, 450))
          }
        }
        await new Promise((r) => setTimeout(r, 80))
      }
      if (!stop) {
        setRunning(false)
        setHint('¡Rostro registrado!')
        onDone({ descriptors: collected, photo: photoRef.current })
      }
    }
    loop()
    return () => { stop = true }
  }, [running, ready, models])

  return (
    <div className="col">
      <div className="cam">
        <video ref={ref} playsInline muted />
        <div className="oval" />
        <div className="hint">{err || hint}</div>
      </div>
      <div className="progress"><div style={{ width: `${(got.length / samples) * 100}%` }} /></div>
      <button type="button" className="btn primary block" disabled={!models || !ready || running} onClick={() => { setGot([]); photoRef.current = null; setRunning(true) }}>
        {!models ? <><Spinner /> Cargando IA</> : running ? <><Spinner /> Capturando…</> : got.length === samples ? <><CheckCircle2 size={18} /> Volver a capturar</> : <><ScanFace size={18} /> Iniciar captura facial</>}
      </button>
    </div>
  )
}

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
        <div className="row"><Watch className="y" /><h3 style={{ margin: 0 }}>Smartwatch</h3></div>
        {s.connected ? <span className="badge ok">Conectado</span> : <span className="badge">Desconectado</span>}
      </div>
      <p className="small muted">Vincula tu reloj o banda por Bluetooth para ver tu frecuencia cardiaca en vivo y usar sus botones (Pausa / Play / Siguiente) para detener el contador o completar la serie.</p>
      {s.connected && (
        <div className="row wrap mb">
          <span className="badge y">{s.device?.name || 'Dispositivo'}</span>
          {s.hr && <span className="hr-live"><HeartPulse size={16} /> {s.hr} lpm</span>}
          {s.battery != null && <span className="badge"><Battery size={12} /> {s.battery}%</span>}
        </div>
      )}
      {!bleSupported() && <p className="tiny warn">Bluetooth no disponible en este navegador: usa la app nativa Android o Chrome.</p>}
      <div className="row wrap">
        <button className="btn primary" onClick={pair} disabled={busy || !bleSupported()}>{busy ? <Spinner /> : <Bluetooth size={16} />} {s.connected || saved ? 'Vincular otro' : 'Vincular smartwatch'}</button>
        {(s.connected || saved) && <button className="btn ghost" onClick={unpairWatch}><BluetoothOff size={16} /> Desvincular</button>}
      </div>
    </div>
  )
}
