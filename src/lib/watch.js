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

export const watchState = { device: null, connected: false, hr: null, battery: null, hrSamples: [], buttons: 0 }

export function onWatch(ev, fn) {
  listeners[ev].add(fn)
  return () => listeners[ev].delete(fn)
}

export const bleSupported = () =>
  !!(window.Capacitor?.isNativePlatform?.() || navigator.bluetooth)

const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.()
const isAndroid = () => window.Capacitor?.getPlatform?.() === 'android'
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))])

let initialized = false
async function init() {
  // Sin "neverForLocation": Android oculta muchos botones BLE (tipo iTag) de la búsqueda si se usa.
  if (!initialized) { await BleClient.initialize({ androidNeverForLocation: false }); initialized = true }
}

/**
 * Comprueba permisos, Bluetooth y ubicación antes de buscar. Devuelve { ok, problem }.
 * problem: 'bluetooth' | 'location' | 'permission' | null
 */
export async function checkBle() {
  try { await init() } catch (e) {
    return { ok: false, problem: 'permission', msg: 'Permite "Dispositivos cercanos" y "Ubicación" a la app para buscar dispositivos Bluetooth.' }
  }
  try {
    if (!(await BleClient.isEnabled())) {
      if (isAndroid()) { try { await BleClient.requestEnable() } catch { /* el usuario lo rechazó */ } }
      if (!(await BleClient.isEnabled())) return { ok: false, problem: 'bluetooth', msg: 'Activa el Bluetooth del teléfono.' }
    }
  } catch { /* navegador: no aplica */ }
  if (isAndroid()) {
    try {
      if (!(await BleClient.isLocationEnabled())) return { ok: false, problem: 'location', msg: 'Activa la Ubicación del teléfono: Android la exige para encontrar dispositivos Bluetooth.' }
    } catch { /* versión sin esta comprobación */ }
  }
  return { ok: true }
}

export const openBleSettings = (what) => {
  if (what === 'location') return BleClient.openLocationSettings().catch(() => {})
  if (what === 'permission') return BleClient.openAppSettings().catch(() => {})
  return BleClient.openBluetoothSettings().catch(() => {})
}

/**
 * Busca dispositivos BLE cercanos durante `ms` (app nativa). onFound(lista ordenada por señal).
 * Devuelve una función para detener la búsqueda.
 */
export async function scanDevices(onFound, ms = 15000) {
  await init()
  const found = new Map()
  await BleClient.requestLEScan({ allowDuplicates: false, scanMode: 2 }, (r) => {
    const id = r.device.deviceId
    const prev = found.get(id)
    found.set(id, { device: r.device, name: r.localName || r.device.name || prev?.name || '', rssi: r.rssi ?? prev?.rssi ?? -100, uuids: r.uuids || prev?.uuids || [] })
    onFound([...found.values()].sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0) || b.rssi - a.rssi))
  })
  const t = setTimeout(() => BleClient.stopLEScan().catch(() => {}), ms)
  return () => { clearTimeout(t); BleClient.stopLEScan().catch(() => {}) }
}

/** Dispositivos ya emparejados en Ajustes del teléfono (Android). */
export async function bondedDevices() {
  try { await init(); return await BleClient.getBondedDevices() } catch { return [] }
}

let lastPress = 0
let lastSource = ''
function press(source) {
  const now = Date.now()
  if (now - lastPress < 900) return
  lastPress = now
  lastSource = source
  emit('button', source)
}
export const lastButtonSource = () => lastSource

function parseHr(view) {
  const flags = view.getUint8(0)
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1)
}

const short = (uuid) => (/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i.exec(uuid)?.[1] || uuid.slice(0, 8)).toUpperCase()

/** Se suscribe a todo lo que notifica. Cada característica es independiente: si una falla, sigue con las demás. */
async function subscribeAll(deviceId, log = () => {}) {
  const services = await withTimeout(BleClient.getServices(deviceId), 15000, 'El dispositivo no respondió con sus servicios')
  log(`Servicios encontrados: ${services.length}`)
  let buttons = 0
  for (const s of services) {
    for (const c of s.characteristics) {
      if (!(c.properties.notify || c.properties.indicate)) continue
      try {
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
          log('Frecuencia cardiaca activada ❤️')
        } else if (c.uuid === BATTERY_LEVEL) {
          await BleClient.startNotifications(deviceId, s.uuid, c.uuid, (v) => { watchState.battery = v.getUint8(0); emit('battery', watchState.battery) })
        } else if (!IGNORE.includes(c.uuid)) {
          await BleClient.startNotifications(deviceId, s.uuid, c.uuid, () => press(`ble ${short(c.uuid)}`))
          buttons++
          log(`Escuchando botón en la característica ${short(c.uuid)}`)
        }
      } catch (e) {
        log(`⚠️ No se pudo escuchar ${short(c.uuid)}: ${e.message || e}`)
      }
    }
  }
  try {
    const b = await BleClient.read(deviceId, BATTERY_SERVICE, BATTERY_LEVEL)
    watchState.battery = b.getUint8(0); emit('battery', watchState.battery)
  } catch { /* sin batería */ }
  watchState.buttons = buttons
  return { services: services.length, buttons }
}

function setConnected(device, connected) {
  watchState.device = device
  watchState.connected = connected
  emit('status', { ...watchState })
}

/** Conecta a un dispositivo (de la búsqueda propia o del selector) mostrando cada paso en `log`. */
export async function connectToDevice(device, log = () => {}) {
  await init()
  log(`Conectando a ${device.name || device.deviceId}…`)
  try {
    await withTimeout(BleClient.connect(device.deviceId, () => setConnected(device, false)), 20000, 'Tiempo agotado al conectar. Acerca el dispositivo y presiona su botón para despertarlo.')
  } catch (e) {
    // Algunos botones exigen emparejamiento (bond) antes de conectar
    if (isAndroid()) {
      log('Reintentando con emparejamiento…')
      await BleClient.createBond(device.deviceId, { timeout: 20000 }).catch(() => {})
      await withTimeout(BleClient.connect(device.deviceId, () => setConnected(device, false)), 20000, e.message)
    } else throw e
  }
  setConnected(device, true)
  log('Conectado ✔')
  const r = await subscribeAll(device.deviceId, log)
  localStorage.setItem(STORE, JSON.stringify({ deviceId: device.deviceId, name: device.name }))
  if (!r.buttons && !watchState.hr) log('⚠️ El dispositivo no envía notificaciones de botón. Si es un control de selfie/teclado, emparéjalo en Ajustes de Bluetooth del teléfono: la app lo detecta como botón sin vincularlo aquí.')
  else log('✔ Listo: presiona el botón del dispositivo para probarlo')
  return r
}

/** Navegador / PWA: selector del navegador (Web Bluetooth). */
export async function pairWatch(log = () => {}) {
  await init()
  const device = await BleClient.requestDevice({
    optionalServices: [HR_SERVICE, BATTERY_SERVICE, numberToUUID(0xffe0), numberToUUID(0x1802), numberToUUID(0xfee0), numberToUUID(0xfee7), numberToUUID(0xfff0), numberToUUID(0x180a)]
  })
  await connectToDevice(device, log)
  return device
}

async function connectDevice(device) {
  await BleClient.connect(device.deviceId, () => setConnected(device, false))
  setConnected(device, true)
  await subscribeAll(device.deviceId)
}

/** Reconecta al último dispositivo vinculado (app nativa o navegadores que lo permitan). */
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
export { isNativeApp }


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
