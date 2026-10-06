import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Users, CalendarClock, Save, Clock, MapPin, UserPlus, Search, X } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { WEEKDAYS, WEEKDAYS_SHORT } from '../../lib/constants'
import { hm, ymd, startAt, sessionState, STATE_LABEL } from '../../lib/classes'
import { PageTitle, Modal, Input, Select, Field, Empty, Loading, Avatar, Spinner, Tabs, useToast } from '../../components/ui'

const ORDER = [1, 2, 3, 4, 5, 6, 0] // semana empezando el lunes
const COLORS = ['#FFD60A', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#14b8a6']
const PRESETS = [['Lun-Vie', [1, 2, 3, 4, 5]], ['Lun-Sáb', [1, 2, 3, 4, 5, 6]], ['Toda la semana', [0, 1, 2, 3, 4, 5, 6]], ['L-M-V', [1, 3, 5]], ['M-J', [2, 4]]]

const loadAll = async () => {
  const [classes, schedules, members, roster, staff] = await Promise.all([
    q(supabase.from('gym_classes').select('*').order('name')),
    q(supabase.from('class_schedules').select('*').order('start_time')),
    q(supabase.from('members').select('id, full_name, photo, training_modes, active').eq('active', true).order('full_name')),
    q(supabase.from('class_members').select('*')),
    q(supabase.from('staff').select('id, full_name, role, active').eq('active', true).order('full_name'))
  ])
  return { classes, schedules, members, roster, staff }
}

/** Pestaña "Clases" del admin: calendario semanal, clases con horarios y grupos de clientes. */
export default function ClassesAdmin({ types }) {
  const toast = useToast()
  const [d, setD] = useState(null)
  const [view, setView] = useState('week')
  const [edit, setEdit] = useState(null)
  const [group, setGroup] = useState(null)
  const load = () => loadAll().then(setD).catch((e) => { toast(e.message.includes('gym_classes') ? 'Falta ejecutar supabase/04_clases.sql' : e.message, 'error'); setD({ classes: [], schedules: [], members: [], roster: [], staff: [] }) })
  useEffect(() => { load() }, [])

  if (!d) return <Loading />
  const byId = Object.fromEntries(d.classes.map((c) => [c.id, c]))
  const staffName = (id) => d.staff.find((s) => s.id === id)?.full_name || 'Sin coach'
  const rosterCount = (cid) => d.roster.filter((r) => r.class_id === cid).length
  const del = async (c) => {
    if (!window.confirm(`¿Eliminar la clase "${c.name}" con sus horarios, grupo y reservas?`)) return
    await q(supabase.from('gym_classes').delete().eq('id', c.id)); load()
  }

  return (
    <>
      <PageTitle a="CLASES" b="GRUPALES">
        <button className="btn primary" onClick={() => setEdit({ name: '', training_type: types.find((t) => /box/i.test(t.name))?.name || types[0]?.name, capacity: 20, color: COLORS[0], active: true, slots: [] })}><Plus size={16} /> Nueva clase</button>
      </PageTitle>
      <Tabs value={view} onChange={setView} tabs={[{ id: 'week', label: 'Semana', icon: CalendarClock }, { id: 'list', label: 'Clases y grupos', icon: Users }]} />

      {view === 'week' && (
        <div className="week-grid mt">
          {ORDER.map((wd) => {
            const day = d.schedules.filter((s) => s.weekday === wd && s.active && byId[s.class_id]?.active).sort((a, b) => a.start_time.localeCompare(b.start_time))
            const isToday = new Date().getDay() === wd
            return (
              <div key={wd} className={`week-col ${isToday ? 'today' : ''}`}>
                <div className="week-h">{WEEKDAYS[wd]}{isToday && <span className="badge y" style={{ marginLeft: 6 }}>Hoy</span>}</div>
                {day.map((s) => {
                  const c = byId[s.class_id]
                  return (
                    <div key={s.id} className="slot" style={{ borderLeftColor: c.color || 'var(--y)' }} onClick={() => setEdit({ ...c, slots: d.schedules.filter((x) => x.class_id === c.id) })}>
                      <div className="slot-t">{hm(s.start_time)} <span className="muted">· {s.duration_min} min</span></div>
                      <div className="slot-n">{c.name}</div>
                      <div className="tiny muted">{staffName(s.coach_id || c.coach_id)} · {rosterCount(c.id)}/{c.capacity}</div>
                    </div>
                  )
                })}
                {!day.length && <div className="tiny muted center" style={{ padding: 10 }}>Sin clases</div>}
              </div>
            )
          })}
        </div>
      )}

      {view === 'list' && (
        <div className="grid auto mt">
          {d.classes.map((c) => {
            const slots = d.schedules.filter((s) => s.class_id === c.id).sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
            return (
              <div key={c.id} className="card" style={{ borderTop: `4px solid ${c.color || 'var(--y)'}`, opacity: c.active ? 1 : 0.5 }}>
                <div className="row between"><div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{c.name}</div><span className="badge">{c.training_type}</span></div>
                <div className="tiny muted">{staffName(c.coach_id)}{c.room ? ` · ${c.room}` : ''} · cupo {c.capacity}</div>
                <div className="row wrap mt" style={{ gap: 4 }}>{slots.map((s) => <span key={s.id} className="badge">{WEEKDAYS_SHORT[s.weekday]} {hm(s.start_time)}</span>)}{!slots.length && <span className="tiny warn">Sin horarios</span>}</div>
                <div className="row mt" style={{ gap: 6 }}>
                  <button className="btn sm primary" onClick={() => setGroup(c)}><Users size={14} /> Grupo ({rosterCount(c.id)})</button>
                  <button className="btn sm" onClick={() => setEdit({ ...c, slots })}><Pencil size={14} /></button>
                  <button className="btn sm danger" onClick={() => del(c)}><Trash2 size={14} /></button>
                </div>
              </div>
            )
          })}
          {!d.classes.length && <Empty>Crea tu primera clase (por ejemplo "Box Principiantes") y prográmala para la semana.</Empty>}
        </div>
      )}

      {edit && <ClassForm c={edit} types={types} staff={d.staff} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      {group && <GroupForm c={group} members={d.members} roster={d.roster.filter((r) => r.class_id === group.id).map((r) => r.member_id)} onClose={() => setGroup(null)} onSaved={() => { setGroup(null); load() }} />}
    </>
  )
}

function ClassForm({ c, types, staff, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState(c)
  const [slot, setSlot] = useState({ days: [1, 3, 5], time: '18:00', duration: 60 })
  const [busy, setBusy] = useState(false)
  const coaches = staff.filter((s) => s.role === 'coach' || s.role === 'admin')

  const addSlots = () => {
    if (!slot.days.length || !slot.time) return toast('Elige días y hora', 'error')
    const nuevos = slot.days.map((wd) => ({ tmp: Math.random(), weekday: wd, start_time: slot.time + ':00', duration_min: Number(slot.duration) || 60, active: true }))
    const exists = (n) => f.slots.some((s) => s.weekday === n.weekday && hm(s.start_time) === hm(n.start_time))
    setF({ ...f, slots: [...f.slots, ...nuevos.filter((n) => !exists(n))] })
  }
  const toggleDay = (wd) => setSlot((s) => ({ ...s, days: s.days.includes(wd) ? s.days.filter((x) => x !== wd) : [...s.days, wd] }))

  const save = async () => {
    if (!f.name.trim()) return toast('Ponle nombre a la clase', 'error')
    setBusy(true)
    try {
      const row = { name: f.name.trim(), training_type: f.training_type, coach_id: f.coach_id || null, capacity: Number(f.capacity) || 20, room: f.room || null, color: f.color, description: f.description || null, active: f.active !== false }
      let id = f.id
      if (id) await q(supabase.from('gym_classes').update(row).eq('id', id))
      else id = (await q(supabase.from('gym_classes').insert(row).select('id')))[0].id
      // sincroniza horarios: borra los quitados, crea los nuevos, actualiza duración/coach
      const keep = f.slots.filter((s) => s.id).map((s) => s.id)
      if (f.id) {
        const qd = supabase.from('class_schedules').delete().eq('class_id', id)
        await q(keep.length ? qd.not('id', 'in', `(${keep.join(',')})`) : qd)
      }
      for (const s of f.slots.filter((x) => x.id)) await q(supabase.from('class_schedules').update({ duration_min: s.duration_min, coach_id: s.coach_id || null, active: s.active !== false }).eq('id', s.id))
      const nuevos = f.slots.filter((s) => !s.id).map((s) => ({ class_id: id, weekday: s.weekday, start_time: s.start_time, duration_min: s.duration_min, coach_id: s.coach_id || null }))
      if (nuevos.length) await q(supabase.from('class_schedules').insert(nuevos))
      toast('Clase guardada', 'success'); onSaved()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const sorted = [...f.slots].sort((a, b) => ORDER.indexOf(a.weekday) - ORDER.indexOf(b.weekday) || hm(a.start_time).localeCompare(hm(b.start_time)))
  return (
    <Modal title={f.id ? 'Editar clase' : 'Nueva clase'} onClose={onClose} wide footer={<button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={16} />} Guardar</button>}>
      <div className="grid g3">
        <Input label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Box Principiantes" />
        <Select label="Modalidad" value={f.training_type} onChange={(e) => setF({ ...f, training_type: e.target.value })} options={types.map((t) => t.name)} />
        <Select label="Coach" value={f.coach_id || ''} onChange={(e) => setF({ ...f, coach_id: e.target.value })} options={[{ value: '', label: '— Sin coach —' }, ...coaches.map((s) => ({ value: s.id, label: s.full_name }))]} />
        <Input label="Cupo máximo" type="number" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        <Input label="Salón / lugar" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} placeholder="Ring 1" />
        <Field label="Color">
          <div className="row" style={{ gap: 6 }}>{COLORS.map((col) => <button key={col} type="button" onClick={() => setF({ ...f, color: col })} style={{ width: 28, height: 28, borderRadius: 8, background: col, border: f.color === col ? '3px solid #fff' : '1px solid #333', cursor: 'pointer' }} />)}</div>
        </Field>
        <Field label="Descripción" span={3}><textarea className="input" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>

      <div className="card mt" style={{ background: 'var(--bg2)' }}>
        <h3><CalendarClock size={16} className="y" /> Programar horarios</h3>
        <div className="row wrap" style={{ gap: 6 }}>{PRESETS.map(([l, days]) => <button key={l} type="button" className="chip" onClick={() => setSlot({ ...slot, days })}>{l}</button>)}</div>
        <div className="row wrap mt" style={{ gap: 6 }}>{ORDER.map((wd) => <button key={wd} type="button" className={`chip ${slot.days.includes(wd) ? 'on' : ''}`} onClick={() => toggleDay(wd)}>{WEEKDAYS_SHORT[wd]}</button>)}</div>
        <div className="grid g3 mt">
          <Input label="Hora de inicio" type="time" value={slot.time} onChange={(e) => setSlot({ ...slot, time: e.target.value })} />
          <Input label="Duración (min)" type="number" value={slot.duration} onChange={(e) => setSlot({ ...slot, duration: e.target.value })} />
          <Field label="&nbsp;"><button type="button" className="btn primary" onClick={addSlots}><Plus size={16} /> Agregar a los días elegidos</button></Field>
        </div>
        {sorted.length ? (
          <div className="table-wrap mt"><table className="t">
            <thead><tr><th>Día</th><th>Hora</th><th>Duración</th><th>Coach de ese día</th><th /></tr></thead>
            <tbody>{sorted.map((s) => (
              <tr key={s.id || s.tmp}><td>{WEEKDAYS[s.weekday]}</td><td>{hm(s.start_time)}</td>
                <td><input className="input" style={{ width: 80, padding: '5px 8px' }} type="number" value={s.duration_min} onChange={(e) => setF({ ...f, slots: f.slots.map((x) => (x === s ? { ...x, duration_min: Number(e.target.value) } : x)) })} /></td>
                <td><select className="input" style={{ padding: '5px 8px' }} value={s.coach_id || ''} onChange={(e) => setF({ ...f, slots: f.slots.map((x) => (x === s ? { ...x, coach_id: e.target.value || null } : x)) })}>
                  <option value="">El de la clase</option>{coaches.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></td>
                <td><button type="button" className="icon-btn" onClick={() => setF({ ...f, slots: f.slots.filter((x) => x !== s) })}><X size={16} /></button></td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="tiny muted mt">Aún no hay horarios. Elige días y hora y pulsa "Agregar".</p>}
      </div>
    </Modal>
  )
}

function GroupForm({ c, members, roster, onClose, onSaved }) {
  const toast = useToast()
  const [sel, setSel] = useState(roster)
  const [term, setTerm] = useState('')
  const [onlyMode, setOnlyMode] = useState(true)
  const [busy, setBusy] = useState(false)
  const list = members.filter((m) => (!onlyMode || (m.training_modes || []).includes(c.training_type) || sel.includes(m.id)) && (!term || m.full_name.toLowerCase().includes(term.toLowerCase())))
  const save = async () => {
    if (sel.length > c.capacity && !window.confirm(`El grupo (${sel.length}) supera el cupo (${c.capacity}). ¿Guardar igual?`)) return
    setBusy(true)
    try {
      await q(supabase.from('class_members').delete().eq('class_id', c.id))
      if (sel.length) await q(supabase.from('class_members').insert(sel.map((member_id) => ({ class_id: c.id, member_id }))))
      toast(`Grupo de ${c.name}: ${sel.length} clientes`, 'success'); onSaved()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={`Grupo · ${c.name}`} onClose={onClose} footer={<button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={16} />} Guardar grupo ({sel.length})</button>}>
      <p className="small muted">Los clientes del grupo ven la clase en su app, reciben la alerta 10 minutos antes y cuentan como inscritos.</p>
      <div className="row mb"><Search size={16} className="muted" /><input className="input" placeholder="Buscar cliente…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      <label className="row small mb" style={{ gap: 6 }}><input type="checkbox" checked={onlyMode} onChange={(e) => setOnlyMode(e.target.checked)} /> Mostrar solo clientes que eligieron {c.training_type}</label>
      <div className="col" style={{ maxHeight: 360, overflow: 'auto', gap: 4 }}>
        {list.map((m) => {
          const on = sel.includes(m.id)
          return (
            <label key={m.id} className="row" style={{ padding: 6, borderRadius: 8, cursor: 'pointer', background: on ? 'var(--y-soft)' : 'transparent' }}>
              <input type="checkbox" checked={on} onChange={() => setSel(on ? sel.filter((x) => x !== m.id) : [...sel, m.id])} />
              <Avatar src={m.photo} name={m.full_name} /><span className="grow">{m.full_name}</span>
              {(m.training_modes || []).includes(c.training_type) && <span className="badge tiny">{c.training_type}</span>}
            </label>
          )
        })}
        {!list.length && <Empty>No hay clientes {onlyMode ? `que hayan elegido ${c.training_type}` : ''}</Empty>}
      </div>
    </Modal>
  )
}

/** Dashboard: clases de hoy ordenadas por hora, con estado, coach, inscritos y asistentes. */
export function TodayClasses() {
  const [rows, setRows] = useState(null)
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const load = async () => {
      try {
        const wd = new Date().getDay()
        const date = ymd(new Date())
        const [sched, books, roster] = await Promise.all([
          q(supabase.from('class_schedules').select('*, gym_classes(*, coach:staff(full_name)), coach:staff(full_name)').eq('weekday', wd).eq('active', true).order('start_time')),
          q(supabase.from('class_bookings').select('schedule_id, member_id, status').eq('date', date)),
          q(supabase.from('class_members').select('class_id, member_id'))
        ])
        setRows(sched.filter((s) => s.gym_classes?.active).map((s) => {
          const ids = new Set([...roster.filter((r) => r.class_id === s.class_id).map((r) => r.member_id), ...books.filter((b) => b.schedule_id === s.id && b.status !== 'cancelado').map((b) => b.member_id)])
          const start = startAt(date, s.start_time)
          return { s, c: s.gym_classes, start, end: new Date(start.getTime() + s.duration_min * 60000), enrolled: ids.size, attended: books.filter((b) => b.schedule_id === s.id && b.status === 'asistio').length, coach: s.coach?.full_name || s.gym_classes.coach?.full_name }
        }))
      } catch { setRows([]) }
    }
    load()
    const t = setInterval(() => { setNow(new Date()); load() }, 60000)
    return () => clearInterval(t)
  }, [])
  if (!rows) return <Loading />
  if (!rows.length) return <Empty>No hay clases programadas para hoy</Empty>
  return (
    <div className="col" style={{ gap: 8 }}>
      {rows.map(({ s, c, start, end, enrolled, attended, coach }) => {
        const st = sessionState({ start, end }, now)
        const [cls, label] = STATE_LABEL[st]
        return (
          <div key={s.id} className={`today-row ${st}`} style={{ borderLeftColor: c.color || 'var(--y)' }}>
            <div className="today-time display">{hm(s.start_time)}</div>
            <div className="grow">
              <div style={{ fontWeight: 800 }}>{c.name} <span className="tiny muted">· {c.training_type}</span></div>
              <div className="tiny muted"><Clock size={11} /> {s.duration_min} min · {coach || 'Sin coach'}{c.room ? <> · <MapPin size={11} /> {c.room}</> : ''}</div>
            </div>
            <div className="center small"><b>{enrolled}</b>/{c.capacity}<div className="tiny muted">inscritos</div></div>
            <div className="center small"><b>{attended}</b><div className="tiny muted">asistieron</div></div>
            <span className={`badge ${cls}`}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}
