import { useEffect, useState } from 'react'
import { Dumbbell, LineChart, Scale, Bot, Library, User, KeyRound, Pencil, CalendarClock } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { getSession, setSession, clearSession, setPassword } from '../../lib/auth'
import { getStatus, getTrainingTypes } from '../../lib/data'
import { GOALS, fmtDate, money } from '../../lib/constants'
import Login from '../../components/Login'
import { Shell, PageTitle, Loading, Avatar, StatusBadge, Modal, Input, useToast } from '../../components/ui'
import { MemberAnalytics } from '../../components/Analytics'
import BodyMetrics from '../../components/BodyMetrics'
import NutritionAI from '../../components/NutritionAI'
import ExerciseBrowser from '../../components/ExerciseBrowser'
import { QRImage, WatchPanel } from '../../components/Media'
import { usePushInbox, PushBanner, NotificationBell, PushOptIn } from '../../components/Notifications'
import { ClientTransfer, ProofLink } from '../../components/Payments'
import Onboarding from './Onboarding'
import Training from './Training'
import Classes from './Classes'
import { memberSchedules } from '../../lib/classes'

const NAV = [
  { id: 'train', label: 'Entrenar', icon: Dumbbell },
  { id: 'progress', label: 'Progreso', icon: LineChart },
  { id: 'body', label: 'Medidas e IMC', short: 'Medidas', icon: Scale },
  { id: 'nutri', label: 'Nutricionista IA', short: 'Nutrición', icon: Bot },
  { id: 'library', label: 'Ejercicios', icon: Library },
  { id: 'profile', label: 'Mi perfil', short: 'Perfil', icon: User }
]

export default function ClientApp() {
  const toast = useToast()
  const [me, setMe] = useState(() => getSession('member'))
  const [tab, setTab] = useState('train')
  const [types, setTypes] = useState(null)
  const [status, setStatus] = useState(null)

  const refresh = async () => {
    const [m] = await q(supabase.from('members').select('*').eq('id', me.id))
    if (!m || !m.active) { clearSession('member'); setMe(null); return }
    const { face_descriptors, ...rest } = m
    setMe(rest); setSession('member', rest)
    setStatus(await getStatus(me.id))
  }

  useEffect(() => {
    if (!me) return
    getTrainingTypes().then(setTypes)
    refresh().catch((e) => toast(e.message, 'error'))
  }, [me?.id])

  if (!me) return <Login scope="member" onLogin={(u) => { setSession('member', u); setMe(u) }} />
  if (!types) return <div className="main"><Loading /></div>

  const saveProfile = async (patch) => {
    await q(supabase.from('members').update(patch).eq('id', me.id))
    await refresh()
    toast('Perfil actualizado', 'success')
  }

  if (!me.onboarded) return <Onboarding member={me} types={types} onSave={saveProfile} />

  return <ClientMain me={me} status={status} types={types} tab={tab} setTab={setTab} saveProfile={saveProfile} onLogout={() => { clearSession('member'); setMe(null) }} />
}

function ClientMain({ me, status, types, tab, setTab, saveProfile, onLogout }) {
  // Pestaña "Clases": aparece si eligió Box (u otra modalidad con clases) o si está en un grupo
  const [hasClasses, setHasClasses] = useState(false)
  useEffect(() => { memberSchedules(me).then((r) => setHasClasses(r.schedules.length > 0)).catch(() => {}) }, [me.id, (me.training_modes || []).join()])
  const nav = hasClasses ? [NAV[0], { id: 'classes', label: 'Clases', icon: CalendarClock }, ...NAV.slice(1)] : NAV
  // Abre el destino de una notificación: pestaña interna (?tab=...) o enlace externo
  const openUrl = (url) => {
    if (!url) return
    if (/^https?:/i.test(url) && !url.startsWith(location.origin)) { window.open(url, '_blank', 'noopener'); return }
    const t = new URL(url, location.origin).searchParams.get('tab')
    if (t && (t === 'classes' || NAV.some((n) => n.id === t))) setTab(t)
  }
  const inbox = usePushInbox(me, openUrl)
  useEffect(() => { openUrl(location.href) }, [])

  const first = me.full_name.split(' ')[0]
  const bell = <NotificationBell inbox={inbox} onOpen={openUrl} />
  return (
    <Shell sub="MI ENTRENAMIENTO" nav={nav} value={tab} onChange={setTab} user={me} onLogout={onLogout}>
      <PushBanner n={inbox.banner} onClose={inbox.closeBanner} onOpen={openUrl} />
      {tab === 'train' && <><PageTitle a="HOLA," b={first.toUpperCase()}><WatchPanel compact />{bell}</PageTitle><div className="mb"><PushOptIn member={me} compact /></div><Training member={me} status={status} types={types} /></>}
      {tab === 'classes' && <><PageTitle a="MIS" b="CLASES">{bell}</PageTitle><Classes member={me} /></>}
      {tab === 'progress' && <><PageTitle a="MI" b="PROGRESO">{bell}</PageTitle><MemberAnalytics memberId={me.id} /></>}
      {tab === 'body' && <><PageTitle a="MEDIDAS" b="E IMC">{bell}</PageTitle><BodyMetrics member={me} /></>}
      {tab === 'nutri' && <><PageTitle a="NUTRICIONISTA" b="IA">{bell}</PageTitle><NutritionAI member={me} /></>}
      {tab === 'library' && <><PageTitle a="EJERCICIOS" b="POR MODALIDAD">{bell}</PageTitle><ExerciseBrowser types={types} initialType={me.training_modes?.[0]} /></>}
      {tab === 'profile' && <Profile me={me} status={status} types={types} onSave={saveProfile} bell={bell} />}
    </Shell>
  )
}

function Profile({ me, status, types, onSave, bell }) {
  const toast = useToast()
  const [hist, setHist] = useState([])
  const [edit, setEdit] = useState(false)
  const [pw, setPw] = useState(null)
  useEffect(() => { q(supabase.from('memberships').select('*').eq('member_id', me.id).order('end_date', { ascending: false })).then(setHist) }, [me.id])
  const goal = GOALS.find((g) => g.id === me.goal)

  const changePw = async () => {
    if (pw.a !== pw.b) return toast('Las contraseñas no coinciden', 'error')
    try { await setPassword('member', me.id, pw.a); toast('Contraseña actualizada', 'success'); setPw(null) } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <PageTitle a="MI" b="PERFIL">
        {bell}
        <button className="btn" onClick={() => setPw({ a: '', b: '' })}><KeyRound size={16} /> Contraseña</button>
        <button className="btn primary" onClick={() => setEdit(true)}><Pencil size={16} /> Objetivo y modalidades</button>
      </PageTitle>
      <div className="grid g3">
        <div className="card center">
          <Avatar lg src={me.photo} name={me.full_name} />
          <h2 className="display" style={{ fontSize: '1.8rem', margin: '10px 0 2px' }}>{me.full_name}</h2>
          <div className="muted small">C.I. {me.cedula} · {me.email}</div>
          <div className="mt"><StatusBadge status={status?.status} days={status?.days_left} /></div>
          <div className="mt"><span className="badge y">{goal?.emoji} {goal?.label}</span> <span className="badge" style={{ textTransform: 'capitalize' }}>{me.level}</span></div>
          <div className="row wrap mt" style={{ justifyContent: 'center', gap: 6 }}>{(me.training_modes || []).map((m) => <span key={m} className="badge">{types.find((t) => t.name === m)?.emoji} {m}</span>)}</div>
        </div>
        <div className="card">
          <h3>Mi acceso al gimnasio</h3>
          <QRImage value={me.qr_code} name={me.full_name} size={180} />
          <p className="tiny muted center">Muestra este QR en recepción o usa tu tag NFC {me.nfc_uid ? '(asignado ✅)' : '(sin asignar)'}.</p>
        </div>
        <div className="col"><WatchPanel /><PushOptIn member={me} /></div>
      </div>
      <div className="card mt">
        <h3>Historial de membresías</h3>
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Plan</th><th>Inicio</th><th>Vence</th><th>Valor</th><th>Pago</th><th>Comprobante</th></tr></thead>
          <tbody>{hist.map((h) => <tr key={h.id}><td>{h.plan_name}</td><td>{fmtDate(h.start_date)}</td><td>{fmtDate(h.end_date)}</td><td>{money(h.price)}</td>
            <td className="small">{h.payment_method}</td><td><ProofLink path={h.proof_path} /></td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="mt"><ClientTransfer member={me} /></div>
      {edit && <Modal title="Objetivo y modalidades" onClose={() => setEdit(false)} wide>
        <Onboarding editing member={me} types={types} onSave={async (p) => { await onSave(p); setEdit(false) }} />
      </Modal>}
      {pw && <Modal title="Cambiar contraseña" onClose={() => setPw(null)} footer={<button className="btn primary" onClick={changePw}>Guardar</button>}>
        <div className="col">
          <Input label="Nueva contraseña" type="password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
          <Input label="Repetir contraseña" type="password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
        </div>
      </Modal>}
    </>
  )
}
