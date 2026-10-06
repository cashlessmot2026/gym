// Nutricionista IA: llama a la Edge Function "nutri-ai" (Claude, streaming).
// Si la función aún no está desplegada o no hay red, usa un motor local basado
// en guías ISSN/ACSM/OMS para que la app siga funcionando offline.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'
import { GOALS } from './constants'
import { ENDURANCE } from './fitness'

// ---------------- Fuentes oficiales y actualizaciones ----------------
export const OFFICIAL_SOURCES = [
  { name: 'ISSN · Position Stands (International Society of Sports Nutrition)', url: 'https://www.tandfonline.com/journals/rssn20' },
  { name: 'ACSM · Nutrition and Athletic Performance (posición conjunta)', url: 'https://pubmed.ncbi.nlm.nih.gov/26891166/' },
  { name: 'COI · Consenso sobre suplementos dietarios en atletas', url: 'https://pubmed.ncbi.nlm.nih.gov/29540367/' },
  { name: 'OMS · Alimentación sana', url: 'https://www.who.int/es/news-room/fact-sheets/detail/healthy-diet' },
  { name: 'ICBF Colombia · Guías Alimentarias (GABA)', url: 'https://www.icbf.gov.co/bienestar/nutricion/guias-alimentarias' },
  { name: 'AIS · Marco de suplementos deportivos ABCD', url: 'https://www.ais.gov.au/nutrition/supplements' }
]

let updatesCache = null
/** Publicaciones recientes de nutrición deportiva (PubMed/NIH), actualizadas cada semana por GitHub Actions. */
export async function nutritionUpdates() {
  if (updatesCache) return updatesCache
  try {
    // Primero la versión publicada (se actualiza cada semana, también para el APK); si no, la incluida en la app
    let r = await fetch('https://cashlessmot2026.github.io/gym/nutrition-updates.json', { cache: 'no-cache' }).catch(() => null)
    if (!r?.ok) r = await fetch(`${import.meta.env.BASE_URL}nutrition-updates.json`).catch(() => null)
    updatesCache = r?.ok ? await r.json() : { items: [] }
  } catch { updatesCache = { items: [] } }
  return updatesCache
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const looksBroken = (t) => !t.trim() || /^\s*\[Error IA/.test(t) || /^\s*\{"error"/.test(t)

async function streamText(res, onChunk) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    full += dec.decode(value, { stream: true })
    if (full.length > 40) {
      if (looksBroken(full.slice(0, 40))) throw new Error('Respuesta de error de la IA')
      onChunk(full)
    }
  }
  if (looksBroken(full) || full.includes('[Error IA:')) throw new Error('Respuesta de error de la IA')
  onChunk(full)
  return full
}

/** 1) Función del servidor: Gemini gratis (o Claude) con la clave guardada en Supabase. */
async function viaServer(body, onChunk) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/nutri-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body)
  })
  if (!res.ok || !res.body) throw new Error('IA del servidor no disponible')
  const provider = res.headers.get('x-provider') || 'ia'
  return { text: await streamText(res, onChunk), source: provider }
}

/** 2) IA gratuita sin clave (Pollinations). Se envían sólo datos ANÓNIMOS: sin nombre ni notas médicas. */
async function viaFreeAI({ profile, question, updates }, onChunk) {
  const anon = { ...profile }
  delete anon.full_name
  delete anon.medical_notes
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 45000)
  try {
    const res = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai',
        messages: [
          { role: 'system', content: 'Eres un nutricionista deportivo. Responde en español con títulos Markdown (##), listas y tablas cortas. Basa tus recomendaciones en ISSN, ACSM, COI, OMS y las Guías Alimentarias de Colombia (ICBF), usando alimentos colombianos. Termina con una línea "Fuentes:". No diagnostiques enfermedades.' + (updates?.length ? ' Publicaciones recientes a considerar: ' + updates.slice(0, 4).map((u) => u.title).join('; ') : '') },
          { role: 'user', content: `Perfil (anónimo): ${JSON.stringify(anon)}\n\nSolicitud: ${question}` }
        ]
      })
    })
    if (!res.ok) throw new Error('IA gratuita no disponible')
    const j = await res.json()
    const text = j?.choices?.[0]?.message?.content || ''
    if (looksBroken(text) || text.length < 80) throw new Error('Respuesta vacía')
    let shown = ''
    for (const w of text.split(/(\s+)/)) { shown += w; onChunk(shown); await sleep(4) }
    return { text, source: 'gratis' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Nutricionista: intenta 1) servidor (Gemini gratis / Claude), 2) IA gratuita sin clave,
 * 3) motor local basado en guías oficiales. onChunk recibe el texto acumulado (tiempo real).
 */
export async function askNutritionist({ profile, question, history = [] }, onChunk) {
  const updates = (await nutritionUpdates()).items || []
  try { return await viaServer({ profile, question, history, updates }, onChunk) } catch { /* siguiente proveedor */ }
  try { return await viaFreeAI({ profile, question, updates }, onChunk) } catch { /* siguiente proveedor */ }
  const text = localAdvice(profile, question, updates)
  let shown = ''
  for (const word of text.split(/(\s+)/)) { shown += word; onChunk(shown); await sleep(6) }
  return { text, source: 'local' }
}

const r5 = (n) => Math.round(n / 5) * 5

function mealPlan(kcal, goal) {
  const s = kcal / 2200
  const g = (n) => r5(n * s)
  const lean = goal === 'perder_grasa'
  return [
    ['Desayuno (7:00)', `${g(80)} g avena + ${lean ? 3 : 2} claras y 2 huevos + 1 fruta + café/té`, Math.round(kcal * 0.25)],
    ['Media mañana', `${g(170)} g yogur griego natural + ${g(20)} g frutos secos`, Math.round(kcal * 0.1)],
    ['Almuerzo', `${g(150)} g pollo/pescado/carne magra + ${g(lean ? 120 : 180)} g arroz o papa + ensalada libre + 1 cda aceite de oliva`, Math.round(kcal * 0.3)],
    ['Pre-entreno (60-90 min antes)', `1 plátano + ${g(40)} g pan integral con mantequilla de maní`, Math.round(kcal * 0.1)],
    ['Post-entreno', `${g(30)} g proteína (batido o 150 g atún) + ${g(lean ? 40 : 80)} g carbohidrato (arepa, arroz, frutas)`, Math.round(kcal * 0.1)],
    ['Cena', `${g(150)} g proteína magra + vegetales al vapor + ${g(lean ? 80 : 120)} g tubérculo o legumbre + ½ aguacate`, Math.round(kcal * 0.15)]
  ]
}

const MODE_TIPS = {
  'Musculación': 'Reparte la proteína en 4-5 tomas de 0.4 g/kg. Prioriza carbohidratos alrededor del entreno para rendir en las series.',
  'Cardio': 'En sesiones >60 min toma 30-60 g de carbohidratos por hora. Repón 1.5 L por cada kg perdido en sudor.',
  'Streetlifting': 'Controla el peso corporal (afecta tus dominadas y fondos): pequeñas variaciones de ±1 kg cambian tu rendimiento relativo.',
  'Powerlifting': 'Días pesados = más carbohidrato. Creatina monohidratada 3-5 g/día tiene la mayor evidencia para fuerza.',
  'Halterofilia': 'Carbohidratos de rápida absorción pre-sesión técnica; cuida la hidratación para mantener la coordinación.',
  'CrossFit / Funcional': 'WODs glucolíticos: no recortes carbohidratos drásticamente. Incluye sodio y potasio en días de mucho sudor.',
  'Calistenia': 'Una composición corporal magra mejora tu fuerza relativa; prioriza proteína y vegetales.',
  'HIIT': 'Entrena con 2-3 h de digestión o un snack ligero 45 min antes. Post-entreno: proteína + carbohidrato.',
  'Boxeo': 'Hidratación con electrolitos en rounds largos. Si das peso, nunca deshidratación extrema: planifica el corte con tiempo.',
  'Kickboxing / Muay Thai': 'Alto gasto calórico: añade 300-500 kcal en días de sparring. Antiinflamatorios naturales: pescado azul, frutos rojos.',
  'Spinning / Ciclismo indoor': 'Toma una fuente de carbohidrato antes de clase; tras ella, batido con proteína y fruta.',
  'Yoga': 'Practica con estómago ligero (2 h tras comida principal). Prioriza alimentos integrales y buena hidratación.',
  'Pilates': 'Comidas equilibradas; un snack ligero con proteína 1 h antes favorece el control del core.',
  'TRX / Suspensión': 'Proteína suficiente para recuperar el trabajo excéntrico y de estabilización.',
  'Movilidad y estiramiento': 'Colágeno + vitamina C 30-60 min antes puede apoyar tejidos conectivos.',
  'Baile / Zumba': 'Snack con carbohidrato antes de clase y agua abundante; ideal para gasto calórico sostenido.'
}

export function localAdvice(p = {}, question = '', updates = []) {
  const goal = GOALS.find((g) => g.id === p.goal) || GOALS[5]
  const kcal = p.target_kcal || 2200
  const modes = p.training_modes?.length ? p.training_modes : ['Musculación']
  const q = question.toLowerCase()
  const lines = []
  lines.push(`## 🍽️ Plan para ${p.full_name?.split(' ')[0] || 'ti'} — ${goal.label}`)
  lines.push(`Modalidades: **${modes.join(', ')}** · Objetivo calórico: **${kcal} kcal/día**`)
  if (p.protein_g) lines.push(`\n| Macro | Gramos | kcal |\n|---|---|---|\n| Proteína | ${p.protein_g} g | ${p.protein_g * 4} |\n| Carbohidratos | ${p.carbs_g} g | ${p.carbs_g * 4} |\n| Grasas | ${p.fat_g} g | ${p.fat_g * 9} |`)
  if (!q || /dieta|plan|menú|menu|comer|comida/.test(q)) {
    lines.push('\n## 📋 Menú tipo del día')
    lines.push('| Comida | Alimentos | kcal aprox. |\n|---|---|---|')
    for (const [m, f, k] of mealPlan(kcal, p.goal)) lines.push(`| ${m} | ${f} | ${k} |`)
  }
  lines.push('\n## 💡 Recomendaciones por modalidad')
  for (const m of modes) lines.push(`- **${m}:** ${MODE_TIPS[m] || 'Mantén una dieta equilibrada y adecuada a tu gasto.'}`)
  if (modes.length > 1) {
    const end = modes.filter((m) => ENDURANCE.includes(m))
    lines.push('\n## 🔁 Si combinas varias modalidades en el mes')
    lines.push(`- Días de fuerza (${modes.filter((m) => !end.includes(m)).join(', ') || '—'}): ~${Math.round(kcal * 1.05)} kcal, carbohidrato moderado-alto antes del entreno.`)
    lines.push(`- Días de resistencia/combate (${end.join(', ') || '—'}): ~${Math.round(kcal * 1.1)} kcal, +electrolitos y +carbohidrato durante.`)
    lines.push(`- Días de descanso: ~${Math.round(kcal * 0.9)} kcal, mantén la proteína y baja el carbohidrato.`)
  }
  lines.push('\n## 💧 Hidratación y suplementos con evidencia')
  lines.push(`- Agua: **${p.water_target || 2.5} L/día** + 500 ml por hora de entrenamiento.`)
  lines.push('- Creatina monohidratada 3-5 g/día (fuerza y potencia).')
  lines.push('- Cafeína 3 mg/kg 45 min antes (opcional, evita por la noche).')
  lines.push('- Vitamina D y omega-3 si tu consumo de pescado/sol es bajo (consulta a tu médico).')
  if (/hambre|ansiedad|antojo/.test(q)) lines.push('\n## 🥗 Control del hambre\n- Más volumen: verduras, sopas, frutas enteras.\n- Proteína en cada comida.\n- Duerme 7-9 h: el mal sueño aumenta el apetito.')
  if (/suplement/.test(q)) lines.push('\n> Los suplementos no sustituyen una dieta adecuada. Prioriza comida real.')
  if (p.medical_notes) lines.push(`\n> ⚠️ Tienes notas médicas registradas (${p.medical_notes}). Valida este plan con un profesional de la salud.`)
  if (updates.length) {
    lines.push('\n## 🔬 Lo más reciente en nutrición deportiva')
    for (const u of updates.slice(0, 4)) lines.push(`- ${u.title} (_${u.source}, ${u.date}_)`)
  }
  lines.push('\nFuentes: ' + OFFICIAL_SOURCES.map((f) => f.name.split(' · ')[0]).join(', ') + '.')
  lines.push('\n_Recomendaciones generadas con las guías oficiales (sin conexión a la IA)._')
  return lines.join('\n')
}
