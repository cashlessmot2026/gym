import { useEffect, useState } from 'react'
import { Plus, Trash2, ListPlus, Dumbbell, Save } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { assignRoutine } from '../../lib/data'
import { WEEKDAYS, WEEKDAYS_SHORT, fmtTime } from '../../lib/constants'
import { Modal, Input, Select, Field, Empty, Loading, useToast } from '../../components/ui'

export function WeekdayPicker({ value, onChange }) {
  const t = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort())
  return <div className="row wrap" style={{ gap: 6 }}>{WEEKDAYS_SHORT.map((d, i) => <button type="button" key={d} className={`chip ${value.includes(i) ? 'on' : ''}`} onClick={() => t(i)}>{d}</button>)}</div>
}

/** Editor semanal de ejercicios asignados a un cliente (memberId) o a un grupo (groupId). */
export default function AssignmentEditor({ memberId, groupId, exercises, routines, staffId }) {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [day, setDay] = useState(new Date().getDay())
  const [addEx, setAddEx] = useState(null)
  const [addRt, setAddRt] = useState(null)

  const load = async () => {
    const qy = supabase.from('assignments').select('*, exercise:exercises(*)').order('sort')
    setRows(await q(memberId ? qy.eq('member_id', memberId) : qy.eq('group_id', groupId)))
  }
  useEffect(() => { load() }, [memberId, groupId])

  const upd = async (id, patch) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    await q(supabase.from('assignments').update(patch).eq('id', id)).catch((e) => toast(e.message, 'error'))
  }
  const del = async (id) => { await q(supabase.from('assignments').delete().eq('id', id)); load() }
  const clearDay = async () => {
    if (!window.confirm(`¿Quitar todos los ejercicios del ${WEEKDAYS[day]}?`)) return
    const qy = supabase.from('assignments').delete().eq('weekday', day)
    await q(memberId ? qy.eq('member_id', memberId) : qy.eq('group_id', groupId)); load()
  }

  const saveEx = async () => {
    const ex = exercises.find((e) => e.id === addEx.exercise_id)
    if (!ex || !addEx.days.length) return toast('Elige ejercicio y al menos un día', 'error')
    const base = rows.filter((r) => addEx.days.includes(r.weekday)).length
    await q(supabase.from('assignments').insert(addEx.days.map((d, i) => ({
      member_id: memberId || null, group_id: groupId || null, exercise_id: ex.id, weekday: d,
      sets: Number(addEx.sets), reps: Number(addEx.reps), work_sec: Number(addEx.work_sec), rest_sec: Number(addEx.rest_sec),
      weight: addEx.weight ? Number(addEx.weight) : null, notes: addEx.notes || null, sort: base + i, created_by: staffId
    }))))
    toast(groupId ? 'Ejercicio cargado a todo el grupo' : 'Ejercicio asignado', 'success')
    setAddEx(null); load()
  }
  const saveRt = async () => {
    const r = routines.find((x) => x.id === addRt.routine_id)
    if (!r || !addRt.days.length) return toast('Elige rutina y al menos un día', 'error')
    await assignRoutine({ routine: r, memberId, groupId, weekdays: addRt.days, staffId })
    toast(`Rutina "${r.name}" asignada`, 'success'); setAddRt(null); load()
  }

  if (!rows) return <Loading />
  const dayRows = rows.filter((r) => r.weekday === day)
  const grouped = dayRows.reduce((g, r) => ({ ...g, [r.exercise?.muscle_group || 'Otro']: [...(g[r.exercise?.muscle_group || 'Otro'] || []), r] }), {})
  const pickEx = (id) => {
    const e = exercises.find((x) => x.id === id)
    setAddEx((a) => ({ ...a, exercise_id: id, sets: e?.default_sets ?? 4, reps: e?.default_reps ?? 12, work_sec: e?.default_work_sec ?? 45, rest_sec: e?.default_rest_sec ?? 60 }))
  }

  return (
    <div className="col">
      <div className="days">
        {WEEKDAYS_SHORT.map((d, i) => {
          const n = rows.filter((r) => r.weekday === i).length
          return <div key={d} className={`day ${day === i ? 'on' : ''} ${n ? 'has' : ''}`} onClick={() => setDay(i)}><div className="dn">{d}</div><div className="dc">{n}</div></div>
        })}
      </div>
      <div className="row between wrap">
        <h3 className="display" style={{ fontSize: '1.6rem', margin: 0 }}>{WEEKDAYS[day].toUpperCase()}</h3>
        <div className="row wrap">
          {dayRows.length > 0 && <button className="btn sm danger" onClick={clearDay}><Trash2 size={14} /> Vaciar día</button>}
          <button className="btn sm" onClick={() => setAddRt({ routine_id: routines[0]?.id, days: [day] })} disabled={!routines.length}><ListPlus size={14} /> Asignar rutina</button>
          <button className="btn sm primary" onClick={() => { setAddEx({ days: [day] }); }}><Plus size={14} /> Asignar ejercicio</button>
        </div>
      </div>
      {!dayRows.length && <Empty>Sin ejercicios para este día.</Empty>}
      {Object.entries(grouped).map(([g, list]) => (
        <div key={g}>
          <div className="group-h y" style={{ fontSize: '1.1rem' }}>{g}</div>
          <div className="col" style={{ gap: 8 }}>
            {list.map((r) => (
              <div key={r.id} className="ex" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <div className="ex-img"><Dumbbell size={20} /></div>
                <div style={{ minWidth: 140, fontWeight: 700 }} className="grow">{r.exercise?.name}{r.routine_id && <div className="tiny muted">de rutina</div>}</div>
                {[['sets', 'Series'], ['reps', 'Reps'], ['work_sec', 'Trabajo s'], ['rest_sec', 'Desc. s'], ['weight', 'Kg']].map(([k, l]) => (
                  <div key={k} className="field" style={{ width: 78 }}><label className="tiny">{l}</label>
                    <input className="input" style={{ padding: '6px 8px' }} type="number" defaultValue={r[k] ?? ''} onBlur={(e) => upd(r.id, { [k]: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                ))}
                <button className="icon-btn" onClick={() => del(r.id)}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {addEx && (
        <Modal title="Asignar ejercicio" onClose={() => setAddEx(null)} footer={<button className="btn primary" onClick={saveEx}><Save size={16} /> Asignar</button>}>
          <div className="col">
            <Select label="Ejercicio" value={addEx.exercise_id || ''} onChange={(e) => pickEx(e.target.value)}
              options={[{ value: '', label: '— Selecciona —' }, ...exercises.map((e) => ({ value: e.id, label: `${e.muscle_group} · ${e.name}` }))]} />
            <div className="grid g4">
              <Input label="Series" type="number" value={addEx.sets} onChange={(e) => setAddEx({ ...addEx, sets: e.target.value })} />
              <Input label="Repeticiones" type="number" value={addEx.reps} onChange={(e) => setAddEx({ ...addEx, reps: e.target.value })} />
              <Input label="Trabajo (seg)" type="number" value={addEx.work_sec} onChange={(e) => setAddEx({ ...addEx, work_sec: e.target.value })} />
              <Input label="Descanso (seg)" type="number" value={addEx.rest_sec} onChange={(e) => setAddEx({ ...addEx, rest_sec: e.target.value })} />
            </div>
            <div className="grid g2">
              <Input label="Peso sugerido (kg)" type="number" value={addEx.weight} onChange={(e) => setAddEx({ ...addEx, weight: e.target.value })} />
              <Input label="Notas para el cliente" value={addEx.notes} onChange={(e) => setAddEx({ ...addEx, notes: e.target.value })} />
            </div>
            <Field label="Días de la semana"><WeekdayPicker value={addEx.days} onChange={(days) => setAddEx({ ...addEx, days })} /></Field>
            {addEx.work_sec && <p className="tiny muted">Duración estimada: {fmtTime(addEx.sets * (Number(addEx.work_sec) + Number(addEx.rest_sec)))}</p>}
          </div>
        </Modal>
      )}
      {addRt && (
        <Modal title="Asignar rutina" onClose={() => setAddRt(null)} footer={<button className="btn primary" onClick={saveRt}><Save size={16} /> Asignar</button>}>
          <div className="col">
            <Select label="Rutina" value={addRt.routine_id} onChange={(e) => setAddRt({ ...addRt, routine_id: e.target.value })} options={routines.map((r) => ({ value: r.id, label: `${r.name} (${r.items.length} ejercicios)` }))} />
            <Field label="Días de la semana"><WeekdayPicker value={addRt.days} onChange={(days) => setAddRt({ ...addRt, days })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  )
}
