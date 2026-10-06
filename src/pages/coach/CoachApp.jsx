import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { Users, ListChecks, UsersRound, Dumbbell, BarChart3, Search, Plus, Trash2, Pencil, Save, Globe, ArrowLeft, Activity, Clock, Flame, Trophy, Send } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { getSession, setSession, clearSession } from '../../lib/auth'
import { getExercises, getTrainingTypes, assignRoutine } from '../../lib/data'
import { GOALS, MUSCLE_GROUPS, fmtTime, fmtDate, calcAge, addDays, today } from '../../lib/constants'
import Login from '../../components/Login'
import { Shell, PageTitle, Loading, Empty, Modal, Input, Select, Field, Avatar, StatusBadge, Tabs, Stat, Spinner, useToast } from '../../components/ui'
import { MemberAnalytics, tip } from '../../components/Analytics'
import BodyMetrics from '../../components/BodyMetrics'
import ExerciseBrowser from '../../components/ExerciseBrowser'
import AssignmentEditor, { WeekdayPicker } from './AssignmentEditor'

const NAV = [
  { id: 'clients', label: 'Clientes', icon: Users },
  { id: 'routines', label: 'Rutinas', icon: ListChecks },
  { id: 'groups', label: 'Grupos', icon: UsersRound },
  { id: 'exercises', label: 'Ejercicios', icon: Dumbbell },
  { id: 'analytics', label: 'Analítica', icon: BarChart3 }
]

export default function CoachApp() {
  const [me, setMe] = useState(() => getSession('coach'))
  const [tab, setTab] = useState('clients')
  const [d, setD] = useState(null)
  const toast = useToast()

  const load = async () => {
    try {
      const [members, exercises, routines, groups, types] = await Promise.all([
        q(supabase.from('members').select('id, full_name, cedula, email, phone, photo, goal, training_modes, level, coach_id, birthdate, sex, medical_notes, activity_level, active').eq('active', true).order('full_name')),
        getExercises(), q(supabase.from('routines').select('*').order('created_at', { ascending: false })),
        q(supabase.from('client_groups').select('*, group_members(member_id)').order('created_at', { ascending: false })), getTrainingTypes()
      ])
      const status = await q(supabase.from('member_status').select('member_id, status, days_left, plan_name'))
      const st = Object.fromEntries(status.map((s) => [s.member_id, s]))
      setD({ members: members.map((m) => ({ ...m, st: st[m.id] })), exercises, routines, groups, types })
    } catch (e) { toast(e.message, 'error') }
  }
  useEffect(() => { if (me) load() }, [me?.id])

  if (!me) return <Login scope="coach" onLogin={(u) => { setSession('coach', u); setMe(u) }} />
  return (
    <Shell sub="ZONA COACH" nav={NAV} value={tab} onChange={setTab} user={{ ...me, role: me.role === 'admin' ? 'Admin' : 'Coach' }} onLogout={() => { clearSession('coach'); setMe(null) }}>
      {!d ? <Loading /> : (
        <>
          {tab === 'clients' && <Clients d={d} me={me} />}
          {tab === 'routines' && <Routines d={d} me={me} reload={load} />}
          {tab === 'groups' && <Groups d={d} me={me} reload={load} />}
          {tab === 'exercises' && <Exercises d={d} me={me} reload={load} />}
          {tab === 'analytics' && <CoachAnalytics d={d} />}
        </>
      )}
    </Shell>
  )
}

// ---------------- Clientes ----------------
function Clients({ d, me }) {
  const [term, setTerm] = useState('')
  const [mine, setMine] = useState(false)
  const [open, setOpen] = useState(null)
  if (open) return <ClientProfile m={open} d={d} me={me} onBack={() => setOpen(null)} />
  const list = d.members.filter((m) => (!mine || m.coach_id === me.id) && (!term || [m.full_name, m.cedula].some((v) => v?.toLowerCase().includes(term.toLowerCase()))))
  return (
    <>
      <PageTitle a="MIS" b="CLIENTES">
        <button className={`chip ${!mine ? 'on' : ''}`} onClick={() => setMine(false)}>Todos ({d.members.length})</button>
        <button className={`chip ${mine ? 'on' : ''}`} onClick={() => setMine(true)}>Asignados a mí</button>
      </PageTitle>
      <div className="row mb"><Search size={16} className="muted" /><input className="input" placeholder="Buscar cliente…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      {list.length ? (
        <div className="grid auto">
          {list.map((m) => (
            <div key={m.id} className="card card-click" onClick={() => setOpen(m)}>
              <div className="row"><Avatar src={m.photo} name={m.full_name} />
                <div className="grow"><div style={{ fontWeight: 800 }}>{m.full_name}</div><div className="tiny muted">C.I. {m.cedula}</div></div></div>
              <div className="row wrap mt" style={{ gap: 6 }}>
                <StatusBadge status={m.st?.status} days={m.st?.days_left} />
                {m.goal && <span className="badge y">{GOALS.find((g) => g.id === m.goal)?.label}</span>}
              </div>
              <div className="tiny muted mt">{(m.training_modes || []).join(' · ') || 'Sin modalidades elegidas'}</div>
            </div>
          ))}
        </div>
      ) : <Empty>No hay clientes</Empty>}
    </>
  )
}

function ClientProfile({ m, d, me, onBack }) {
  const [tab, setTab] = useState('plan')
  const goal = GOALS.find((g) => g.id === m.goal)
  const groups = d.groups.filter((g) => g.group_members.some((x) => x.member_id === m.id))
  return (
    <>
      <div className="topbar">
        <div className="row"><button className="btn" onClick={onBack}><ArrowLeft size={16} /></button>
          <Avatar src={m.photo} name={m.full_name} />
          <div><h1 className="page-title" style={{ fontSize: '2rem' }}>{m.full_name}</h1>
            <div className="small muted">C.I. {m.cedula} · {calcAge(m.birthdate) ?? '—'} años · {m.sex === 'F' ? 'Femenino' : 'Masculino'} · {m.phone}</div></div></div>
        <div className="row wrap"><StatusBadge status={m.st?.status} days={m.st?.days_left} />{goal && <span className="badge y">{goal.emoji} {goal.label}</span>}<span className="badge" style={{ textTransform: 'capitalize' }}>{m.level}</span></div>
      </div>
      <div className="row wrap mb" style={{ gap: 6 }}>
        {(m.training_modes || []).map((x) => <span key={x} className="badge">{d.types.find((t) => t.name === x)?.emoji} {x}</span>)}
        {groups.map((g) => <span key={g.id} className="badge ok"><UsersRound size={11} /> {g.name}</span>)}
        {m.medical_notes && <span className="badge bad">⚠️ {m.medical_notes}</span>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'plan', label: 'Plan semanal', icon: ListChecks }, { id: 'stats', label: 'Analítica', icon: BarChart3 }, { id: 'body', label: 'Medidas', icon: Activity }]} />
      <div className="mt">
        {tab === 'plan' && <AssignmentEditor memberId={m.id} exercises={d.exercises} routines={d.routines} staffId={me.id} />}
        {tab === 'stats' && <MemberAnalytics memberId={m.id} days={90} />}
        {tab === 'body' && <BodyMetrics member={m} readOnly />}
      </div>
    </>
  )
}

// ---------------- Rutinas ----------------
function Routines({ d, me, reload }) {
  const toast = useToast()
  const [f, setF] = useState(null)
  const [assign, setAssign] = useState(null)
  const exById = Object.fromEntries(d.exercises.map((e) => [e.id, e]))

  const addItem = (id) => {
    const e = exById[id]
    if (e) setF((x) => ({ ...x, items: [...x.items, { exercise_id: id, sets: e.default_sets, reps: e.default_reps, work_sec: e.default_work_sec, rest_sec: e.default_rest_sec, weight: '' }] }))
  }
  const updItem = (i, k, v) => setF((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, [k]: v === '' ? '' : Number(v) } : it)) }))
  const save = async () => {
    if (!f.name || !f.items.length) return toast('Ponle nombre y al menos un ejercicio', 'error')
    const row = { name: f.name, description: f.description, training_type: f.training_type, items: f.items, coach_id: me.id }
    if (f.id) await q(supabase.from('routines').update(row).eq('id', f.id)); else await q(supabase.from('routines').insert(row))
    toast('Rutina guardada', 'success'); setF(null); reload()
  }
  const del = async (id) => { if (window.confirm('¿Eliminar rutina?')) { await q(supabase.from('routines').delete().eq('id', id)); reload() } }
  const total = (items) => items.reduce((s, it) => s + it.sets * ((Number(it.work_sec) || 0) + (Number(it.rest_sec) || 0)), 0)

  const doAssign = async () => {
    if (!assign.days.length || (!assign.members.length && !assign.groups.length)) return toast('Elige días y destinatarios', 'error')
    for (const mId of assign.members) await assignRoutine({ routine: assign.r, memberId: mId, weekdays: assign.days, staffId: me.id })
    for (const gId of assign.groups) await assignRoutine({ routine: assign.r, groupId: gId, weekdays: assign.days, staffId: me.id })
    toast('Rutina asignada', 'success'); setAssign(null)
  }

  return (
    <>
      <PageTitle a="RUTINAS" b="DE ENTRENAMIENTO"><button className="btn primary" onClick={() => setF({ name: '', training_type: d.types[0]?.name, items: [] })}><Plus size={16} /> Crear rutina</button></PageTitle>
      {d.routines.length ? (
        <div className="grid auto">
          {d.routines.map((r) => (
            <div key={r.id} className="card">
              <div className="row between"><div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{r.name}</div><span className="badge">{r.training_type}</span></div>
              <div className="tiny muted">{r.items.length} ejercicios · ~{fmtTime(total(r.items))}</div>
              <ul className="small" style={{ paddingLeft: 18, margin: '10px 0' }}>{r.items.slice(0, 5).map((it, i) => <li key={i}>{exById[it.exercise_id]?.name} <span className="muted">{it.sets}×{it.reps}</span></li>)}</ul>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm primary" onClick={() => setAssign({ r, days: [new Date().getDay()], members: [], groups: [] })}><Send size={14} /> Asignar</button>
                <button className="btn sm" onClick={() => setF({ ...r })}><Pencil size={14} /></button>
                <button className="btn sm danger" onClick={() => del(r.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>Crea tu primera rutina: un grupo de ejercicios con series, repeticiones y tiempos.</Empty>}

      {f && (
        <Modal title={f.id ? 'Editar rutina' : 'Nueva rutina'} onClose={() => setF(null)} wide footer={<button className="btn primary" onClick={save}><Save size={16} /> Guardar rutina</button>}>
          <div className="grid g3">
            <Input label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Select label="Modalidad" value={f.training_type} onChange={(e) => setF({ ...f, training_type: e.target.value })} options={d.types.map((t) => t.name)} />
            <Input label="Descripción" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div className="mt">
            <Select label="Agregar ejercicio" value="" onChange={(e) => addItem(e.target.value)} options={[{ value: '', label: '+ Selecciona un ejercicio para agregar' }, ...d.exercises.map((e) => ({ value: e.id, label: `${e.muscle_group} · ${e.name}` }))]} />
          </div>
          <div className="table-wrap mt"><table className="t">
            <thead><tr><th>#</th><th>Ejercicio</th><th>Series</th><th>Reps</th><th>Trabajo (s)</th><th>Descanso (s)</th><th>Kg</th><th /></tr></thead>
            <tbody>{f.items.map((it, i) => (
              <tr key={i}><td>{i + 1}</td><td><b>{exById[it.exercise_id]?.name}</b><div className="tiny muted">{exById[it.exercise_id]?.muscle_group}</div></td>
                {['sets', 'reps', 'work_sec', 'rest_sec', 'weight'].map((k) => <td key={k}><input className="input" style={{ width: 80, padding: '6px 8px' }} type="number" value={it[k] ?? ''} onChange={(e) => updItem(i, k, e.target.value)} /></td>)}
                <td><button className="icon-btn" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}><Trash2 size={15} /></button></td></tr>
            ))}</tbody>
          </table></div>
          <p className="muted small">Duración estimada: <b className="y">{fmtTime(total(f.items))}</b></p>
        </Modal>
      )}
      {assign && (
        <Modal title={`Asignar "${assign.r.name}"`} onClose={() => setAssign(null)} footer={<button className="btn primary" onClick={doAssign}><Send size={16} /> Asignar</button>}>
          <div className="col">
            <Field label="Días"><WeekdayPicker value={assign.days} onChange={(days) => setAssign({ ...assign, days })} /></Field>
            <Field label="Grupos (se carga a todos sus clientes)"><div className="row wrap">{d.groups.map((g) => <button key={g.id} className={`chip ${assign.groups.includes(g.id) ? 'on' : ''}`} onClick={() => setAssign({ ...assign, groups: assign.groups.includes(g.id) ? assign.groups.filter((x) => x !== g.id) : [...assign.groups, g.id] })}>{g.name}</button>)}{!d.groups.length && <span className="muted small">Sin grupos</span>}</div></Field>
            <Field label="Clientes"><MemberPicker members={d.members} value={assign.members} onChange={(members) => setAssign({ ...assign, members })} /></Field>
          </div>
        </Modal>
      )}
    </>
  )
}

function MemberPicker({ members, value, onChange }) {
  const [t, setT] = useState('')
  const list = members.filter((m) => !t || m.full_name.toLowerCase().includes(t.toLowerCase()))
  return (
    <div>
      <input className="input mb" placeholder="Filtrar…" value={t} onChange={(e) => setT(e.target.value)} />
      <div className="col" style={{ maxHeight: 240, overflow: 'auto', gap: 4 }}>
        {list.map((m) => (
          <label key={m.id} className="row" style={{ padding: 6, borderRadius: 8, cursor: 'pointer', background: value.includes(m.id) ? 'var(--y-soft)' : 'transparent' }}>
            <input type="checkbox" checked={value.includes(m.id)} onChange={() => onChange(value.includes(m.id) ? value.filter((x) => x !== m.id) : [...value, m.id])} />
            <Avatar src={m.photo} name={m.full_name} /><span>{m.full_name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ---------------- Grupos ----------------
function Groups({ d, me, reload }) {
  const toast = useToast()
  const [f, setF] = useState(null)
  const [open, setOpen] = useState(null)
  const save = async () => {
    if (!f.name) return toast('Ponle un nombre al grupo', 'error')
    let id = f.id
    const row = { name: f.name, description: f.description, coach_id: me.id }
    if (id) await q(supabase.from('client_groups').update(row).eq('id', id))
    else id = (await q(supabase.from('client_groups').insert(row).select('id')))[0].id
    await q(supabase.from('group_members').delete().eq('group_id', id))
    if (f.members.length) await q(supabase.from('group_members').insert(f.members.map((member_id) => ({ group_id: id, member_id }))))
    toast('Grupo guardado: sus clientes reciben automáticamente los ejercicios del grupo', 'success'); setF(null); reload()
  }
  const del = async (id) => { if (window.confirm('¿Eliminar grupo y sus asignaciones?')) { await q(supabase.from('client_groups').delete().eq('id', id)); reload() } }

  if (open) {
    const g = d.groups.find((x) => x.id === open)
    return (
      <>
        <div className="topbar"><div className="row"><button className="btn" onClick={() => setOpen(null)}><ArrowLeft size={16} /></button><h1 className="page-title">GRUPO <span>{g.name.toUpperCase()}</span></h1></div>
          <span className="badge y">{g.group_members.length} clientes</span></div>
        <p className="muted small">Todo lo que asignes aquí aparece automáticamente en la app de cada integrante del grupo.</p>
        <AssignmentEditor groupId={g.id} exercises={d.exercises} routines={d.routines} staffId={me.id} />
      </>
    )
  }
  return (
    <>
      <PageTitle a="GRUPOS DE" b="CLIENTES"><button className="btn primary" onClick={() => setF({ name: '', members: [] })}><Plus size={16} /> Crear grupo</button></PageTitle>
      {d.groups.length ? (
        <div className="grid auto">
          {d.groups.map((g) => (
            <div key={g.id} className="card">
              <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{g.name}</div>
              <div className="tiny muted">{g.description}</div>
              <div className="row mt" style={{ gap: -6 }}>{g.group_members.slice(0, 6).map((x) => { const m = d.members.find((y) => y.id === x.member_id); return m && <Avatar key={m.id} src={m.photo} name={m.full_name} /> })}
                <span className="small muted">{g.group_members.length} clientes</span></div>
              <div className="row mt" style={{ gap: 6 }}>
                <button className="btn sm primary" onClick={() => setOpen(g.id)}><ListChecks size={14} /> Ejercicios del grupo</button>
                <button className="btn sm" onClick={() => setF({ ...g, members: g.group_members.map((x) => x.member_id) })}><Pencil size={14} /></button>
                <button className="btn sm danger" onClick={() => del(g.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>Crea grupos para entrenar a varios clientes con los mismos ejercicios.</Empty>}
      {f && (
        <Modal title={f.id ? 'Editar grupo' : 'Nuevo grupo'} onClose={() => setF(null)} footer={<button className="btn primary" onClick={save}><Save size={16} /> Guardar</button>}>
          <div className="col">
            <Input label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Input label="Descripción" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <Field label={`Integrantes (${f.members.length})`}><MemberPicker members={d.members} value={f.members} onChange={(members) => setF({ ...f, members })} /></Field>
          </div>
        </Modal>
      )}
    </>
  )
}

// ---------------- Ejercicios ----------------
function Exercises({ d, me, reload }) {
  const toast = useToast()
  const [f, setF] = useState(null)
  const [browse, setBrowse] = useState(false)
  const [mg, setMg] = useState('all')
  const save = async () => {
    if (!f.name || !f.muscle_group) return toast('Nombre y grupo muscular requeridos', 'error')
    const row = { name: f.name, muscle_group: f.muscle_group, training_type: f.training_type, description: f.description, image_url: f.image_url || null, video_url: f.video_url || null,
      default_sets: Number(f.default_sets) || 4, default_reps: Number(f.default_reps) || 12, default_work_sec: Number(f.default_work_sec) || 45, default_rest_sec: Number(f.default_rest_sec) || 60, created_by: me.id }
    if (f.id) await q(supabase.from('exercises').update(row).eq('id', f.id)); else await q(supabase.from('exercises').insert(row))
    toast('Ejercicio guardado', 'success'); setF(null); reload()
  }
  const del = async (id) => { if (window.confirm('¿Eliminar ejercicio? Se quitará de las asignaciones.')) { await q(supabase.from('exercises').delete().eq('id', id)); reload() } }
  const newEx = (p = {}) => setF({ muscle_group: MUSCLE_GROUPS.includes(p.muscle_group) ? p.muscle_group : 'Cuerpo completo', training_type: d.types[0]?.name, default_sets: 4, default_reps: 12, default_work_sec: 45, default_rest_sec: 60, ...p })
  const list = d.exercises.filter((e) => mg === 'all' || e.muscle_group === mg)

  return (
    <>
      <PageTitle a="BANCO DE" b="EJERCICIOS">
        <button className="btn" onClick={() => setBrowse(true)}><Globe size={16} /> Buscar en internet</button>
        <button className="btn primary" onClick={() => newEx()}><Plus size={16} /> Nuevo ejercicio</button>
      </PageTitle>
      <div className="row wrap mb">{['all', ...MUSCLE_GROUPS].map((g) => <button key={g} className={`chip ${mg === g ? 'on' : ''}`} onClick={() => setMg(g)}>{g === 'all' ? 'Todos' : g}</button>)}</div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Ejercicio</th><th>Grupo</th><th>Modalidad</th><th>Por defecto</th><th /></tr></thead>
        <tbody>{list.map((e) => (
          <tr key={e.id}><td><div className="row">{e.image_url ? <img className="ex-img" style={{ width: 40, height: 40, background: '#fff' }} src={e.image_url} alt="" /> : <div className="ex-img" style={{ width: 40, height: 40 }}><Dumbbell size={16} /></div>}<b>{e.name}</b></div></td>
            <td>{e.muscle_group}</td><td>{e.training_type}</td><td className="small">{e.default_sets}×{e.default_reps} · {e.default_work_sec}s / {e.default_rest_sec}s</td>
            <td><div className="row" style={{ gap: 4 }}><button className="icon-btn" onClick={() => setF(e)}><Pencil size={15} /></button><button className="icon-btn" onClick={() => del(e.id)}><Trash2 size={15} /></button></div></td></tr>
        ))}</tbody>
      </table></div>
      {f && (
        <Modal title={f.id ? 'Editar ejercicio' : 'Nuevo ejercicio'} onClose={() => setF(null)} footer={<button className="btn primary" onClick={save}><Save size={16} /> Guardar</button>}>
          <div className="grid g2">
            <Input label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Select label="Grupo muscular" value={f.muscle_group} onChange={(e) => setF({ ...f, muscle_group: e.target.value })} options={MUSCLE_GROUPS} />
            <Select label="Modalidad" value={f.training_type} onChange={(e) => setF({ ...f, training_type: e.target.value })} options={d.types.map((t) => t.name)} />
            <Input label="URL de imagen" value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} />
            <Input label="Series" type="number" value={f.default_sets} onChange={(e) => setF({ ...f, default_sets: e.target.value })} />
            <Input label="Repeticiones" type="number" value={f.default_reps} onChange={(e) => setF({ ...f, default_reps: e.target.value })} />
            <Input label="Trabajo (seg)" type="number" value={f.default_work_sec} onChange={(e) => setF({ ...f, default_work_sec: e.target.value })} />
            <Input label="Descanso (seg)" type="number" value={f.default_rest_sec} onChange={(e) => setF({ ...f, default_rest_sec: e.target.value })} />
            <Field label="Descripción / técnica" span={2}><textarea className="input" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {browse && (
        <Modal title="Ejercicios en internet" onClose={() => setBrowse(false)} wide>
          <ExerciseBrowser types={d.types} onImport={(p) => { setBrowse(false); newEx(p) }} />
        </Modal>
      )}
    </>
  )
}

// ---------------- Analítica general ----------------
function CoachAnalytics({ d }) {
  const [s, setS] = useState(null)
  useEffect(() => {
    Promise.all([
      q(supabase.from('workout_sessions').select('member_id, date, total_sec, calories, sets_done').gte('date', addDays(today(), -30))),
      q(supabase.from('attendance').select('member_id, created_at').gte('created_at', addDays(today(), -30)))
    ]).then(([sessions, att]) => setS({ sessions, att }))
  }, [])
  const k = useMemo(() => {
    if (!s) return null
    const by = {}
    for (const x of s.sessions) {
      by[x.member_id] ??= { sesiones: 0, seg: 0, kcal: 0 }
      by[x.member_id].sesiones++; by[x.member_id].seg += x.total_sec || 0; by[x.member_id].kcal += Number(x.calories || 0)
    }
    const rank = Object.entries(by).map(([id, v]) => ({ ...v, m: d.members.find((m) => m.id === id) })).filter((x) => x.m).sort((a, b) => b.sesiones - a.sesiones)
    const days = []
    for (let i = 29; i >= 0; i--) { const dt = addDays(today(), -i); days.push({ dia: dt.slice(5), sesiones: s.sessions.filter((x) => x.date === dt).length }) }
    const inactive = d.members.filter((m) => !by[m.id])
    return { rank, days, inactive, totalSec: s.sessions.reduce((a, x) => a + (x.total_sec || 0), 0), kcal: s.sessions.reduce((a, x) => a + Number(x.calories || 0), 0) }
  }, [s, d])
  if (!k) return <Loading />
  return (
    <>
      <PageTitle a="ANALÍTICA" b="DE PROGRESO" />
      <div className="grid g4">
        <Stat label="Sesiones (30 días)" value={s.sessions.length} icon={Activity} y />
        <Stat label="Clientes activos" value={k.rank.length} icon={Users} sub={`${k.inactive.length} sin entrenar`} />
        <Stat label="Horas entrenadas" value={Math.round(k.totalSec / 3600)} icon={Clock} />
        <Stat label="Calorías totales" value={Math.round(k.kcal).toLocaleString()} icon={Flame} />
      </div>
      <div className="card mt"><h3>Sesiones diarias</h3>
        <ResponsiveContainer width="100%" height={220}><BarChart data={k.days}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="dia" stroke="#666" fontSize={10} /><YAxis stroke="#666" fontSize={11} allowDecimals={false} /><Tooltip {...tip} /><Bar dataKey="sesiones" fill="#FFD60A" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer>
      </div>
      <div className="grid g2 mt">
        <div className="card"><h3><Trophy size={16} className="y" /> Ranking de constancia</h3>
          <div className="table-wrap"><table className="t"><thead><tr><th>#</th><th>Cliente</th><th>Sesiones</th><th>Tiempo</th><th>kcal</th></tr></thead>
            <tbody>{k.rank.slice(0, 15).map((r, i) => <tr key={r.m.id}><td>{i + 1}</td><td><div className="row"><Avatar src={r.m.photo} name={r.m.full_name} />{r.m.full_name}</div></td><td>{r.sesiones}</td><td>{fmtTime(r.seg)}</td><td>{Math.round(r.kcal)}</td></tr>)}</tbody></table></div>
        </div>
        <div className="card"><h3>Clientes sin entrenar en 30 días</h3>
          {k.inactive.length ? <div className="col" style={{ gap: 6, maxHeight: 420, overflow: 'auto' }}>{k.inactive.map((m) => <div key={m.id} className="row between"><div className="row"><Avatar src={m.photo} name={m.full_name} /><span>{m.full_name}</span></div><span className="small muted">{m.phone}</span></div>)}</div> : <Empty>¡Todos entrenando! 💪</Empty>}
        </div>
      </div>
    </>
  )
}
