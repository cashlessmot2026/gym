import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Send, FileDown, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { supabase, q } from '../lib/supabase'
import { askNutritionist, nutritionUpdates, OFFICIAL_SOURCES } from '../lib/nutrition'
import { computeAll } from '../lib/fitness'
import { GOALS, calcAge } from '../lib/constants'
import { nutritionPdf } from '../lib/pdf'
import { Markdown, Spinner, useToast } from './ui'

const PROMPTS = [
  ['🍽️ Dieta del día', 'Dame un plan de alimentación detallado para hoy con cantidades y horarios.'],
  ['📅 Plan semanal', 'Crea un plan de comidas para 7 días (tabla por día) adaptado a mi objetivo y mis modalidades.'],
  ['⚡ Pre y post entreno', '¿Qué debo comer antes y después de entrenar según mis modalidades?'],
  ['🔁 Varias modalidades en el mes', 'Voy a entrenar varias modalidades este mes. Organiza mi alimentación por tipo de día (fuerza, cardio/combate, descanso).'],
  ['🛒 Lista de compras', 'Genera una lista de compras semanal económica para mi plan.'],
  ['💊 Suplementación', '¿Qué suplementos con evidencia científica me recomiendas y en qué dosis?']
]

export default function NutritionAI({ member }) {
  const [metric, setMetric] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState(null)
  const endRef = useRef(null)

  useEffect(() => {
    q(supabase.from('body_metrics').select('*').eq('member_id', member.id).order('date', { ascending: false }).limit(1)).then((r) => setMetric(r[0] || null))
  }, [member.id])

  const profile = useMemo(() => {
    const base = { sex: member.sex, age: metric?.age || calcAge(member.birthdate), weight: metric?.weight, height: metric?.height, waist: metric?.waist, neck: metric?.neck, hip: metric?.hip, activity_level: metric?.activity_level || member.activity_level, goal: member.goal, training_modes: member.training_modes }
    const c = computeAll(base)
    return {
      full_name: member.full_name, ...base, ...c,
      goal_label: GOALS.find((g) => g.id === member.goal)?.label, level: member.level, medical_notes: member.medical_notes
    }
  }, [member, metric])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs])

  const ask = async (question) => {
    if (!question.trim() || busy) return
    setBusy(true); setInput('')
    const history = msgs.map((m) => ({ role: m.role, content: m.text }))
    setMsgs((x) => [...x, { role: 'user', text: question }, { role: 'assistant', text: '' }])
    const res = await askNutritionist({ profile, question, history }, (t) =>
      setMsgs((x) => { const c = [...x]; c[c.length - 1] = { role: 'assistant', text: t }; return c }))
    setSource(res.source)
    setBusy(false)
  }

  const lastAnswer = [...msgs].reverse().find((m) => m.role === 'assistant' && m.text)
  const toast = useToast()
  const makePdf = async (opts) => {
    try { await nutritionPdf(opts); toast('PDF generado', 'success') }
    catch (e) { console.error('[pdf]', e); toast('No se pudo generar el PDF: ' + (e?.message || e), 'error') }
  }
  const pdfAll = () => makePdf({
    title: 'Plan de nutrición y recomendaciones', member, metrics: profile,
    markdown: msgs.filter((m) => m.role === 'assistant').map((m) => m.text).join('\n\n')
  })
  const pdfLast = () => makePdf({ title: 'Recomendación nutricional', member, metrics: profile, markdown: lastAnswer.text })

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, minWidth: 0 }}>
      <div className="card hl">
        <div className="row between wrap">
          <div className="row"><div className="brand-logo"><Bot size={22} /></div>
            <div><div className="display" style={{ fontSize: '1.6rem' }}>NUTRICOACH <span className="y">IA</span></div>
              <div className="tiny muted">Consejos en tiempo real según tu objetivo ({profile.goal_label || 'sin definir'}) y modalidades ({(member.training_modes || []).join(', ') || '—'})</div></div></div>
          <div className="row wrap">
            {source && <span className={`badge ${source === 'local' ? 'warn' : 'ok'}`}>{source === 'local' ? <><WifiOff size={12} /> Guías oficiales (sin IA)</> : <><Wifi size={12} /> {{ gemini: 'IA Gemini', claude: 'IA Claude', gratis: 'IA gratuita' }[source] || 'IA en línea'}</>}</span>}
            <button className="btn sm" disabled={!lastAnswer} onClick={pdfLast}><FileDown size={14} /> PDF última</button>
            <button className="btn sm primary" disabled={!lastAnswer} onClick={pdfAll}><FileDown size={14} /> PDF completo</button>
          </div>
        </div>
        {!metric && <p className="tiny warn mt">Registra tu peso y estatura en la pestaña "Medidas" para recibir cantidades exactas.</p>}
        <div className="row wrap mt">
          {PROMPTS.map(([l, p]) => <button key={l} className="chip" disabled={busy} onClick={() => ask(p)}>{l}</button>)}
        </div>
      </div>

      <div className="card" style={{ minHeight: 320, maxHeight: '62vh', overflowY: 'auto' }}>
        {!msgs.length && (
          <div className="empty"><Sparkles className="y" size={32} /><p>Elige una sugerencia o escribe tu pregunta: dietas, recetas, timing, suplementos, hidratación…</p></div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', margin: '10px 0' }}>
            <div style={{ maxWidth: m.role === 'user' ? '80%' : '100%', background: m.role === 'user' ? 'var(--y)' : 'var(--card2)', color: m.role === 'user' ? '#000' : 'inherit', borderRadius: 16, padding: '10px 14px', fontWeight: m.role === 'user' ? 600 : 400 }}>
              {m.role === 'user' ? m.text : m.text ? <Markdown text={m.text} /> : <span className="muted"><Spinner size={14} /> Pensando…</span>}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <SourcesPanel />

      <form className="row" onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        <input className="input" placeholder="Pregúntale a tu nutricionista…" value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn primary" disabled={busy || !input.trim()}>{busy ? <Spinner /> : <Send size={16} />}</button>
      </form>
    </div>
  )
}

/** Fuentes oficiales y publicaciones recientes (PubMed), actualizadas automáticamente cada semana. */
function SourcesPanel() {
  const [u, setU] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { nutritionUpdates().then(setU) }, [])
  return (
    <div className="card">
      <button type="button" className="row between" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }} onClick={() => setOpen(!open)}>
        <b className="small">📚 Fuentes oficiales y novedades científicas</b>
        <span className="tiny muted">{u?.updated ? `Actualizado ${new Date(u.updated).toLocaleDateString('es')}` : ''} {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="grid g2 mt">
          <div>
            <div className="tiny muted mb">Guías en las que se basa el nutricionista:</div>
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{OFFICIAL_SOURCES.map((f) => <li key={f.url}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a></li>)}</ul>
          </div>
          <div>
            <div className="tiny muted mb">Publicaciones recientes (PubMed · NIH):</div>
            {u?.items?.length ? (
              <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>{u.items.slice(0, 8).map((i) => <li key={i.url}><a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> <span className="tiny muted">· {i.source}, {i.date}</span></li>)}</ul>
            ) : <div className="tiny muted">Sin novedades cargadas todavía.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
