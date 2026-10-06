// Biblioteca de ejercicios en línea: API pública de wger.de (open source, sin clave)
// + catálogo curado para modalidades que wger no cubre (boxeo, yoga, pilates...).
const WGER = 'https://wger.de/api/v2'

export const WGER_CATEGORIES = {
  8: 'Brazos', 9: 'Piernas', 10: 'Abdomen', 11: 'Pecho', 12: 'Espalda', 13: 'Hombros', 14: 'Pantorrillas', 15: 'Cardio'
}
export const MUSCLE_TO_WGER = { Brazos: 8, Piernas: 9, Glúteos: 9, Abdomen: 10, Pecho: 11, Espalda: 12, Hombros: 13, Pantorrillas: 14, Cardio: 15 }

const strip = (html) => (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const cache = new Map()

export async function fetchWger(categoryId, { limit = 40 } = {}) {
  const key = `${categoryId}-${limit}`
  if (cache.has(key)) return cache.get(key)
  const res = await fetch(`${WGER}/exerciseinfo/?category=${categoryId}&limit=${limit}`)
  if (!res.ok) throw new Error('No se pudo consultar la biblioteca en línea')
  const json = await res.json()
  const list = json.results.map((ex) => {
    const tr = ex.translations?.find((t) => t.language === 4) || ex.translations?.find((t) => t.language === 2)
    if (!tr?.name) return null
    return {
      id: 'wger-' + ex.id,
      name: tr.name,
      description: strip(tr.description).slice(0, 400),
      muscle_group: WGER_CATEGORIES[ex.category?.id] || ex.category?.name,
      muscles: (ex.muscles || []).map((m) => m.name_en || m.name).filter(Boolean),
      equipment: (ex.equipment || []).map((e) => e.name),
      image_url: ex.images?.find((i) => i.is_main)?.image || ex.images?.[0]?.image || null,
      lang: tr.language === 4 ? 'es' : 'en',
      source: 'wger.de'
    }
  }).filter(Boolean)
  list.sort((a, b) => (b.lang === 'es') - (a.lang === 'es') || (!!b.image_url) - (!!a.image_url))
  cache.set(key, list)
  return list
}

export const videoSearch = (name) => `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' técnica correcta')}`

/** Catálogo curado por modalidad (ejercicios de referencia ampliamente usados). */
export const CURATED = {
  'Musculación': ['Press banca', 'Sentadilla con barra', 'Remo con barra', 'Press militar', 'Jalón al pecho', 'Prensa de piernas', 'Curl femoral', 'Hip thrust', 'Curl de bíceps', 'Extensión de tríceps'],
  'Cardio': ['Trote en cinta', 'Bicicleta estática', 'Elíptica', 'Remo ergómetro', 'Escaladora', 'Caminata inclinada', 'Air bike', 'Salto de cuerda'],
  'Streetlifting': ['Dominadas lastradas', 'Fondos lastrados', 'Muscle-up', 'Sentadilla con barra', 'Dominadas supinas', 'Fondos en paralelas', 'Dead hang', 'Remo australiano'],
  'Powerlifting': ['Sentadilla trasera', 'Press banca competición', 'Peso muerto convencional', 'Peso muerto sumo', 'Press banca con pausa', 'Sentadilla con pausa', 'Buenos días', 'Remo Pendlay'],
  'Halterofilia': ['Arranque', 'Envión (clean & jerk)', 'Cargada de potencia', 'Arranque colgante', 'Sentadilla frontal', 'Sentadilla overhead', 'Push press', 'Tirón de arranque'],
  'CrossFit / Funcional': ['Thrusters', 'Wall balls', 'Kettlebell swing', 'Box jumps', 'Burpees', 'Pull-ups kipping', 'Double unders', 'Toes to bar', 'Clean & jerk', 'Rowing'],
  'Calistenia': ['Flexiones', 'Dominadas', 'Fondos', 'Pistol squat', 'L-sit', 'Handstand', 'Front lever (progresión)', 'Planche (progresión)', 'Muscle-up', 'Hollow body'],
  'HIIT': ['Tabata burpees', 'Mountain climbers', 'Jumping jacks', 'Sprints', 'Sentadilla con salto', 'High knees', 'Skater jumps', 'Plancha con toques'],
  'Boxeo': ['Sombra (shadow boxing)', 'Saco pesado: jab-cruzado', 'Manoplas: combinaciones', 'Pera rápida', 'Saltar la cuerda', 'Esquivas y bloqueos', 'Uppercuts en saco', 'Trabajo de pies (footwork)'],
  'Kickboxing / Muay Thai': ['Patada circular (roundhouse)', 'Teep (patada frontal)', 'Rodillazos al saco', 'Codos', 'Clinch', 'Combinación jab-cruzado-patada', 'Sombra con patadas', 'Chequeo de patadas'],
  'Spinning / Ciclismo indoor': ['Llano a cadencia alta', 'Subida sentado', 'Subida de pie', 'Sprints 30/30', 'Intervalos en pirámide', 'Jumps (sube-baja)'],
  'Yoga': ['Saludo al sol', 'Perro boca abajo', 'Guerrero I', 'Guerrero II', 'Postura del árbol', 'Cobra', 'Postura del niño', 'Paloma'],
  'Pilates': ['The hundred', 'Roll up', 'Single leg stretch', 'Criss-cross', 'Swimming', 'Teaser', 'Puente de hombros', 'Side kick'],
  'TRX / Suspensión': ['Remo TRX', 'Flexiones TRX', 'Sentadilla TRX', 'Pike TRX', 'Curl de bíceps TRX', 'Zancada búlgara TRX', 'Y-fly TRX', 'Plancha TRX'],
  'Movilidad y estiramiento': ['Movilidad de cadera 90/90', 'Cat-camel', 'Rotaciones torácicas', 'Estiramiento de isquios', 'World greatest stretch', 'Movilidad de tobillo', 'Dislocaciones con banda', 'Foam roller'],
  'Baile / Zumba': ['Merengue básico', 'Salsa básico', 'Reggaetón step', 'Cumbia', 'Grapevine', 'Cha-cha-chá', 'Mambo', 'Rodillas arriba con ritmo']
}
