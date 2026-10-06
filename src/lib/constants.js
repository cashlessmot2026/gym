export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const WEEKDAYS_SHORT = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB']

export const MUSCLE_GROUPS = ['Pecho', 'Espalda', 'Hombros', 'Brazos', 'Piernas', 'Glúteos', 'Pantorrillas', 'Abdomen', 'Cardio', 'Cuerpo completo', 'Movilidad']

export const GOALS = [
  { id: 'perder_grasa', label: 'Perder grasa', emoji: '🔥', kcal: -0.2, desc: 'Déficit calórico moderado y alto gasto' },
  { id: 'hipertrofia', label: 'Ganar masa muscular', emoji: '💪', kcal: 0.1, desc: 'Superávit ligero y fuerza progresiva' },
  { id: 'fuerza', label: 'Ganar fuerza', emoji: '🏋️', kcal: 0.05, desc: 'Cargas altas y pocas repeticiones' },
  { id: 'resistencia', label: 'Mejorar resistencia', emoji: '🫀', kcal: 0, desc: 'Capacidad aeróbica y anaeróbica' },
  { id: 'recomposicion', label: 'Recomposición', emoji: '⚖️', kcal: -0.05, desc: 'Perder grasa y ganar músculo' },
  { id: 'salud', label: 'Salud y bienestar', emoji: '🌱', kcal: 0, desc: 'Movilidad, energía y hábitos' },
  { id: 'competicion', label: 'Preparación para competir', emoji: '🏆', kcal: 0, desc: 'Rendimiento específico del deporte' }
]

export const LEVELS = ['principiante', 'intermedio', 'avanzado']

/** Factores de actividad (Mifflin-St Jeor × factor = TDEE) */
export const ACTIVITY = [
  { v: 1.2, label: 'Sedentario (sin ejercicio)' },
  { v: 1.375, label: 'Ligero (1-3 días/sem)' },
  { v: 1.55, label: 'Moderado (3-5 días/sem)' },
  { v: 1.725, label: 'Muy activo (6-7 días/sem)' },
  { v: 1.9, label: 'Extremo (atleta / trabajo físico)' }
]

export const fmtTime = (s) => {
  s = Math.max(0, Math.round(s || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0')
}
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
export const addDays = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
export const calcAge = (birth) => birth ? Math.floor((Date.now() - new Date(birth)) / 31557600000) : null
export const money = (n) => '$' + Number(n || 0).toLocaleString('es', { maximumFractionDigits: 2 })
