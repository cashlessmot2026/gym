// Health Connect (solo APK Android): trae los entrenamientos que Mi Fitness,
// Zepp, Garmin Connect, Samsung Health, etc. guardaron en el teléfono.
// Cada entrenamiento se completa con su pulso, pasos y distancia del mismo intervalo.
import { Capacitor } from '@capacitor/core'
import { analyzeHr, compactSeries } from './hr'
import { normalizeSport } from './activityFiles'

const READ = ['workouts', 'heartRate', 'steps', 'distance', 'calories', 'totalCalories']
const CONSENT_KEY = 'iy-health-consent'

export const healthSupported = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

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
  const startDate = (since ? new Date(since) : new Date(Date.now() - 30 * 86400000)).toISOString()
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
