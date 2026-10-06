// Frecuencia cardiaca: zonas, calorías por pulso y utilidades para series.
// - FC máxima: Tanaka (2001) 208 − 0,7 × edad
// - Zonas por % de FC máx: Z1 50–60, Z2 60–70, Z3 70–80, Z4 80–90, Z5 ≥90
// - Calorías: Keytel et al. (2005), J Sports Sci 23(3):289-97
import { calcAge } from './constants'

export const ZONES = [
  { id: 'z1', label: 'Z1 Suave', from: 0.5, color: '#60a5fa' },
  { id: 'z2', label: 'Z2 Quema grasa', from: 0.6, color: '#22c55e' },
  { id: 'z3', label: 'Z3 Aeróbica', from: 0.7, color: '#FFD60A' },
  { id: 'z4', label: 'Z4 Umbral', from: 0.8, color: '#f97316' },
  { id: 'z5', label: 'Z5 Máximo', from: 0.9, color: '#ef4444' }
]

export const hrMax = (age) => Math.round(208 - 0.7 * (age || 30))

/** Zona (objeto de ZONES) de un pulso, o null si está por debajo del 50 %. */
export function zoneOf(hr, max) {
  const p = hr / max
  let z = null
  for (const x of ZONES) if (p >= x.from) z = x
  return z
}

/** Perfil para los cálculos a partir del cliente y su último peso. */
export const hrProfile = (member, weightKg) => ({
  age: calcAge(member?.birthdate) || 30,
  sex: member?.sex || 'M',
  weight: weightKg || 70
})

/** kcal por minuto según Keytel (válido para FC ≈ 90–180 lpm). */
export function keytelKcalMin(hr, { age, sex, weight }) {
  const v = sex === 'F'
    ? (-20.4022 + 0.4472 * hr - 0.1263 * weight + 0.074 * age) / 4.184
    : (-55.0969 + 0.6309 * hr + 0.1988 * weight + 0.2017 * age) / 4.184
  return Math.max(0, v)
}

/**
 * Resume una serie de pulso [{t: ms, hr}] → promedio, máximo, minutos por zona y kcal.
 * Los huecos de más de 15 s (pulsera desconectada) no cuentan.
 */
export function analyzeHr(samples, profile) {
  const s = (samples || []).filter((x) => x.hr > 30 && x.hr < 240).sort((a, b) => a.t - b.t)
  if (!s.length) return null
  const max = hrMax(profile.age)
  const zones = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  let kcal = 0, sum = 0, top = 0
  for (let i = 0; i < s.length; i++) {
    const { hr } = s[i]
    sum += hr; top = Math.max(top, hr)
    const dt = i < s.length - 1 ? Math.min(15, (s[i + 1].t - s[i].t) / 1000) : 1
    if (dt <= 0) continue
    const z = zoneOf(hr, max)
    if (z) zones[z.id] += dt / 60
    if (hr >= 90) kcal += keytelKcalMin(hr, profile) * dt / 60
  }
  for (const k in zones) zones[k] = Math.round(zones[k] * 10) / 10
  return { avg: Math.round(sum / s.length), max: top, zones, kcal: Math.round(kcal) }
}

/** Reduce una serie a como máximo n puntos [[segundo, lpm]] para guardarla. */
export function compactSeries(samples, n = 300) {
  const s = (samples || []).filter((x) => x.hr > 0)
  if (!s.length) return null
  const t0 = s[0].t
  const step = Math.max(1, Math.ceil(s.length / n))
  const out = []
  for (let i = 0; i < s.length; i += step) out.push([Math.round((s[i].t - t0) / 1000), s[i].hr])
  return out
}

/** Reduce una ruta a como máximo n puntos [[lat, lon]] con 5 decimales (~1 m). */
export function compactRoute(points, n = 500) {
  const p = (points || []).filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && (x[0] || x[1]))
  if (p.length < 2) return null
  const step = Math.max(1, Math.ceil(p.length / n))
  const out = []
  for (let i = 0; i < p.length; i += step) out.push([+p[i][0].toFixed(5), +p[i][1].toFixed(5)])
  const last = p[p.length - 1]
  out.push([+last[0].toFixed(5), +last[1].toFixed(5)])
  return out
}

/** Distancia en metros entre dos [lat, lon] (haversine). */
export function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
