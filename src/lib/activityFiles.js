// Lee archivos de entrenamiento de relojes y pulseras en el propio dispositivo:
// - .FIT (Garmin, Coros, Wahoo, Zepp, Suunto...) con fit-file-parser
// - .TCX y .GPX (XML) con DOMParser
// Devuelve una "actividad" lista para guardar con saveActivity().
import { analyzeHr, compactRoute, compactSeries, haversine } from './hr'

// Deportes normalizados (FIT / TCX / Health Connect → español)
const SPORTS = {
  running: 'correr', run: 'correr', treadmill: 'correr', trail: 'correr',
  cycling: 'bici', biking: 'bici', bike: 'bici', ride: 'bici', e_biking: 'bici',
  walking: 'caminar', walk: 'caminar', hiking: 'caminar',
  swimming: 'natación', swim: 'natación',
  training: 'fuerza', strength: 'fuerza', fitness_equipment: 'fuerza', weight: 'fuerza',
  rowing: 'remo', elliptical: 'elíptica', yoga: 'yoga', boxing: 'box', hiit: 'hiit'
}
export function normalizeSport(s) {
  const k = String(s || '').toLowerCase()
  for (const key in SPORTS) if (k.includes(key)) return SPORTS[key]
  return 'otro'
}

export const SPORT_ICON = { correr: '🏃', bici: '🚴', caminar: '🚶', natación: '🏊', fuerza: '🏋️', remo: '🚣', elíptica: '⚙️', yoga: '🧘', box: '🥊', hiit: '⚡', otro: '⌚' }

/** Construye la actividad final a partir de lo extraído del archivo. */
function build({ source, sport, start, durationSec, distanceM, calories, steps, ascent, hr, route, device, profile, name }) {
  const h = analyzeHr(hr, profile)
  let dist = distanceM || 0
  if (!dist && route?.length > 1) for (let i = 1; i < route.length; i++) dist += haversine(route[i - 1], route[i])
  const started = start instanceof Date ? start : new Date(start)
  if (isNaN(started)) throw new Error('El archivo no tiene fecha de inicio')
  return {
    source,
    sport: normalizeSport(sport),
    title: name || null,
    started_at: started.toISOString(),
    duration_sec: Math.round(durationSec || 0),
    distance_m: Math.round(dist),
    calories: Math.round(calories || h?.kcal || 0),
    steps: Math.round(steps || 0),
    avg_hr: h?.avg ?? null,
    max_hr: h?.max ?? null,
    hr_zones: h?.zones ?? null,
    hr_series: compactSeries(hr),
    route: compactRoute(route),
    ascent_m: ascent ? Math.round(ascent) : null,
    device: device || null,
    // Misma hora de inicio (al minuto) = mismo entrenamiento aunque llegue por otra vía
    dedupe_key: `t:${started.toISOString().slice(0, 16)}`
  }
}

// ---------- FIT ----------
async function parseFit(buffer, profile) {
  const { default: FitParser } = await import('fit-file-parser')
  const parser = new FitParser({ force: true, speedUnit: 'm/s', lengthUnit: 'm', mode: 'list' })
  const d = await parser.parseAsync(buffer)
  const s = d.sessions?.[0] || {}
  const recs = d.records || []
  const hr = recs.filter((r) => r.heart_rate && r.timestamp).map((r) => ({ t: new Date(r.timestamp).getTime(), hr: r.heart_rate }))
  const route = recs.filter((r) => r.position_lat != null && r.position_long != null).map((r) => [r.position_lat, r.position_long])
  const start = s.start_time || recs[0]?.timestamp || d.activity?.timestamp
  const device = d.file_ids?.[0]?.manufacturer || d.device_infos?.[0]?.manufacturer
  const a = build({
    source: 'fit', sport: s.sport || s.sub_sport, start,
    durationSec: s.total_timer_time || s.total_elapsed_time,
    distanceM: s.total_distance, calories: s.total_calories, ascent: s.total_ascent,
    steps: s.total_strides ? s.total_strides * 2 : 0, hr, route, device, profile
  })
  // Si el reloj ya calculó promedio/máximo, se respetan
  if (s.avg_heart_rate) a.avg_hr = Math.round(s.avg_heart_rate)
  if (s.max_heart_rate) a.max_hr = Math.round(s.max_heart_rate)
  return a
}

// ---------- XML (TCX / GPX) ----------
const tag = (el, name) => el.getElementsByTagNameNS('*', name)
const num = (el, name) => { const x = tag(el, name)[0]; return x ? Number(x.textContent) : null }

function parseTcx(xml, profile) {
  const act = tag(xml, 'Activity')[0]
  if (!act) throw new Error('El TCX no contiene ninguna actividad')
  let dist = 0, cal = 0, dur = 0
  for (const lap of tag(act, 'Lap')) {
    dist += Number(lap.getElementsByTagNameNS('*', 'DistanceMeters')[0]?.textContent || 0)
    cal += num(lap, 'Calories') || 0
    dur += num(lap, 'TotalTimeSeconds') || 0
  }
  const hr = [], route = []
  for (const tp of tag(act, 'Trackpoint')) {
    const t = new Date(tag(tp, 'Time')[0]?.textContent).getTime()
    const bpm = tag(tp, 'HeartRateBpm')[0]
    if (bpm && t) hr.push({ t, hr: num(bpm, 'Value') })
    const lat = num(tp, 'LatitudeDegrees'), lon = num(tp, 'LongitudeDegrees')
    if (lat != null && lon != null) route.push([lat, lon])
  }
  const start = tag(act, 'Id')[0]?.textContent || tag(act, 'Lap')[0]?.getAttribute('StartTime')
  return build({
    source: 'tcx', sport: act.getAttribute('Sport'), start, durationSec: dur, distanceM: dist,
    calories: cal, hr, route, device: tag(act, 'Name')[0]?.textContent, profile
  })
}

function parseGpx(xml, profile) {
  const pts = [...tag(xml, 'trkpt'), ...(tag(xml, 'trkpt').length ? [] : tag(xml, 'rtept'))]
  if (!pts.length) throw new Error('El GPX no contiene ningún recorrido')
  const hr = [], route = [], times = []
  let ascent = 0, prevEle = null
  for (const p of pts) {
    const lat = Number(p.getAttribute('lat')), lon = Number(p.getAttribute('lon'))
    route.push([lat, lon])
    const t = new Date(tag(p, 'time')[0]?.textContent).getTime()
    if (t) times.push(t)
    const bpm = num(p, 'hr') // extensiones Garmin TrackPointExtension
    if (bpm && t) hr.push({ t, hr: bpm })
    const ele = num(p, 'ele')
    if (ele != null) { if (prevEle != null && ele > prevEle) ascent += ele - prevEle; prevEle = ele }
  }
  const trk = tag(xml, 'trk')[0]
  const type = trk && tag(trk, 'type')[0]?.textContent
  const name = trk && tag(trk, 'name')[0]?.textContent
  const start = times[0] || tag(xml, 'time')[0]?.textContent
  return build({
    source: 'gpx', sport: type || name, start, durationSec: times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 0,
    hr, route, ascent, name, device: xml.documentElement.getAttribute('creator'), profile
  })
}

export const ACCEPT = '.fit,.tcx,.gpx'

/** Lee un archivo (File) y devuelve la actividad. Lanza un error legible si no es válido. */
export async function parseActivityFile(file, profile) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (file.size > 40 * 1024 * 1024) throw new Error(`${file.name}: el archivo es demasiado grande`)
  try {
    if (ext === 'fit') return await parseFit(await file.arrayBuffer(), profile)
    if (ext === 'tcx' || ext === 'gpx') {
      const xml = new DOMParser().parseFromString(await file.text(), 'application/xml')
      if (xml.getElementsByTagName('parsererror').length) throw new Error('XML dañado')
      return ext === 'tcx' ? parseTcx(xml, profile) : parseGpx(xml, profile)
    }
  } catch (e) {
    throw new Error(`${file.name}: ${typeof e === 'string' ? e : e.message}`)
  }
  throw new Error(`${file.name}: formato no admitido (usa FIT, TCX o GPX)`)
}
