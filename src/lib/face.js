// Reconocimiento facial con @vladmandic/face-api (TensorFlow.js).
// - Detección: TinyFaceDetector (190 KB, muy rápido en móviles y PC).
// - Alineación: 68 landmarks.  - Identidad: red ResNet-34 → descriptor de 128 dimensiones.
// Los modelos se sirven desde /models para que funcione sin internet (PWA local / app nativa).
let fa = null
let loading = null

export function loadFace() {
  if (fa) return Promise.resolve(fa)
  if (!loading) {
    loading = (async () => {
      const lib = await import('@vladmandic/face-api')
      try { await lib.tf.setBackend('webgl') } catch { /* usa el backend por defecto */ }
      // Reutiliza los shaders aunque cambie el tamaño de la imagen (evita recompilaciones lentas)
      try { lib.tf.env().set('WEBGL_USE_SHAPES_UNIFORMS', true) } catch { /* flag no disponible */ }
      await lib.tf.ready()
      const url = (import.meta.env.BASE_URL || '/') + 'models'
      await Promise.all([
        lib.nets.tinyFaceDetector.loadFromUri(url),
        lib.nets.faceLandmark68Net.loadFromUri(url),
        lib.nets.faceRecognitionNet.loadFromUri(url)
      ])
      // Calentamiento: la 1ª inferencia compila los shaders de WebGL (lenta). Se hace aquí,
      // en segundo plano, para que la cámara responda al instante cuando se abra.
      try {
        const c = document.createElement('canvas'); c.width = c.height = 160
        const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 160, 160)
        await lib.detectSingleFace(c, new lib.TinyFaceDetectorOptions({ inputSize: 160 })).withFaceLandmarks().withFaceDescriptor()
      } catch { /* sin rostro: sólo calienta */ }
      fa = lib
      return lib
    })().catch((e) => { loading = null; throw e })
  }
  return loading
}

/** Precarga los modelos en segundo plano (llamar al abrir pantallas que usarán la cámara). */
export const preloadFace = () => { loadFace().catch(() => {}) }

const options = (lib, scoreThreshold = 0.5, inputSize = 320) => new lib.TinyFaceDetectorOptions({ inputSize, scoreThreshold })

/** Detecta UNA cara con landmarks y descriptor. Devuelve undefined si no hay. */
export async function detectFace(video, scoreThreshold = 0.5, inputSize = 320) {
  const lib = await loadFace()
  return lib.detectSingleFace(video, options(lib, scoreThreshold, inputSize)).withFaceLandmarks().withFaceDescriptor()
}

/**
 * Evalúa la captura: tamaño, confianza, orientación frontal (giro e inclinación)
 * y nitidez/iluminación aproximadas. Umbrales pensados para cámaras de celular y webcam.
 */
export function faceQuality(det, video) {
  if (!det) return { ok: false, level: 0, msg: 'Buscando rostro…' }
  const { box, score } = det.detection
  const pts = det.landmarks.positions
  const leftEye = avg(pts.slice(36, 42)), rightEye = avg(pts.slice(42, 48)), nose = pts[30]
  const eyeDist = Math.abs(rightEye.x - leftEye.x) || 1
  const yaw = (nose.x - (leftEye.x + rightEye.x) / 2) / eyeDist
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 57.3
  const vw = video.videoWidth || 640
  const ratio = box.width / vw
  if (score < 0.5) return { ok: false, level: 1, msg: 'Mejora la iluminación del rostro' }
  if (ratio < 0.14) return { ok: false, level: 1, msg: 'Acércate un poco a la cámara' }
  if (ratio > 0.8) return { ok: false, level: 1, msg: 'Aléjate un poco' }
  if (Math.abs(yaw) > 0.32) return { ok: false, level: 1, msg: 'Mira de frente a la cámara' }
  if (Math.abs(roll) > 18) return { ok: false, level: 1, msg: 'Endereza la cabeza' }
  return { ok: true, level: 2, msg: 'Perfecto, quédate así' }
}

const avg = (arr) => ({ x: arr.reduce((s, p) => s + p.x, 0) / arr.length, y: arr.reduce((s, p) => s + p.y, 0) / arr.length })

export function distance(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s)
}

/**
 * Busca la mejor coincidencia. members: [{id, full_name, face_descriptors: [[...128]]}]
 * Umbral 0.47 (face-api recomienda 0.6) + margen frente al 2º candidato
 * para minimizar falsos positivos.
 */
export function bestMatch(descriptor, members, threshold = 0.47, margin = 0.05) {
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

/** Dibuja el recuadro del rostro sobre un canvas superpuesto al video (espejado igual que el video). */
export function drawBox(canvas, video, det, color = '#FFD60A') {
  if (!canvas || !video) return
  const w = video.videoWidth, h = video.videoHeight
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const g = canvas.getContext('2d')
  g.clearRect(0, 0, w, h)
  if (!det) return
  const { x, y, width, height } = det.detection.box
  const r = Math.min(width, height) * 0.18
  g.strokeStyle = color; g.lineWidth = Math.max(3, w / 180)
  // esquinas tipo visor
  const corner = (cx, cy, dx, dy) => { g.beginPath(); g.moveTo(cx, cy + dy * r); g.lineTo(cx, cy); g.lineTo(cx + dx * r, cy); g.stroke() }
  corner(x, y, 1, 1); corner(x + width, y, -1, 1); corner(x, y + height, 1, -1); corner(x + width, y + height, -1, -1)
}

/** Captura la foto de perfil (JPEG). Si se pasa el recuadro del rostro, recorta centrado en la cara. */
export function snapshot(video, size = 320, box = null) {
  const c = document.createElement('canvas')
  const g = c.getContext('2d')
  if (box) {
    const side = Math.min(Math.max(box.width, box.height) * 1.8, video.videoWidth, video.videoHeight)
    const sx = Math.max(0, Math.min(video.videoWidth - side, box.x + box.width / 2 - side / 2))
    const sy = Math.max(0, Math.min(video.videoHeight - side, box.y + box.height / 2 - side / 2))
    c.width = c.height = size
    g.drawImage(video, sx, sy, side, side, 0, 0, size, size)
  } else {
    c.width = size; c.height = Math.round(size * video.videoHeight / video.videoWidth)
    g.drawImage(video, 0, 0, c.width, c.height)
  }
  return c.toDataURL('image/jpeg', 0.82)
}
