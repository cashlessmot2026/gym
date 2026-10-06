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
  const fire = (src) => {
    const now = Date.now()
    if (now - last < 700) return // evita dobles pulsaciones
    last = now
    onPress(src)
  }
  const offs = []

  if (isNative()) {
    RemoteButton.enable().catch(() => {})
    const h = RemoteButton.addListener('press', () => fire('bluetooth'))
    offs.push(() => { RemoteButton.disable().catch(() => {}); Promise.resolve(h).then((x) => x?.remove?.()) })
  }

  const key = (e) => {
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (WEB_KEYS.has(e.code) || WEB_KEYS.has(e.key)) { e.preventDefault(); fire('teclado') }
  }
  window.addEventListener('keydown', key)
  offs.push(() => window.removeEventListener('keydown', key))

  offs.push(onWatch('button', () => fire('ble')))
  return () => offs.forEach((f) => f())
}
