// Reconocimiento facial con @vladmandic/face-api (TensorFlow.js).
// Detector SSD MobileNet v1 + 68 landmarks + red de reconocimiento ResNet-34
// (descriptor de 128 dimensiones, ~99.4% en LFW). Modelos servidos desde /models
// para que funcione sin internet (PWA local / app nativa).
let fa = null
let loading = null

export function loadFace() {
  if (fa) return Promise.resolve(fa)
  if (!loading) {
    loading = (async () => {
      const lib = await import('@vladmandic/face-api')
      try { await lib.tf.setBackend('webgl') } catch { /* usa el backend por defecto */ }
      await lib.tf.ready()
      const url = (import.meta.env.BASE_URL || '/') + 'models'
      await Promise.all([
        lib.nets.ssdMobilenetv1.loadFromUri(url),
        lib.nets.faceLandmark68Net.loadFromUri(url),
        lib.nets.faceRecognitionNet.loadFromUri(url)
      ])
      fa = lib
      return lib
    })()
  }
  return loading
}

/** Detecta UNA cara con landmarks y descriptor. Devuelve null si no hay. */
export async function detectFace(video, minConfidence = 0.6) {
  const lib = await loadFace()
  return lib
    .detectSingleFace(video, new lib.SsdMobilenetv1Options({ minConfidence, maxResults: 1 }))
    .withFaceLandmarks()
    .withFaceDescriptor()
}

/**
 * Evalúa la calidad de la captura: tamaño, confianza y orientación frontal
 * (comparando la nariz con el punto medio de los ojos para estimar el giro).
 */
export function faceQuality(det, video) {
  if (!det) return { ok: false, msg: 'No se detecta rostro' }
  const { box, score } = det.detection
  const pts = det.landmarks.positions
  const leftEye = avg(pts.slice(36, 42)), rightEye = avg(pts.slice(42, 48)), nose = pts[30]
  const eyeDist = Math.abs(rightEye.x - leftEye.x)
  const yaw = (nose.x - (leftEye.x + rightEye.x) / 2) / eyeDist
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 57.3
  const vw = video.videoWidth || 640
  if (score < 0.85) return { ok: false, msg: 'Mejora la iluminación' }
  if (box.width < vw * 0.22) return { ok: false, msg: 'Acércate a la cámara' }
  if (box.width > vw * 0.75) return { ok: false, msg: 'Aléjate un poco' }
  if (Math.abs(yaw) > 0.18) return { ok: false, msg: 'Mira de frente a la cámara' }
  if (Math.abs(roll) > 12) return { ok: false, msg: 'Endereza la cabeza' }
  return { ok: true, msg: 'Perfecto, no te muevas', yaw }
}

const avg = (arr) => ({ x: arr.reduce((s, p) => s + p.x, 0) / arr.length, y: arr.reduce((s, p) => s + p.y, 0) / arr.length })

export function distance(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s)
}

/**
 * Busca la mejor coincidencia. members: [{id, full_name, face_descriptors: [[...128]]}]
 * Umbral estricto 0.45 (face-api recomienda 0.6) + margen frente al 2º candidato
 * para minimizar falsos positivos.
 */
export function bestMatch(descriptor, members, threshold = 0.45, margin = 0.06) {
  const scored = []
  for (const m of members) {
    const list = m.face_descriptors || []
    if (!list.length) continue
    let best = Infinity
    for (const d of list) best = Math.min(best, distance(descriptor, d))
    scored.push({ member: m, dist: best })
  }
  scored.sort((a, b) => a.dist - b.dist)
  const [first, second] = scored
  if (!first || first.dist > threshold) return { match: null, dist: first?.dist }
  if (second && second.dist - first.dist < margin) return { match: null, dist: first.dist, ambiguous: true }
  return { match: first.member, dist: first.dist, confidence: Math.round((1 - first.dist) * 100) }
}

/** Captura un frame del video como JPEG comprimido (para la foto de perfil). */
export function snapshot(video, size = 320) {
  const c = document.createElement('canvas')
  const ratio = video.videoHeight / video.videoWidth
  c.width = size; c.height = Math.round(size * ratio)
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}
