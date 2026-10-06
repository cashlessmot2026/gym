import { useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'
import { GOALS, LEVELS } from '../../lib/constants'
import { Brand, Spinner } from '../../components/ui'

/** Antes de empezar: el cliente elige objetivo, modalidades y nivel. */
export default function Onboarding({ member, types, onSave, editing }) {
  const [step, setStep] = useState(0)
  const [goal, setGoal] = useState(member.goal || '')
  const [modes, setModes] = useState(member.training_modes || [])
  const [level, setLevel] = useState(member.level || 'principiante')
  const [busy, setBusy] = useState(false)
  const toggle = (n) => setModes((m) => (m.includes(n) ? m.filter((x) => x !== n) : [...m, n]))

  const finish = async () => {
    setBusy(true)
    try { await onSave({ goal, training_modes: modes, level, onboarded: true }) } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: editing ? 0 : '24px 16px 60px' }}>
      {!editing && <Brand sub="PRIMEROS PASOS" />}
      <div className="row mb" style={{ gap: 6 }}>
        {[0, 1, 2].map((i) => <div key={i} className="progress grow"><div style={{ width: step >= i ? '100%' : '0%' }} /></div>)}
      </div>

      {step === 0 && (
        <>
          <h1 className="page-title">¿CUÁL ES TU <span>OBJETIVO?</span></h1>
          <p className="muted">Hola {member.full_name.split(' ')[0]}, esto personaliza tu nutrición y tus recomendaciones.</p>
          <div className="grid g3 mt">
            {GOALS.map((g) => (
              <div key={g.id} className={`sel-card ${goal === g.id ? 'on' : ''}`} onClick={() => setGoal(g.id)}>
                <div className="em">{g.emoji}</div><div style={{ fontWeight: 800, marginTop: 6 }}>{g.label}</div><div className="small muted">{g.desc}</div>
              </div>
            ))}
          </div>
          <button className="btn primary lg mt2" disabled={!goal} onClick={() => setStep(1)}>Continuar <ArrowRight size={18} /></button>
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="page-title">MODO DE <span>ENTRENAMIENTO</span></h1>
          <p className="muted">Puedes elegir varias modalidades si vas a combinarlas en el mes.</p>
          <div className="grid g4 mt">
            {types.map((t) => (
              <div key={t.id} className={`sel-card ${modes.includes(t.name) ? 'on' : ''}`} onClick={() => toggle(t.name)}>
                <div className="row between"><div className="em">{t.emoji}</div>{modes.includes(t.name) && <Check className="y" />}</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>{t.name}</div><div className="tiny muted">{t.description}</div>
              </div>
            ))}
          </div>
          <div className="row mt2">
            <button className="btn ghost lg" onClick={() => setStep(0)}>Atrás</button>
            <button className="btn primary lg" disabled={!modes.length} onClick={() => setStep(2)}>Continuar <ArrowRight size={18} /></button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="page-title">TU <span>NIVEL</span></h1>
          <div className="grid g3 mt">
            {LEVELS.map((l) => (
              <div key={l} className={`sel-card ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
                <div className="em">{l === 'principiante' ? '🌱' : l === 'intermedio' ? '⚡' : '🔥'}</div>
                <div style={{ fontWeight: 800, marginTop: 6, textTransform: 'capitalize' }}>{l}</div>
              </div>
            ))}
          </div>
          <div className="row mt2">
            <button className="btn ghost lg" onClick={() => setStep(1)}>Atrás</button>
            <button className="btn primary lg" onClick={finish} disabled={busy}>{busy ? <Spinner /> : <Check size={18} />} {editing ? 'Guardar' : '¡Empezar!'}</button>
          </div>
        </>
      )}
    </div>
  )
}
