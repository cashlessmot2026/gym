// Vinculación de smartwatch / banda por Bluetooth LE.
// - App nativa (Capacitor) y PWA usan el mismo plugin @capacitor-community/bluetooth-le
//   (en web recurre a Web Bluetooth).
// - Frecuencia cardiaca: servicio estándar Heart Rate (0x180D / 0x2A37), compatible
//   con Polar, Garmin (modo broadcast), Amazfit, Xiaomi Band, Coros, Wahoo, etc.
// - Botón del reloj para detener el contador:
//   1) Cualquier característica "notify" propia del dispositivo (botones BLE, relojes
//      con app personalizada) se interpreta como pulsación.
//   2) Controles multimedia: la app publica una sesión de audio silenciosa; los botones
//      Play/Pausa/Siguiente del reloj (Wear OS, Galaxy Watch, Apple Watch "Ahora suena")
//      pausan/reanudan el contador o completan la serie.
import { BleClient, numberToUUID } from '@capacitor-community/bluetooth-le'

const HR_SERVICE = numberToUUID(0x180d)
const HR_MEASUREMENT = numberToUUID(0x2a37)
const BATTERY_SERVICE = numberToUUID(0x180f)
const BATTERY_LEVEL = numberToUUID(0x2a19)
const IGNORE = [HR_MEASUREMENT, BATTERY_LEVEL, numberToUUID(0x2a05)]
const STORE = 'iy_watch'

const listeners = { hr: new Set(), button: new Set(), status: new Set(), battery: new Set() }
const emit = (ev, v) => listeners[ev].forEach((fn) => { try { fn(v) } catch { /* listener */ } })

export const watchState = { device: null, connected: false, hr: null, battery: null, hrSamples: [] }

export function onWatch(ev, fn) {
  listeners[ev].add(fn)
  return () => listeners[ev].delete(fn)
}

export const bleSupported = () =>
  !!(window.Capacitor?.isNativePlatform?.() || navigator.bluetooth)

let initialized = false
async function init() {
  if (!initialized) { await BleClient.initialize({ androidNeverForLocation: true }); initialized = true }
}

let lastPress = 0
function press(source) {
  const now = Date.now()
  if (now - lastPress < 900) return
  lastPress = now
  emit('button', source)
}

function parseHr(view) {
  const flags = view.getUint8(0)
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1)
}

async function subscribeAll(deviceId) {
  const services = await BleClient.getServices(deviceId)
  for (const s of services) {
    for (const c of s.characteristics) {
      if (!(c.properties.notify || c.properties.indicate)) continue
      if (c.uuid === HR_MEASUREMENT) {
        await BleClient.startNotifications(deviceId, s.uuid, c.uuid, (v) => {
          const hr = parseHr(v)
          if (hr > 0) {
            watchState.hr = hr
            watchState.hrSamples.push({ t: Date.now(), hr })
            if (watchState.hrSamples.length > 4000) watchState.hrSamples.shift()
            emit('hr', hr)
          }
        })
      } else if (c.uuid === BATTERY_LEVEL) {
        await BleClient.startNotifications(deviceId, s.uuid, c.uuid, (v) => {
          watchState.battery = v.getUint8(0); emit('battery', watchState.battery)
        }).catch(() => {})
      } else if (!IGNORE.includes(c.uuid)) {
        await BleClient.startNotifications(deviceId, s.uuid, c.uuid, () => press('ble')).catch(() => {})
      }
    }
  }
  try {
    const b = await BleClient.read(deviceId, BATTERY_SERVICE, BATTERY_LEVEL)
    watchState.battery = b.getUint8(0); emit('battery', watchState.battery)
  } catch { /* sin batería */ }
}

function setConnected(device, connected) {
  watchState.device = device
  watchState.connected = connected
  emit('status', { ...watchState })
}

/** Abre el selector de dispositivos y vincula el reloj. */
export async function pairWatch() {
  await init()
  const device = await BleClient.requestDevice({
    optionalServices: [HR_SERVICE, BATTERY_SERVICE, numberToUUID(0x1812), numberToUUID(0xfee0), numberToUUID(0xfee7)]
  })
  await connectDevice(device)
  localStorage.setItem(STORE, JSON.stringify({ deviceId: device.deviceId, name: device.name }))
  return device
}

async function connectDevice(device) {
  await BleClient.connect(device.deviceId, () => setConnected(device, false))
  setConnected(device, true)
  await subscribeAll(device.deviceId)
}

/** Reconecta al último reloj vinculado (sólo app nativa o navegadores que lo permitan). */
export async function reconnectWatch() {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null')
  if (!saved || watchState.connected) return false
  try {
    await init()
    const [device] = await BleClient.getDevices([saved.deviceId])
    if (!device) return false
    await connectDevice(device)
    return true
  } catch { return false }
}

export async function unpairWatch() {
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null')
  localStorage.removeItem(STORE)
  if (saved) await BleClient.disconnect(saved.deviceId).catch(() => {})
  setConnected(null, false)
}

export const savedWatch = () => JSON.parse(localStorage.getItem(STORE) || 'null')

export function hrStats(sinceMs) {
  const s = watchState.hrSamples.filter((x) => x.t >= sinceMs).map((x) => x.hr)
  if (!s.length) return { avg: null, max: null }
  return { avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length), max: Math.max(...s) }
}

// ---------- Controles multimedia del reloj ----------
let audio = null
function silentWav() {
  const sr = 8000, n = sr * 2
  const buf = new ArrayBuffer(44 + n)
  const v = new DataView(buf)
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  w(36, 'data'); v.setUint32(40, n, true)
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

/** Activa los controles multimedia (llamar tras un gesto del usuario). */
export async function enableMediaControls({ title, artist, onPause, onPlay, onNext }) {
  if (!('mediaSession' in navigator)) return false
  if (!audio) { audio = new Audio(silentWav()); audio.loop = true; audio.volume = 0.01 }
  try { await audio.play() } catch { return false }
  navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'IronYellow Gym' })
  navigator.mediaSession.playbackState = 'playing'
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn) } catch { /* acción no soportada */ } }
  set('pause', () => { navigator.mediaSession.playbackState = 'paused'; onPause?.() })
  set('play', () => { navigator.mediaSession.playbackState = 'playing'; onPlay?.() })
  set('stop', () => onPause?.())
  set('nexttrack', () => onNext?.())
  return true
}

export function updateMediaTitle(title, artist) {
  if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'IronYellow Gym' })
  }
}

export function disableMediaControls() {
  if (audio) { audio.pause() }
  if ('mediaSession' in navigator) {
    for (const a of ['pause', 'play', 'stop', 'nexttrack']) { try { navigator.mediaSession.setActionHandler(a, null) } catch { /* noop */ } }
    navigator.mediaSession.playbackState = 'none'
  }
}
