// Fórmulas de referencia:
// - IMC y categorías: OMS (WHO) / NHLBI
// - TMB: Mifflin-St Jeor (1990), la más precisa para población general
// - TDEE: TMB × factor de actividad
// - % grasa: método de la Marina de EE.UU. (US Navy), ±3-4%
// - Índice cintura/cadera (OMS) y cintura/estatura (<0.5 saludable)
// - Proteína: ISSN 1.6–2.2 g/kg (fuerza), 1.2–1.6 g/kg (resistencia)
import { GOALS } from './constants'

export function bmi(weight, heightCm) {
  if (!weight || !heightCm) return null
  const m = heightCm / 100
  return +(weight / (m * m)).toFixed(1)
}

export function bmiCategory(v) {
  if (v == null) return { label: '—', color: '#888' }
  if (v < 18.5) return { label: 'Bajo peso', color: '#60a5fa' }
  if (v < 25) return { label: 'Normal', color: '#22c55e' }
  if (v < 30) return { label: 'Sobrepeso', color: '#FFD60A' }
  if (v < 35) return { label: 'Obesidad I', color: '#fb923c' }
  if (v < 40) return { label: 'Obesidad II', color: '#f97316' }
  return { label: 'Obesidad III', color: '#ef4444' }
}

export function bmr({ weight, height, age, sex }) {
  if (!weight || !height || !age) return null
  return Math.round(10 * weight + 6.25 * height - 5 * age + (sex === 'F' ? -161 : 5))
}

export function navyBodyFat({ sex, height, waist, neck, hip }) {
  if (!height || !waist || !neck) return null
  const l = Math.log10
  let bf
  if (sex === 'F') {
    if (!hip) return null
    bf = 495 / (1.29579 - 0.35004 * l(waist + hip - neck) + 0.221 * l(height)) - 450
  } else {
    if (waist - neck <= 0) return null
    bf = 495 / (1.0324 - 0.19077 * l(waist - neck) + 0.15456 * l(height)) - 450
  }
  return Number.isFinite(bf) ? +Math.max(2, Math.min(60, bf)).toFixed(1) : null
}

export function bodyFatCategory(bf, sex) {
  if (bf == null) return '—'
  const r = sex === 'F' ? [14, 21, 25, 32] : [6, 14, 18, 25]
  if (bf < r[0]) return 'Esencial'
  if (bf < r[1]) return 'Atleta'
  if (bf < r[2]) return 'Fitness'
  if (bf < r[3]) return 'Promedio'
  return 'Alto'
}

export const ENDURANCE = ['Cardio', 'HIIT', 'Boxeo', 'Kickboxing / Muay Thai', 'Spinning / Ciclismo indoor', 'Baile / Zumba', 'CrossFit / Funcional']

/** Calcula todas las métricas derivadas a partir de los datos crudos. */
export function computeAll(d) {
  const n = (k) => (d[k] === '' || d[k] == null ? null : Number(d[k]))
  const x = { ...d, weight: n('weight'), height: n('height'), age: n('age'), waist: n('waist'), neck: n('neck'), hip: n('hip') }
  const out = {}
  out.bmi = bmi(x.weight, x.height)
  out.bmr = bmr(x)
  out.tdee = out.bmr ? Math.round(out.bmr * (Number(d.activity_level) || 1.55)) : null
  out.body_fat = navyBodyFat(x)
  out.lean_mass = out.body_fat != null && x.weight ? +(x.weight * (1 - out.body_fat / 100)).toFixed(1) : null
  out.whr = x.waist && x.hip ? +(x.waist / x.hip).toFixed(2) : null
  out.whtr = x.waist && x.height ? +(x.waist / x.height).toFixed(2) : null
  const goal = GOALS.find((g) => g.id === d.goal) || GOALS[5]
  out.target_kcal = out.tdee ? Math.round(out.tdee * (1 + goal.kcal)) : null
  const modes = d.training_modes || []
  const endurance = modes.some((m) => ENDURANCE.includes(m))
  const strength = modes.some((m) => !ENDURANCE.includes(m))
  let pk = 1.6
  if (['hipertrofia', 'fuerza', 'recomposicion'].includes(d.goal)) pk = 2.0
  else if (d.goal === 'perder_grasa') pk = 2.2
  else if (endurance && !strength) pk = 1.4
  if (x.weight && out.target_kcal) {
    out.protein_g = Math.round(x.weight * pk)
    out.fat_g = Math.round((out.target_kcal * 0.27) / 9)
    out.carbs_g = Math.max(0, Math.round((out.target_kcal - out.protein_g * 4 - out.fat_g * 9) / 4))
  }
  out.water_target = x.weight ? +(x.weight * 0.035 + 0.5).toFixed(1) : null
  if (x.age) out.hr_max = 220 - x.age
  return out
}

/** Calorías estimadas por MET: kcal = MET × kg × horas */
export const kcalFromMet = (met, kg, sec) => Math.round((met || 5) * (kg || 70) * (sec / 3600))
