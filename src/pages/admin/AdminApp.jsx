import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from 'recharts'
import { LayoutDashboard, Users, CreditCard, Tags, UserCog, Dumbbell, CalendarCheck, Plus, Search, RefreshCw, Pencil, Trash2, AlertTriangle, DollarSign, UserCheck, Clock, KeyRound, Power, Megaphone } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { getSession, setSession, clearSession, setPassword } from '../../lib/auth'
import { getPlans, getTrainingTypes } from '../../lib/data'
import { addDays, today, fmtDate, fmtDateTime, money } from '../../lib/constants'
import { WGER_CATEGORIES } from '../../lib/exerciseLibrary'
import Login from '../../components/Login'
import { Shell, PageTitle, Stat, Loading, Empty, Modal, Input, Select, Field, Avatar, StatusBadge, Spinner, useToast } from '../../components/ui'
import { tip } from '../../components/Analytics'
import MemberForm from './MemberForm'
import Promotions from './Promotions'
import { ProofPicker, ProofLink, PendingProofs } from '../../components/Payments'

const NAV = [
  { id: 'dash', label: 'Dashboard', icon: LayoutDashboard, short: 'Inicio' },
  { id: 'members', label: 'Clientes', icon: Users },
  { id: 'memberships', label: 'Membresías', icon: CreditCard },
  { id: 'attendance', label: 'Asistencia', icon: CalendarCheck },
  { id: 'promos', label: 'Promociones push', short: 'Promos', icon: Megaphone },
  { id: 'plans', label: 'Planes', icon: Tags },
  { id: 'staff', label: 'Coaches y personal', short: 'Personal', icon: UserCog },
  { id: 'types', label: 'Modalidades', icon: Dumbbell }
]

export default function AdminApp() {
  const [me, setMe] = useState(() => getSession('admin'))
  const [tab, setTab] = useState('dash')
  const [data, setData] = useState(null)
  const toast = useToast()

  const load = async () => {
    try {
      const [members, plans, staff, types] = await Promise.all([
        q(supabase.from('member_status').select('*').order('full_name')),
        getPlans(), q(supabase.from('staff').select('*').order('created_at')), getTrainingTypes()
      ])
      setData({ members, plans, staff, types })
    } catch (e) { toast(e.message, 'error') }
  }
  useEffect(() => { if (me) load() }, [me?.id])

  if (!me) return <Login scope="admin" onLogin={(u) => { setSession('admin', u); setMe(u) }} />
  return (
    <Shell sub="ADMINISTRACIÓN" nav={NAV} value={tab} onChange={setTab} user={{ ...me, role: 'Administrador' }} onLogout={() => { clearSession('admin'); setMe(null) }}>
      {!data ? <Loading /> : (
        <>
          {tab === 'dash' && <Dashboard data={data} reload={load} goTo={setTab} />}
          {tab === 'members' && <Members data={data} reload={load} />}
          {tab === 'memberships' && <Memberships data={data} reload={load} me={me} />}
          {tab === 'attendance' && <Attendance />}
          {tab === 'promos' && <Promotions data={data} me={me} />}
          {tab === 'plans' && <Plans data={data} reload={load} />}
          {tab === 'staff' && <Staff data={data} reload={load} me={me} />}
          {tab === 'types' && <Types data={data} reload={load} />}
        </>
      )}
    </Shell>
  )
}

// ---------------- Dashboard ----------------
function Dashboard({ data, reload, goTo }) {
  const [pending, setPending] = useState(0)
  const [ms, setMs] = useState([])
  const [att, setAtt] = useState([])
  const [renew, setRenew] = useState(null)
  useEffect(() => {
    q(supabase.from('memberships').select('*').gte('created_at', addDays(today(), -180))).then(setMs)
    q(supabase.from('attendance').select('created_at, method').gte('created_at', addDays(today(), -14))).then(setAtt)
    supabase.from('payment_proofs').select('id', { count: 'exact', head: true }).eq('status', 'pendiente').then(({ count }) => setPending(count || 0))
  }, [])
  const active = data.members.filter((m) => m.status === 'activa' || m.status === 'por_vencer')
  const soon = data.members.filter((m) => m.status === 'por_vencer')
  const expired = data.members.filter((m) => m.status === 'vencida')
  const month = today().slice(0, 7)
  const income = ms.filter((m) => m.created_at.slice(0, 7) === month).reduce((s, m) => s + Number(m.price || 0), 0)
  const todayAtt = att.filter((a) => a.created_at.slice(0, 10) === today()).length

  const incomeChart = useMemo(() => {
    const by = {}
    for (const m of ms) { const k = m.created_at.slice(0, 7); by[k] = (by[k] || 0) + Number(m.price || 0) }
    return Object.entries(by).sort().map(([mes, total]) => ({ mes, total }))
  }, [ms])
  const attChart = useMemo(() => {
    const out = []
    for (let i = 13; i >= 0; i--) { const d = addDays(today(), -i); out.push({ dia: d.slice(5), ingresos: att.filter((a) => a.created_at.slice(0, 10) === d).length }) }
    return out
  }, [att])

  return (
    <>
      <PageTitle a="DASHBOARD" b="GENERAL"><button className="btn" onClick={reload}><RefreshCw size={16} /> Actualizar</button></PageTitle>
      <div className="grid g4">
        <Stat label="Clientes activos" value={active.length} icon={UserCheck} y sub={`${data.members.length} registrados`} />
        <Stat label="Por vencer (≤5 días)" value={soon.length} icon={Clock} />
        <Stat label="Vencidos" value={expired.length} icon={AlertTriangle} />
        <Stat label="Ingresos del mes" value={money(income)} icon={DollarSign} sub={`${todayAtt} asistencias hoy`} />
      </div>
      {pending > 0 && (
        <div className="card hl mt row between wrap">
          <b>🧾 {pending} comprobante{pending > 1 ? 's' : ''} de transferencia por revisar</b>
          <button className="btn primary sm" onClick={() => goTo('memberships')}>Revisar</button>
        </div>
      )}
      <div className="grid g2 mt">
        <div className="card"><h3>Ingresos por mes</h3>
          <ResponsiveContainer width="100%" height={230}><BarChart data={incomeChart}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="mes" stroke="#666" fontSize={11} /><YAxis stroke="#666" fontSize={11} /><Tooltip {...tip} /><Bar dataKey="total" fill="#FFD60A" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
        </div>
        <div className="card"><h3>Asistencia últimos 14 días</h3>
          <ResponsiveContainer width="100%" height={230}><AreaChart data={attChart}><CartesianGrid stroke="#222" vertical={false} /><XAxis dataKey="dia" stroke="#666" fontSize={11} /><YAxis stroke="#666" fontSize={11} allowDecimals={false} /><Tooltip {...tip} /><Area dataKey="ingresos" stroke="#FFD60A" fill="rgba(255,214,10,.25)" strokeWidth={3} /></AreaChart></ResponsiveContainer>
        </div>
      </div>
      <div className="card mt">
        <h3><AlertTriangle size={16} className="y" /> Vencimientos que requieren atención</h3>
        {[...soon, ...expired].length ? (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Cliente</th><th>Teléfono</th><th>Plan</th><th>Vence</th><th>Estado</th><th /></tr></thead>
            <tbody>{[...soon, ...expired].map((m) => (
              <tr key={m.member_id}><td><div className="row"><Avatar src={m.photo} name={m.full_name} />{m.full_name}</div></td><td>{m.phone || '—'}</td><td>{m.plan_name}</td><td>{fmtDate(m.end_date)}</td>
                <td><StatusBadge status={m.status} days={m.days_left} /></td><td><button className="btn sm primary" onClick={() => setRenew(m)}><RefreshCw size={14} /> Renovar</button></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>Todo al día 🎉</Empty>}
      </div>
      {renew && <RenewModal m={renew} plans={data.plans} onClose={() => setRenew(null)} onSaved={() => { setRenew(null); reload() }} />}
    </>
  )
}

// ---------------- Renovación ----------------
export function RenewModal({ m, plans, onClose, onSaved }) {
  const toast = useToast()
  const base = m.end_date && m.end_date >= today() ? m.end_date : today()
  const [f, setF] = useState({ plan_id: plans.find((p) => p.days === 30)?.id || plans[0]?.id, start_date: base, payment_method: 'efectivo', price: '' })
  const plan = plans.find((p) => p.id === f.plan_id)
  const save = async () => {
    if (f.payment_method === 'transferencia' && !f.proof_path && !window.confirm('El pago es por transferencia y no adjuntaste el comprobante. ¿Renovar de todas formas?')) return
    try {
      await q(supabase.from('memberships').insert({
        member_id: m.member_id, plan_id: plan.id, plan_name: plan.name, start_date: f.start_date, end_date: addDays(f.start_date, plan.days),
        price: f.price === '' ? plan.price : Number(f.price), payment_method: f.payment_method,
        proof_path: f.payment_method === 'transferencia' ? f.proof_path || null : null,
        payment_ref: f.payment_method === 'transferencia' ? f.payment_ref || null : null
      }))
      toast(`Membresía renovada hasta ${addDays(f.start_date, plan.days)}`, 'success'); onSaved()
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Modal title={`Renovar · ${m.full_name}`} onClose={onClose} footer={<button className="btn primary" onClick={save}><RefreshCw size={16} /> Renovar</button>}>
      <div className="grid g2">
        <Select label="Plan" value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })} options={plans.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} (${p.days} días) · ${money(p.price)}` }))} />
        <Input label="Desde" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
        <Select label="Método de pago" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} options={['efectivo', 'tarjeta', 'transferencia', 'otro']} />
        <Input label={`Valor en COP (por defecto ${money(plan?.price)})`} type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
      </div>
      {f.payment_method === 'transferencia' && (
        <div className="col mt">
          <Input label="Referencia de la transferencia" value={f.payment_ref} onChange={(e) => setF({ ...f, payment_ref: e.target.value })} />
          <ProofPicker value={f.proof_path} onChange={(proof_path) => setF((x) => ({ ...x, proof_path }))} memberId={m.member_id} />
        </div>
      )}
      {plan && <p className="muted">Nuevo vencimiento: <b className="y">{fmtDate(addDays(f.start_date, plan.days))}</b>. Si la membresía sigue activa, se suma a partir de su vencimiento actual.</p>}
    </Modal>
  )
}

// ---------------- Clientes ----------------
function Members({ data, reload }) {
  const [term, setTerm] = useState('')
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(undefined)
  const [renew, setRenew] = useState(null)
  const coaches = data.staff.filter((s) => s.role === 'coach' && s.active)
  const list = data.members.filter((m) =>
    (filter === 'all' || m.status === filter) &&
    (!term || [m.full_name, m.cedula, m.email, m.phone].some((v) => v?.toLowerCase().includes(term.toLowerCase()))))

  const openEdit = async (m) => {
    const [full] = await q(supabase.from('members').select('*').eq('id', m.member_id))
    setForm(full)
  }
  const toggle = async (m) => { await q(supabase.from('members').update({ active: !m.active }).eq('id', m.member_id)); reload() }

  return (
    <>
      <PageTitle a="GESTIÓN DE" b="CLIENTES"><button className="btn primary" onClick={() => setForm(null)}><Plus size={16} /> Inscribir cliente</button></PageTitle>
      <div className="row wrap mb">
        <div className="row grow" style={{ minWidth: 240 }}><Search size={16} className="muted" /><input className="input" placeholder="Buscar por nombre, cédula, correo o teléfono" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
        {[['all', 'Todos'], ['activa', 'Activos'], ['por_vencer', 'Por vencer'], ['vencida', 'Vencidos'], ['sin_plan', 'Sin plan']].map(([k, l]) =>
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      {list.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Cliente</th><th>Cédula</th><th>Contacto</th><th>Plan</th><th>Vence</th><th>Estado</th><th>Acceso</th><th /></tr></thead>
          <tbody>{list.map((m) => (
            <tr key={m.member_id} style={{ opacity: m.active ? 1 : .45 }}>
              <td><div className="row"><Avatar src={m.photo} name={m.full_name} /><b>{m.full_name}</b></div></td>
              <td>{m.cedula}</td><td className="small">{m.email}<br /><span className="muted">{m.phone}</span></td>
              <td>{m.plan_name || '—'}</td><td>{fmtDate(m.end_date)}</td><td><StatusBadge status={m.status} days={m.days_left} /></td>
              <td><span className="badge">QR</span> {m.nfc_uid && <span className="badge y">NFC</span>}</td>
              <td><div className="row" style={{ gap: 4 }}>
                <button className="btn sm primary" onClick={() => setRenew(m)}><RefreshCw size={14} /></button>
                <button className="icon-btn" onClick={() => openEdit(m)} title="Editar"><Pencil size={16} /></button>
                <button className="icon-btn" onClick={() => toggle(m)} title={m.active ? 'Desactivar' : 'Activar'}><Power size={16} /></button>
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>No hay clientes que coincidan.</Empty>}
      {form !== undefined && <MemberForm member={form} plans={data.plans} coaches={coaches} onClose={() => setForm(undefined)} onSaved={() => { setForm(undefined); reload() }} />}
      {renew && <RenewModal m={renew} plans={data.plans} onClose={() => setRenew(null)} onSaved={() => { setRenew(null); reload() }} />}
    </>
  )
}

// ---------------- Membresías ----------------
function Memberships({ data, reload, me }) {
  const [rows, setRows] = useState(null)
  const [renew, setRenew] = useState(null)
  const load = () => q(supabase.from('memberships').select('*, members(full_name, cedula, photo)').order('created_at', { ascending: false }).limit(300)).then(setRows)
  useEffect(() => { load() }, [])
  const del = async (id) => { if (confirmDel()) { await q(supabase.from('memberships').delete().eq('id', id)); load(); reload() } }
  return (
    <>
      <PageTitle a="MEMBRESÍAS" b="Y RENOVACIONES" />
      <div className="card hl mb">
        <h3>Comprobantes de transferencia por revisar</h3>
        <PendingProofs staffId={me?.id} onChanged={() => { load(); reload() }} />
      </div>
      <div className="grid g3 mb">
        {['activa', 'por_vencer', 'vencida'].map((s) => {
          const l = data.members.filter((m) => m.status === s)
          return (
            <div key={s} className="card">
              <div className="row between"><h3 style={{ margin: 0 }}><StatusBadge status={s} days="" /></h3><span className="display" style={{ fontSize: '2rem' }}>{l.length}</span></div>
              <div className="col mt" style={{ gap: 6, maxHeight: 200, overflow: 'auto' }}>
                {l.slice(0, 30).map((m) => <div key={m.member_id} className="row between small"><span>{m.full_name}</span>
                  <button className="btn sm" onClick={() => setRenew(m)}><RefreshCw size={12} /> Renovar</button></div>)}
              </div>
            </div>
          )
        })}
      </div>
      {!rows ? <Loading /> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Cliente</th><th>Plan</th><th>Inicio</th><th>Vence</th><th>Valor</th><th>Pago</th><th>Comprobante</th><th>Registrada</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.members?.full_name}</td><td>{r.plan_name}</td><td>{fmtDate(r.start_date)}</td><td>{fmtDate(r.end_date)}</td><td>{money(r.price)}</td>
              <td>{r.payment_method}{r.payment_ref ? <div className="tiny muted">{r.payment_ref}</div> : null}</td><td><ProofLink path={r.proof_path} /></td><td className="small muted">{fmtDateTime(r.created_at)}</td>
              <td><button className="icon-btn" onClick={() => del(r.id)}><Trash2 size={15} /></button></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {renew && <RenewModal m={renew} plans={data.plans} onClose={() => setRenew(null)} onSaved={() => { setRenew(null); load(); reload() }} />}
    </>
  )
}
const confirmDel = () => window.confirm('¿Eliminar este registro?')

// ---------------- Asistencia ----------------
function Attendance() {
  const [rows, setRows] = useState(null)
  const [date, setDate] = useState(today())
  useEffect(() => {
    setRows(null)
    q(supabase.from('attendance').select('*, members(full_name, cedula, photo)').gte('created_at', date + 'T00:00:00').lte('created_at', date + 'T23:59:59').order('created_at', { ascending: false })).then(setRows)
  }, [date])
  return (
    <>
      <PageTitle a="REGISTRO DE" b="ASISTENCIA"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 180 }} /></PageTitle>
      {!rows ? <Loading /> : rows.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Hora</th><th>Cliente</th><th>Cédula</th><th>Método</th><th>Resultado</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{new Date(r.created_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</td>
            <td><div className="row"><Avatar src={r.members?.photo} name={r.members?.full_name} />{r.members?.full_name}</div></td><td>{r.members?.cedula}</td>
            <td><span className="badge">{r.method.toUpperCase()}</span></td><td>{r.allowed ? <span className="badge ok">Permitido</span> : <span className="badge bad">Denegado</span>}</td></tr>)}</tbody>
        </table></div>
      ) : <Empty>Sin registros para esta fecha</Empty>}
    </>
  )
}

// ---------------- Planes ----------------
function Plans({ data, reload }) {
  const toast = useToast()
  const [f, setF] = useState(null)
  const save = async () => {
    try {
      const row = { name: f.name, days: Number(f.days), price: Number(f.price), active: f.active !== false }
      if (f.id) await q(supabase.from('plans').update(row).eq('id', f.id)); else await q(supabase.from('plans').insert(row))
      setF(null); reload()
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      <PageTitle a="PLANES DE" b="MEMBRESÍA"><button className="btn primary" onClick={() => setF({ name: '', days: 30, price: 0 })}><Plus size={16} /> Nuevo plan</button></PageTitle>
      <div className="grid auto">
        {data.plans.map((p) => (
          <div key={p.id} className="card card-click" onClick={() => setF(p)} style={{ opacity: p.active ? 1 : .5 }}>
            <div className="display" style={{ fontSize: '1.7rem' }}>{p.name}</div>
            <div className="display y" style={{ fontSize: '2.6rem' }}>{money(p.price)}</div>
            <div className="muted">{p.days} días</div>
          </div>
        ))}
      </div>
      {f && <Modal title={f.id ? 'Editar plan' : 'Nuevo plan'} onClose={() => setF(null)} footer={<button className="btn primary" onClick={save}>Guardar</button>}>
        <div className="grid g3">
          <Input label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input label="Días" type="number" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
          <Input label="Precio (COP)" type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <Select label="Estado" value={f.active === false ? 'no' : 'si'} onChange={(e) => setF({ ...f, active: e.target.value === 'si' })} options={[{ value: 'si', label: 'Activo' }, { value: 'no', label: 'Inactivo' }]} />
        </div>
      </Modal>}
    </>
  )
}

// ---------------- Personal ----------------
function Staff({ data, reload, me }) {
  const toast = useToast()
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!f.full_name || !f.email || !f.username) return toast('Nombre, correo y usuario son obligatorios', 'error')
    if (!f.id && (f.password || '').length < 4) return toast('La contraseña debe tener al menos 4 caracteres', 'error')
    setBusy(true)
    try {
      const row = { full_name: f.full_name, email: f.email.toLowerCase().trim(), username: f.username.toLowerCase().trim(), role: f.role, phone: f.phone || null, specialty: f.specialty || null, active: f.active !== false }
      let id = f.id
      if (id) await q(supabase.from('staff').update(row).eq('id', id))
      else id = (await q(supabase.from('staff').insert(row).select('id')))[0].id
      if (f.password) await setPassword('staff', id, f.password)
      toast('Usuario guardado', 'success'); setF(null); reload()
    } catch (e) { toast(e.message.includes('duplicate') ? 'Ese correo o usuario ya existe' : e.message, 'error') } finally { setBusy(false) }
  }
  const roleLbl = { admin: 'Administrador', coach: 'Coach / Entrenador', reception: 'Recepción' }
  return (
    <>
      <PageTitle a="COACHES Y" b="PERSONAL"><button className="btn primary" onClick={() => setF({ role: 'coach' })}><Plus size={16} /> Crear usuario</button></PageTitle>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Rol</th><th>Especialidad</th><th>Estado</th><th /></tr></thead>
        <tbody>{data.staff.map((s) => (
          <tr key={s.id}><td><div className="row"><Avatar name={s.full_name} /><b>{s.full_name}</b></div></td><td>{s.username}</td><td>{s.email}</td>
            <td><span className={`badge ${s.role === 'admin' ? 'y' : ''}`}>{roleLbl[s.role]}</span></td><td>{s.specialty || '—'}</td>
            <td>{s.active ? <span className="badge ok">Activo</span> : <span className="badge bad">Inactivo</span>}</td>
            <td><button className="icon-btn" onClick={() => setF({ ...s, password: '' })}><Pencil size={16} /></button></td></tr>
        ))}</tbody>
      </table></div>
      <p className="tiny muted mt">Accesos: clientes en <b>/</b>, coaches en <b>/coach</b>, recepción en <b>/check</b>, administración en <b>/admin</b>.</p>
      {f && <Modal title={f.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={() => setF(null)} footer={<button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : null} Guardar</button>}>
        <div className="grid g2">
          <Input label="Nombre completo" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          <Select label="Rol" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={Object.entries(roleLbl).map(([value, label]) => ({ value, label }))} />
          <Input label="Usuario" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          <Input label="Correo (para recuperar clave)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input label={f.id ? 'Nueva contraseña (opcional)' : 'Contraseña'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Input label="Teléfono" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Input label="Especialidad" value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} />
          <Select label="Estado" value={f.active === false ? 'no' : 'si'} onChange={(e) => setF({ ...f, active: e.target.value === 'si' })} options={[{ value: 'si', label: 'Activo' }, { value: 'no', label: 'Inactivo' }]} />
        </div>
        {f.id === me.id && <p className="tiny warn"><KeyRound size={12} /> Estás editando tu propio usuario.</p>}
      </Modal>}
    </>
  )
}

// ---------------- Modalidades (editables) ----------------
function Types({ data, reload }) {
  const toast = useToast()
  const [f, setF] = useState(null)
  const save = async () => {
    try {
      const row = { name: f.name, description: f.description, emoji: f.emoji || '🏋️', met: Number(f.met) || 5, wger_categories: f.wger_categories || [] }
      if (f.id) await q(supabase.from('training_types').update(row).eq('id', f.id)); else await q(supabase.from('training_types').insert(row))
      setF(null); reload()
    } catch (e) { toast(e.message, 'error') }
  }
  const del = async (id) => { if (confirmDel()) { await q(supabase.from('training_types').delete().eq('id', id)); setF(null); reload() } }
  const toggleCat = (c) => setF((x) => ({ ...x, wger_categories: (x.wger_categories || []).includes(c) ? x.wger_categories.filter((y) => y !== c) : [...(x.wger_categories || []), c] }))
  return (
    <>
      <PageTitle a="MODALIDADES DE" b="ENTRENAMIENTO"><button className="btn primary" onClick={() => setF({ name: '', emoji: '🏋️', met: 5, wger_categories: [] })}><Plus size={16} /> Agregar modalidad</button></PageTitle>
      <div className="grid auto">
        {data.types.map((t) => (
          <div key={t.id} className="card card-click" onClick={() => setF(t)}>
            <div style={{ fontSize: '2rem' }}>{t.emoji}</div><div style={{ fontWeight: 800 }}>{t.name}</div>
            <div className="small muted">{t.description}</div><div className="tiny y mt">MET {t.met}</div>
          </div>
        ))}
      </div>
      {f && <Modal title={f.id ? 'Editar modalidad' : 'Nueva modalidad'} onClose={() => setF(null)}
        footer={<>{f.id && <button className="btn danger" onClick={() => del(f.id)}><Trash2 size={16} /> Eliminar</button>}<button className="btn primary" onClick={save}>Guardar</button></>}>
        <div className="grid g3">
          <Input label="Emoji" value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} />
          <Input label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input label="MET (gasto energético)" type="number" step="0.5" value={f.met} onChange={(e) => setF({ ...f, met: e.target.value })} />
          <Field label="Descripción" span={3}><textarea className="input" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <Field label="Categorías de la biblioteca en línea (wger)">
          <div className="row wrap">{Object.entries(WGER_CATEGORIES).map(([id, n]) => <button key={id} type="button" className={`chip ${(f.wger_categories || []).includes(Number(id)) ? 'on' : ''}`} onClick={() => toggleCat(Number(id))}>{n}</button>)}</div>
        </Field>
      </Modal>}
    </>
  )
}
