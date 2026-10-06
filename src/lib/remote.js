// Botón remoto universal para el contador de ejercicios. Fuentes soportadas:
// 1. Cualquier control Bluetooth emparejado en el teléfono que actúe como teclado/HID:
//    botón disparador de selfie, auriculares (play/pausa), teclados, mandos, pedales.
//    · App Android: lo captura el plugin nativo RemoteButton (incluye teclas de volumen).
//    · Navegador/PWA: teclas Enter, Espacio, Play/Pausa, Siguiente (volumen no llega a la web).
// 2. Dispositivos BLE con característica de notificación (botones BLE, relojes con app propia):
//    ver watch.js → evento 'button'.
// 3. Reloj (Wear OS, Galaxy Watch, Apple Watch): controles de música Pausa / Play / Siguiente
//    mediante la sesión multimedia (watch.js → enableMediaControls).
import { registerPlugin } from '@capacitor/core'
import { onWatch } from './watch'

const isNative = () => !!window.Capacitor?.isNativePlatform?.()
const RemoteButton = registerPlugin('RemoteButton')

const WEB_KEYS = new Set(['Enter', 'NumpadEnter', 'Space', 'MediaPlayPause', 'MediaTrackNext', 'MediaPlay', 'MediaPause', 'AudioVolumeUp', 'AudioVolumeDown', 'Camera'])

/**
 * Escucha cualquier botón remoto. Devuelve una función para dejar de escuchar.
 * onPress(fuente) — fuente: 'bluetooth' | 'ble' | 'teclado'
 */
export function listenRemoteButton(onPress) {
  let last = 0
  const fire = (src, info = {}) => {
    const now = Date.now()
    if (now - last < 700) return // evita dobles pulsaciones
    last = now
    onPress(src, info)
  }
  const offs = []

  if (isNative()) {
    RemoteButton.enable().catch(() => {})
    const h = RemoteButton.addListener('press', (e) => fire('bluetooth', { key: e?.key, device: e?.device, descriptor: e?.descriptor }))
    offs.push(() => { RemoteButton.disable().catch(() => {}); Promise.resolve(h).then((x) => x?.remove?.()) })
  }

  const key = (e) => {
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (WEB_KEYS.has(e.code) || WEB_KEYS.has(e.key)) { e.preventDefault(); fire('teclado', { key: e.code || e.key }) }
  }
  window.addEventListener('keydown', key)
  offs.push(() => window.removeEventListener('keydown', key))

  offs.push(onWatch('button', (src) => fire('ble', { key: src })))
  return () => offs.forEach((f) => f())
}

// ---------- Botones de selfie / controles agregados por el usuario ----------
const REMOTES = 'iy_remotes'
export const listRemotes = () => { try { return JSON.parse(localStorage.getItem(REMOTES) || '[]') } catch { return [] } }
export function saveRemote(r) {
  const list = listRemotes().filter((x) => (x.descriptor || x.name) !== (r.descriptor || r.name))
  list.push({ ...r, added: new Date().toISOString() })
  localStorage.setItem(REMOTES, JSON.stringify(list))
  return list
}
export function removeRemote(id) {
  const list = listRemotes().filter((x) => (x.descriptor || x.name) !== id)
  localStorage.setItem(REMOTES, JSON.stringify(list))
  return list
}
/** Nombre legible de la tecla recibida. */
export const keyLabel = (k = '') => ({
  KEYCODE_VOLUME_UP: 'Subir volumen', KEYCODE_VOLUME_DOWN: 'Bajar volumen', KEYCODE_ENTER: 'Enter', KEYCODE_CAMERA: 'Cámara',
  KEYCODE_MEDIA_PLAY_PAUSE: 'Play/Pausa', KEYCODE_HEADSETHOOK: 'Botón de auricular', KEYCODE_MEDIA_NEXT: 'Siguiente', KEYCODE_SPACE: 'Espacio',
  AudioVolumeUp: 'Subir volumen', Enter: 'Enter', Space: 'Espacio', MediaPlayPause: 'Play/Pausa'
}[k] || k.replace('KEYCODE_', '').replace(/_/g, ' ').toLowerCase())
