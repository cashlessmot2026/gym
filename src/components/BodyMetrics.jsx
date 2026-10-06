import { useEffect, useMemo, useState } from 'react'
import { Save, Scale, Ruler, Flame, Droplets, HeartPulse, Percent, Trash2 } from 'lucide-react'
import { supabase, q } from '../lib/supabase'
import { computeAll, bmiCategory, bodyFatCategory } from '../lib/fitness'
import { ACTIVITY, calcAge, fmtDate, today } from '../lib/constants'
import { Input, Select, Stat, useToast, Spinner, Empty } from './ui'

const NUM = ['weight', 'height', 'neck', 'chest', 'waist', 'hip', 'arm', 'thigh', 'calf', 'resting_hr', 'systolic', 'diastolic', 'water_l', 'sleep_h']

export default function BodyMetrics({ member, readOnly, onSaved }) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ date: today(), sex: member.sex || 'M', age: calcAge(member.birthdate) || '', activity_level: member.activity_level || 1.55 })

  const load = async () => {
    const r = await q(supabase.from('body_metrics').select('*').eq('member_id', member.id).order('date', { ascending: false }))
    setRows(r)
    if (r[0]) setF((x) => ({ ...x, height: r[0].height, weight: r[0].weight, neck: r[0].neck, waist: r[0].waist, hip: r[0].hip }))
  }
  useEffect(() => { load() }, [member.id])

  const c = useMemo(() => computeAll({ ...f, goal: member.goal, training_modes: member.training_modes }), [f, member])
  const cat = bmiCategory(c.bmi)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const save = async () => {
    if (!f.weight || !f.height) return toast('Peso y estatura son obligatorios', 'error')
    setBusy(true)
    try {
      const row = { member_id: member.id, date: f.date, sex: f.sex, age: Number(f.age) || null, activity_level: Number(f.activity_level), notes: f.notes || null }
      for (const k of NUM) row[k] = f[k] === '' || f[k] == null ? null : Number(f[k])
      for (const k of ['bmi', 'body_fat', 'lean_mass', 'whr', 'whtr', 'bmr', 'tdee', 'target_kcal', 'protein_g', 'carbs_g', 'fat_g']) row[k] = c[k] ?? null
      await q(supabase.from('body_metrics').insert(row))
      await q(supabase.from('members').update({ activity_level: row.activity_level, sex: row.sex }).eq('id', member.id))
      toast('Medidas guardadas', 'success')
      load(); onSaved?.()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const del = async (id) => { await q(supabase.from('body_metrics').delete().eq('id', id)); load() }

  return (
    <div className="col">
      <div className="grid g4">
        <Stat label="IMC" value={c.bmi ?? '—'} icon={Scale} y sub={cat.label} />
        <Stat label="% Grasa (US Navy)" value={c.body_fat != null ? c.body_fat + '%' : '—'} icon={Percent} sub={bodyFatCategory(c.body_fat, f.sex)} />
        <Stat label="TMB / TDEE" value={c.bmr ? `${c.bmr}` : '—'} icon={Flame} sub={c.tdee ? `Gasto total ${c.tdee} kcal` : 'Mifflin-St Jeor'} />
        <Stat label="Meta diaria" value={c.target_kcal ? c.target_kcal + ' kcal' : '—'} icon={Droplets} sub={c.water_target ? `Agua ${c.water_target} L` : ''} />
      </div>
      {c.protein_g && (
        <div className="card">
          <h3>Macronutrientes recomendados</h3>
          <div className="grid g3">
            {[['Proteína', c.protein_g, 4], ['Carbohidratos', c.carbs_g, 4], ['Grasas', c.fat_g, 9]].map(([n, g, k]) => (
              <div key={n}><div className="row between small"><b>{n}</b><span>{g} g · {g * k} kcal</span></div>
                <div className="progress mt"><div style={{ width: `${Math.min(100, (g * k / c.target_kcal) * 100)}%` }} /></div></div>
            ))}
          </div>
          <div className="row wrap mt small muted">
            {c.whr && <span>Cintura/cadera: <b className="y">{c.whr}</b></span>}
            {c.whtr && <span>Cintura/estatura: <b className={c.whtr < 0.5 ? 'ok' : 'warn'}>{c.whtr}</b></span>}
            {c.lean_mass && <span>Masa magra: <b className="y">{c.lean_mass} kg</b></span>}
            {c.hr_max && <span>FC máx. estimada: <b className="y">{c.hr_max} lpm</b></span>}
          </div>
        </div>
      )}
      {!readOnly && (
        <div className="card">
          <h3><Ruler size={16} className="y" /> Registrar medidas</h3>
          <div className="grid g4">
            <Input label="Fecha" type="date" value={f.date} onChange={set('date')} />
            <Select label="Sexo" value={f.sex} onChange={set('sex')} options={[{ value: 'M', label: 'Masculino' }, { value: 'F', label: 'Femenino' }]} />
            <Input label="Edad" type="number" value={f.age} onChange={set('age')} />
            <Select label="Actividad" value={f.activity_level} onChange={set('activity_level')} options={ACTIVITY.map((a) => ({ value: a.v, label: a.label }))} />
            <Input label="Peso (kg) *" type="number" step="0.1" value={f.weight} onChange={set('weight')} />
            <Input label="Estatura (cm) *" type="number" value={f.height} onChange={set('height')} />
            <Input label="Cuello (cm)" type="number" step="0.1" value={f.neck} onChange={set('neck')} />
            <Input label="Cintura (cm)" type="number" step="0.1" value={f.waist} onChange={set('waist')} />
            <Input label="Cadera (cm)" type="number" step="0.1" value={f.hip} onChange={set('hip')} />
            <Input label="Pecho (cm)" type="number" step="0.1" value={f.chest} onChange={set('chest')} />
            <Input label="Brazo (cm)" type="number" step="0.1" value={f.arm} onChange={set('arm')} />
            <Input label="Muslo (cm)" type="number" step="0.1" value={f.thigh} onChange={set('thigh')} />
            <Input label="Pantorrilla (cm)" type="number" step="0.1" value={f.calf} onChange={set('calf')} />
            <Input label="FC reposo (lpm)" type="number" value={f.resting_hr} onChange={set('resting_hr')} />
            <Input label="Presión sistólica" type="number" value={f.systolic} onChange={set('systolic')} />
            <Input label="Presión diastólica" type="number" value={f.diastolic} onChange={set('diastolic')} />
            <Input label="Agua (L/día)" type="number" step="0.1" value={f.water_l} onChange={set('water_l')} />
            <Input label="Sueño (h/noche)" type="number" step="0.5" value={f.sleep_h} onChange={set('sleep_h')} />
            <Input label="Notas" value={f.notes} onChange={set('notes')} span={2} />
          </div>
          <p className="tiny muted mt">Fórmulas: IMC y categorías OMS · TMB Mifflin-St Jeor · % grasa método US Navy (cuello, cintura{f.sex === 'F' ? ', cadera' : ''}) · proteína ISSN 1.6–2.2 g/kg.</p>
          <button className="btn primary mt" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={16} />} Guardar medidas</button>
        </div>
      )}
      <div className="card">
        <h3><HeartPulse size={16} className="y" /> Historial</h3>
        {rows.length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Fecha</th><th>Peso</th><th>IMC</th><th>% Grasa</th><th>Cintura</th><th>TDEE</th><th>FC rep.</th><th>PA</th>{!readOnly && <th />}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td>{fmtDate(r.date)}</td><td>{r.weight} kg</td><td><span style={{ color: bmiCategory(r.bmi).color }}>{r.bmi}</span></td><td>{r.body_fat ?? '—'}</td>
                <td>{r.waist ?? '—'}</td><td>{r.tdee ?? '—'}</td><td>{r.resting_hr ?? '—'}</td><td>{r.systolic ? `${r.systolic}/${r.diastolic}` : '—'}</td>
                {!readOnly && <td><button className="icon-btn" onClick={() => del(r.id)}><Trash2 size={15} /></button></td>}</tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>Aún no hay medidas registradas</Empty>}
      </div>
    </div>
  )
}
