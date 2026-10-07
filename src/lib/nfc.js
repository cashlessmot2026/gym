// NFC:
// - APK Android (Capacitor): plugin propio IyNfc (android/.../IyNfcPlugin.java) con "foreground dispatch":
//   mientras el lector está encendido, la app recibe el tag y el sistema NO abre la app de NFC del teléfono.
// - Chrome en Android / PWA: Web NFC (NDEFReader).
// - Escritorio: lectores NFC USB que funcionan como teclado (escriben el UID y Enter).
import { registerPlugin } from '@capacitor/core'

const IyNfc = registerPlugin('IyNfc')
const isNative = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
export const nfcSupported = () => typeof window !== 'undefined' && (isNative() || 'NDEFReader' in window)

const decodeRecords = (message) => {
  const out = []
  for (const r of message?.records || []) {
    try {
      if (r.recordType === 'text' || r.recordType === 'url') out.push(new TextDecoder(r.encoding || 'utf-8').decode(r.data))
    } catch { /* registro no legible */ }
  }
  return out
}

/** Evita que un paso nativo se quede colgado sin avisar. */
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: el teléfono no respondió en ${ms / 1000} s`)), ms))])

/** Abre los ajustes de NFC del teléfono (APK). */
export async function openNfcSettings() {
  if (isNative()) await IyNfc.openSettings()
}

async function startNative({ onRead, ms, onEnd, log = () => {} }) {
  log('Comprobando NFC…')
  const st = await withTimeout(IyNfc.status(), 4000, 'Leer el estado del NFC')
  log(`NFC: ${st.supported ? (st.enabled ? 'encendido' : 'apagado') : 'no disponible'}`)
  let stopped = false
  const handle = await withTimeout(IyNfc.addListener('tag', (e) => {
    if (stopped) return
    log(`Tag detectado ${e.serial || ''}`)
    onRead?.({ serial: e.serial || '', texts: e.texts || [] })
  }), 4000, 'Escuchar tags')
  await withTimeout(IyNfc.start(), 4000, 'Encender el lector')
  log('Lector encendido ✓ acerca un tag')
  const stop = () => {
    if (stopped) return
    stopped = true; clearTimeout(timer)
    handle.remove?.(); IyNfc.stop().catch(() => {}); onEnd?.()
  }
  const timer = ms ? setTimeout(stop, ms) : null
  return stop
}

/**
 * Lee tags durante `ms` milisegundos (0 = hasta que se detenga). Llama onRead({serial, texts}).
 * Devuelve una función para detener la lectura.
 */
export async function startNfcScan({ onRead, onError, ms = 5000, onEnd, log }) {
  if (!nfcSupported()) throw new Error('Este dispositivo/navegador no soporta Web NFC (usa Chrome en Android)')
  if (isNative()) return startNative({ onRead, ms, onEnd, log })
  const ctrl = new AbortController()
  const reader = new window.NDEFReader()
  await reader.scan({ signal: ctrl.signal })
  reader.onreading = (e) => onRead?.({ serial: e.serialNumber, texts: decodeRecords(e.message) })
  reader.onreadingerror = () => onError?.('No se pudo leer el tag, intenta de nuevo')
  const timer = ms ? setTimeout(() => { ctrl.abort(); onEnd?.() }, ms) : null
  return () => { clearTimeout(timer); ctrl.abort(); onEnd?.() }
}

/**
 * Asigna un tag: espera que se acerque y obtiene su número de serie (UID).
 * En el navegador también escribe el código del socio como registro de texto (si el tag lo permite).
 */
export function assignNfcTag(code, ms = 15000) {
  return new Promise(async (resolve, reject) => {
    if (!nfcSupported()) return reject(new Error('NFC no disponible en este dispositivo. Puedes escribir el UID manualmente o usar un lector USB.'))

    if (isNative()) {
      let stop = null
      const timer = setTimeout(() => { stop?.(); reject(new Error('Tiempo agotado: no se detectó ningún tag')) }, ms)
      try {
        stop = await startNative({ ms: 0, onRead: (r) => { clearTimeout(timer); stop?.(); resolve(r.serial || code) } })
      } catch (err) { clearTimeout(timer); reject(err) }
      return
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => { ctrl.abort(); reject(new Error('Tiempo agotado: no se detectó ningún tag')) }, ms)
    try {
      const reader = new window.NDEFReader()
      await reader.scan({ signal: ctrl.signal })
      reader.onreading = async (e) => {
        try {
          await reader.write({ records: [{ recordType: 'text', data: code }] }, { overwrite: true })
        } catch { /* tag de sólo lectura: se usa sólo el UID */ }
        clearTimeout(timer); ctrl.abort()
        resolve(e.serialNumber || code)
      }
    } catch (err) { clearTimeout(timer); reject(err) }
  })
}

/** Estado del NFC para mostrarlo en pantalla: { kind: 'web'|'native'|'none', supported, enabled, detail } */
export async function nfcStatus() {
  if (isNative()) {
    try {
      const { supported, enabled } = await withTimeout(IyNfc.status(), 4000, 'Leer el estado del NFC')
      if (!supported) return { kind: 'native', supported: false, enabled: false, detail: 'Este teléfono no tiene NFC' }
      return { kind: 'native', supported: true, enabled, detail: enabled ? 'NFC encendido' : 'NFC apagado: actívalo en los ajustes del teléfono' }
    } catch (e) {
      return { kind: 'native', supported: false, enabled: false, detail: 'No se pudo cargar el lector nativo: ' + (e?.message || e) }
    }
  }
  return 'NDEFReader' in window
    ? { kind: 'web', supported: true, enabled: true, detail: 'Web NFC disponible' }
    : { kind: 'none', supported: false, enabled: false, detail: 'Este navegador no soporta Web NFC' }
}
