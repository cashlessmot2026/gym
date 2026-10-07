// NFC:
// - APK Android (Capacitor): lector nativo con @capgo/capacitor-nfc (el WebView NO soporta Web NFC).
// - Chrome en Android / PWA: Web NFC (NDEFReader).
// - Escritorio: lectores NFC USB que funcionan como teclado (escriben el UID y Enter).
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

// ---------- Nativo (APK) ----------
const hexUid = (bytes = []) => bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join(':') // 04:fd:1d:...

/** Texto de los registros NDEF del plugin nativo (registros de texto "T" y URI "U"). */
function decodeNative(ndef = []) {
  const out = []
  for (const r of ndef || []) {
    try {
      const p = (r.payload || []).map((b) => b & 0xff)
      const t = (r.type || []).map((b) => String.fromCharCode(b)).join('')
      if (t === 'T' && p.length) out.push(new TextDecoder().decode(new Uint8Array(p.slice(1 + (p[0] & 0x3f)))))
      else if (t === 'U' && p.length) out.push(new TextDecoder().decode(new Uint8Array(p.slice(1))))
    } catch { /* registro no legible */ }
  }
  return out
}

async function nativeNfc() {
  const { CapacitorNfc } = await import('@capgo/capacitor-nfc')
  const { supported } = await CapacitorNfc.isSupported()
  if (!supported) throw new Error('Este teléfono no tiene NFC')
  const { status } = await CapacitorNfc.getStatus()
  if (status === 'NFC_DISABLED') {
    await CapacitorNfc.showSettings?.().catch(() => {})
    throw new Error('El NFC está apagado. Actívalo en los ajustes del teléfono y vuelve a intentarlo.')
  }
  return CapacitorNfc
}

async function startNative({ onRead, ms, onEnd }) {
  const Nfc = await nativeNfc()
  let stopped = false
  const handle = await Nfc.addListener('nfcEvent', (e) => {
    if (stopped) return
    onRead?.({ serial: hexUid(e.tag?.id), texts: decodeNative(e.tag?.ndefMessage) })
  })
  await Nfc.startScanning({ invalidateAfterFirstRead: false, alertMessage: 'Acerca el tag al teléfono' })
  const stop = () => {
    if (stopped) return
    stopped = true; clearTimeout(timer)
    handle.remove?.(); Nfc.stopScanning?.().catch(() => {}); onEnd?.()
  }
  const timer = ms ? setTimeout(stop, ms) : null
  return stop
}

/**
 * Lee tags durante `ms` milisegundos. Llama onRead({serial, texts}).
 * Devuelve una función para detener la lectura.
 */
export async function startNfcScan({ onRead, onError, ms = 5000, onEnd }) {
  if (!nfcSupported()) throw new Error('Este dispositivo/navegador no soporta Web NFC (usa Chrome en Android)')
  if (isNative()) return startNative({ onRead, ms, onEnd })
  const ctrl = new AbortController()
  const reader = new window.NDEFReader()
  await reader.scan({ signal: ctrl.signal })
  reader.onreading = (e) => onRead?.({ serial: e.serialNumber, texts: decodeRecords(e.message) })
  reader.onreadingerror = () => onError?.('No se pudo leer el tag, intenta de nuevo')
  const timer = ms ? setTimeout(() => { ctrl.abort(); onEnd?.() }, ms) : null
  return () => { clearTimeout(timer); ctrl.abort(); onEnd?.() }
}

/** Escribe el código como registro de texto NDEF con el plugin nativo. */
function textRecord(code) {
  const enc = new TextEncoder()
  const lang = Array.from(enc.encode('es'))
  return { tnf: 0x01, type: [0x54], id: [], payload: [lang.length & 0x3f, ...lang, ...Array.from(enc.encode(code))] }
}

/**
 * Asigna un tag: espera que se acerque, obtiene su número de serie (UID)
 * y escribe el código del socio como registro de texto.
 */
export function assignNfcTag(code, ms = 15000) {
  return new Promise(async (resolve, reject) => {
    if (!nfcSupported()) return reject(new Error('NFC no disponible en este dispositivo. Puedes escribir el UID manualmente o usar un lector USB.'))

    if (isNative()) {
      let done = false
      let stop = null
      const timer = setTimeout(() => { if (!done) { done = true; stop?.(); reject(new Error('Tiempo agotado: no se detectó ningún tag')) } }, ms)
      try {
        const Nfc = await nativeNfc()
        const handle = await Nfc.addListener('nfcEvent', async (e) => {
          if (done) return
          done = true; clearTimeout(timer)
          const uid = hexUid(e.tag?.id)
          try { await Nfc.write({ allowFormat: true, records: [textRecord(code)] }) } catch { /* tag de sólo lectura: se usa sólo el UID */ }
          handle.remove?.(); Nfc.stopScanning?.().catch(() => {})
          resolve(uid || code)
        })
        await Nfc.startScanning({ invalidateAfterFirstRead: false, alertMessage: 'Acerca el tag al teléfono' })
        stop = () => { handle.remove?.(); Nfc.stopScanning?.().catch(() => {}) }
      } catch (err) { clearTimeout(timer); done = true; reject(err) }
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
