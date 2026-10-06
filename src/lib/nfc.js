// Web NFC (Chrome en Android). En escritorio se admiten lectores NFC USB
// que funcionan como teclado (escriben el UID y Enter).
export const nfcSupported = () => typeof window !== 'undefined' && 'NDEFReader' in window

const decodeRecords = (message) => {
  const out = []
  for (const r of message?.records || []) {
    try {
      if (r.recordType === 'text' || r.recordType === 'url') out.push(new TextDecoder(r.encoding || 'utf-8').decode(r.data))
    } catch { /* registro no legible */ }
  }
  return out
}

/**
 * Lee tags durante `ms` milisegundos. Llama onRead({serial, texts}).
 * Devuelve una función para detener la lectura.
 */
export async function startNfcScan({ onRead, onError, ms = 5000, onEnd }) {
  if (!nfcSupported()) throw new Error('Este dispositivo/navegador no soporta Web NFC (usa Chrome en Android)')
  const ctrl = new AbortController()
  const reader = new window.NDEFReader()
  await reader.scan({ signal: ctrl.signal })
  reader.onreading = (e) => onRead?.({ serial: e.serialNumber, texts: decodeRecords(e.message) })
  reader.onreadingerror = () => onError?.('No se pudo leer el tag, intenta de nuevo')
  const timer = ms ? setTimeout(() => { ctrl.abort(); onEnd?.() }, ms) : null
  return () => { clearTimeout(timer); ctrl.abort(); onEnd?.() }
}

/**
 * Asigna un tag: espera que se acerque, obtiene su número de serie (UID)
 * y escribe el código del socio como registro de texto.
 */
export function assignNfcTag(code, ms = 15000) {
  return new Promise(async (resolve, reject) => {
    if (!nfcSupported()) return reject(new Error('Web NFC no disponible en este dispositivo. Puedes escribir el UID manualmente o usar un lector USB.'))
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
