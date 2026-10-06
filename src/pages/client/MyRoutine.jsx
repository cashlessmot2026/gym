import { useEffect, useMemo, useState } from 'react'
import { Plus, Check, Save, Search } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { MUSCLE_GROUPS } from '../../lib/constants'
import { MUSCLE_CATALOG } from '../../lib/muscleCatalog'
import { WeekdayPicker } from '../coach/AssignmentEditor'
import { Modal, Input, Field, Loading, Spinner, useToast } from '../../components/ui'

const key = (g, n) => `${g}|${n.trim().toLowerCase()}`

/** Rutina propia: el cliente sin coach elige días y ejercicios por grupo muscular. */
export function AddOwnExercises({ member, defaultDay, existingCount, onClose, onSaved }) {
  const toast = useToast()
  const [days, setDays] = useState([defaultDay])
  const [group, setGroup] = useState(MUSCLE_GROUPS[0])
  const [db, setDb] = useState(null)               // ejercicios ya existentes en la base
  const [picked, setPicked] = useState(new Map())  // key -> { group, name }
  const [term, setTerm] = useState('')
  const [custom, setCustom] = useState('')
  const [cfg, setCfg] = useState({ sets: 4, reps: 12, work_sec: 45, rest_sec: 60 })
  const [saving, setSaving] = useState(false)

  useEffect(() => { q(supabase.from('exercises').select('id, name, muscle_group, default_sets, default_reps, default_work_sec, default_rest_sec')).then(setDb).catch((e) => { toast(e.message, 'error'); setDb([]) }) }, [])

  // Catálogo base + ejercicios de la base (sin repetir)
  const options = useMemo(() => {
    const names = new Map()
    for (const n of MUSCLE_CATALOG[group] || []) names.set(n.toLowerCase(), n)
    for (const e of (db || []).filter((x) => x.muscle_group === group)) names.set(e.name.toLowerCase(), e.name)
    for (const p of picked.values()) if (p.group === group) names.set(p.name.toLowerCase(), p.name)
    const t = term.trim().toLowerCase()
    return [...names.values()].filter((n) => !t || n.toLowerCase().includes(t))
  }, [group, db, term, picked])

  const toggle = (name) => setPicked((m) => {
    const n = new Map(m); const k = key(group, name)
    n.has(k) ? n.delete(k) : n.set(k, { group, name }); return n
  })
  const addCustom = () => {
    const name = custom.trim(); if (!name) return
    setPicked((m) => new Map(m).set(key(group, name), { group, name })); setCustom('')
  }
  const countIn = (g) => [...picked.values()].filter((p) => p.group === g).length

  const save = async () => {
    if (!days.length) return toast('Elige al menos un día', 'error')
    if (!picked.size) return toast('Elige al menos un ejercicio', 'error')
    setSaving(true)
    try {
      const ids = []
      for (const p of picked.values()) {
        let ex = db.find((e) => e.muscle_group === p.group && e.name.toLowerCase() === p.name.toLowerCase())
        if (!ex) {
          ex = (await q(supabase.from('exercises').insert({ name: p.name, muscle_group: p.group, training_type: member.training_modes?.[0] || null,
            default_sets: Number(cfg.sets), default_reps: Number(cfg.reps), default_work_sec: Number(cfg.work_sec), default_rest_sec: Number(cfg.rest_sec) }).select()))[0]
        }
        ids.push(ex.id)
      }
      const rows = []
      days.forEach((d) => ids.forEach((id, i) => rows.push({
        member_id: member.id, exercise_id: id, weekday: d,
        sets: Number(cfg.sets), reps: Number(cfg.reps), work_sec: Number(cfg.work_sec), rest_sec: Number(cfg.rest_sec),
        sort: existingCount + i, created_by: null
      })))
      await q(supabase.from('assignments').insert(rows))
      toast(`${ids.length} ejercicio${ids.length > 1 ? 's' : ''} agregado${ids.length > 1 ? 's' : ''} a tu rutina`, 'success')
      onSaved()
    } catch (e) { toast(e.message, 'error'); setSaving(false) }
  }

  return (
    <Modal title="Armar mi rutina" onClose={onClose} wide
      footer={<button className="btn primary" onClick={save} disabled={saving}>{saving ? <Spinner size={16} /> : <Save size={16} />} Agregar {picked.size || ''} ejercicio{picked.size === 1 ? '' : 's'}</button>}>
      <div className="col">
        <Field label="1. Días de la semana"><WeekdayPicker value={days} onChange={setDays} /></Field>

        <Field label="2. Grupo muscular">
          <div className="row wrap" style={{ gap: 6 }}>
            {MUSCLE_GROUPS.map((g) => <button type="button" key={g} className={`chip ${g === group ? 'on' : ''}`} onClick={() => { setGroup(g); setTerm('') }}>{g}{countIn(g) > 0 && ` · ${countIn(g)}`}</button>)}
          </div>
        </Field>

        <Field label={`3. Ejercicios de ${group}`}>
          <div className="row mb" style={{ gap: 6 }}><Search size={16} className="muted" /><input className="input" placeholder="Buscar…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
          {!db ? <Loading /> : (
            <div className="grid auto" style={{ gap: 8 }}>
              {options.map((n) => {
                const on = picked.has(key(group, n))
                return (
                  <button type="button" key={n} className={`ex ${on ? 'done' : ''}`} style={{ textAlign: 'left' }} onClick={() => toggle(n)}>
                    <div className="grow" style={{ fontWeight: 700 }}>{n}</div>
                    {on ? <Check className="ok" size={18} /> : <Plus size={16} className="muted" />}
                  </button>
                )
              })}
              {!options.length && <div className="muted small">Sin resultados. Crea tu propio ejercicio abajo.</div>}
            </div>
          )}
          <div className="row mt" style={{ gap: 6 }}>
            <input className="input grow" placeholder={`Mi propio ejercicio de ${group}…`} value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom()} />
            <button type="button" className="btn" onClick={addCustom}><Plus size={16} /> Crear</button>
          </div>
        </Field>

        <Field label="4. Series y tiempos (para todos los elegidos)">
          <div className="grid g4">
            <Input label="Series" type="number" min="1" value={cfg.sets} onChange={(e) => setCfg({ ...cfg, sets: e.target.value })} />
            <Input label="Repeticiones" type="number" min="1" value={cfg.reps} onChange={(e) => setCfg({ ...cfg, reps: e.target.value })} />
            <Input label="Trabajo (seg)" type="number" min="5" value={cfg.work_sec} onChange={(e) => setCfg({ ...cfg, work_sec: e.target.value })} />
            <Input label="Descanso (seg)" type="number" min="0" value={cfg.rest_sec} onChange={(e) => setCfg({ ...cfg, rest_sec: e.target.value })} />
          </div>
        </Field>
        {picked.size > 0 && <p className="tiny muted">Elegidos: {[...picked.values()].map((p) => p.name).join(' · ')}</p>}
      </div>
    </Modal>
  )
}

/** Edita series/reps/peso de un ejercicio propio. */
export function EditOwnExercise({ item, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ sets: item.sets, reps: item.reps, work_sec: item.work_sec, rest_sec: item.rest_sec, weight: item.weight ?? '' })
  const save = async () => {
    try {
      await q(supabase.from('assignments').update({ sets: Number(f.sets), reps: Number(f.reps), work_sec: Number(f.work_sec), rest_sec: Number(f.rest_sec), weight: f.weight === '' ? null : Number(f.weight) }).eq('id', item.id))
      onSaved()
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Modal title={item.exercise?.name} onClose={onClose} footer={<button className="btn primary" onClick={save}><Save size={16} /> Guardar</button>}>
      <div className="grid g2">
        <Input label="Series" type="number" value={f.sets} onChange={(e) => setF({ ...f, sets: e.target.value })} />
        <Input label="Repeticiones" type="number" value={f.reps} onChange={(e) => setF({ ...f, reps: e.target.value })} />
        <Input label="Trabajo (seg)" type="number" value={f.work_sec} onChange={(e) => setF({ ...f, work_sec: e.target.value })} />
        <Input label="Descanso (seg)" type="number" value={f.rest_sec} onChange={(e) => setF({ ...f, rest_sec: e.target.value })} />
        <Input label="Peso (kg)" type="number" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} />
      </div>
    </Modal>
  )
}
