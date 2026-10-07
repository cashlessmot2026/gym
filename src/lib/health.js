// Health Connect (solo APK Android): trae los entrenamientos que Mi Fitness,
// Zepp, Garmin Connect, Samsung Health, etc. guardaron en el teléfono.
// Cada entrenamiento se completa con su pulso, pasos y distancia del mismo intervalo.
import { Capacitor } from '@capacitor/core'
import { analyzeHr, compactSeries } from './hr'
import { normalizeSport } from './activityFiles'

const READ = ['workouts', 'heartRate', 'restingHeartRate', 'steps', 'distance', 'calories', 'totalCalories', 'sleep']
// v2: se amplió la lista de permisos (pulso en reposo y sueño); quien ya había aceptado debe volver a autorizar
const CONSENT_KEY = 'iy-health-consent-v2'

export const healthSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

const HISTORY_DAYS = 90 // primera sincronización: hasta 90 días de historial

const plugin = async () => (await import('@capgo/capacitor-health')).Health

/** ¿Ya autorizó el cliente antes? (para sincronizar solo al abrir la app). */
export const healthConsented = () => { try { return localStorage.getItem(CONSENT_KEY) === '1' } catch { return false } }

/** Comprueba Health Connect y pide permisos. Devuelve un mensaje si no se puede. */
export async function connectHealth() {
  if (!healthSupported()) throw new Error('Health Connect solo está disponible en la app Android')
  const H = await plugin()
  const av = await H.isAvailable()
  if (!av.available) throw new Error('Instala o actualiza "Health Connect" desde Play Store y vuelve a intentarlo')
  const st = await H.requestAuthorization({ read: READ, requestHistoryAccess: true })
  if (!st.readAuthorized.includes('workouts')) throw new Error('No se concedió el permiso de "Ejercicio" en Health Connect')
  try { localStorage.setItem(CONSENT_KEY, '1') } catch { /* sin almacenamiento */ }
  return st
}

export async function openHealthSettings() {
  if (healthSupported()) await (await plugin()).openHealthConnectSettings()
}

const sum = (samples) => samples.reduce((a, s) => a + (Number(s.value) || 0), 0)

/**
 * Lee los entrenamientos desde `since` (por defecto 30 días) y los convierte en actividades.
 * No guarda nada: devuelve la lista para saveActivities().
 */
export async function readHealthWorkouts(since, profile) {
  const H = await plugin()
  const startDate = (since ? new Date(since) : new Date(Date.now() - HISTORY_DAYS * 86400000)).toISOString()
  const endDate = new Date().toISOString()
  const { workouts = [] } = await H.queryWorkouts({ startDate, endDate, limit: 200, ascending: true })
  const out = []
  for (const w of workouts) {
    const range = { startDate: w.startDate, endDate: w.endDate }
    const [hrR, stepsR, distR] = await Promise.all([
      H.readSamples({ dataType: 'heartRate', ...range, limit: 5000, ascending: true }).catch(() => ({ samples: [] })),
      H.readSamples({ dataType: 'steps', ...range, limit: 1000 }).catch(() => ({ samples: [] })),
      w.totalDistance ? Promise.resolve({ samples: [] }) : H.readSamples({ dataType: 'distance', ...range, limit: 1000 }).catch(() => ({ samples: [] }))
    ])
    const hr = hrR.samples.map((s) => ({ t: new Date(s.startDate).getTime(), hr: Math.round(s.value) }))
    const h = analyzeHr(hr, profile)
    const start = new Date(w.startDate)
    out.push({
      source: 'health_connect',
      sport: normalizeSport(w.workoutType),
      title: null,
      started_at: start.toISOString(),
      duration_sec: Math.round(w.duration || (new Date(w.endDate) - start) / 1000),
      distance_m: Math.round(w.totalDistance || sum(distR.samples)),
      calories: Math.round(w.totalEnergyBurned || h?.kcal || 0),
      steps: Math.round(sum(stepsR.samples)),
      avg_hr: h?.avg ?? null,
      max_hr: h?.max ?? null,
      hr_zones: h?.zones ?? null,
      hr_series: compactSeries(hr),
      route: null,
      ascent_m: null,
      device: w.sourceName || null,
      dedupe_key: `t:${start.toISOString().slice(0, 16)}`
    })
  }
  return out
}

// ---------- Resumen por día (historial) ----------
const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

async function aggregate(H, dataType, aggregation, range) {
  try { return (await H.queryAggregated({ dataType, bucket: 'day', aggregation, ...range })).samples || [] } catch { return [] }
}

/**
 * Resumen diario desde `sinceDay` (por defecto 90 días): pasos, distancia, calorías, pulso (medio, máx, mín, reposo) y sueño.
 * No guarda nada: devuelve filas para saveHealthDaily().
 */
export async function readHealthDaily(sinceDay) {
  const H = await plugin()
  const from = sinceDay ? new Date(sinceDay) : new Date(Date.now() - HISTORY_DAYS * 86400000)
  from.setHours(0, 0, 0, 0)
  const range = { startDate: from.toISOString(), endDate: new Date().toISOString() }
  const [steps, dist, kcal, kcalActive, hr, rest, sleep] = await Promise.all([
    aggregate(H, 'steps', 'sum', range),
    aggregate(H, 'distance', 'sum', range),
    aggregate(H, 'totalCalories', 'sum', range),
    aggregate(H, 'calories', 'sum', range),
    aggregate(H, 'heartRate', ['average', 'max', 'min'], range),
    aggregate(H, 'restingHeartRate', 'average', range),
    aggregate(H, 'sleep', 'sum', range)
  ])
  const days = new Map()
  const row = (iso) => { const k = dayKey(iso); if (!days.has(k)) days.set(k, { day: k }); return days.get(k) }
  steps.forEach((s) => { row(s.startDate).steps = Math.round(s.value || 0) })
  dist.forEach((s) => { row(s.startDate).distance_m = Math.round(s.value || 0) })
  kcalActive.forEach((s) => { row(s.startDate).calories = Math.round(s.value || 0) })
  kcal.forEach((s) => { const r = row(s.startDate); if ((s.value || 0) > (r.calories || 0)) r.calories = Math.round(s.value) })
  hr.forEach((s) => { const r = row(s.startDate); r.avg_hr = s.values?.average ? Math.round(s.values.average) : null; r.max_hr = s.values?.max ? Math.round(s.values.max) : null; r.min_hr = s.values?.min ? Math.round(s.values.min) : null })
  rest.forEach((s) => { row(s.startDate).resting_hr = s.value ? Math.round(s.value) : null })
  // sueño: algunos orígenes devuelven minutos y otros segundos
  sleep.forEach((s) => { const v = s.value || 0; row(s.startDate).sleep_min = Math.round(s.unit === 'minute' ? v : v > 1440 ? v / 60 : v) })
  // Se descartan días completamente vacíos
  return [...days.values()].filter((d) => d.steps || d.distance_m || d.calories || d.avg_hr || d.sleep_min)
}
