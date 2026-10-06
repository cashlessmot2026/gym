import { useEffect, useRef, useState } from 'react'
import { Paperclip, Camera, FileText, X, ExternalLink, ReceiptText, CheckCircle2, XCircle, Hourglass, Send } from 'lucide-react'
import { supabase, q } from '../lib/supabase'
import { addDays, fmtDate, fmtDateTime, money, today } from '../lib/constants'
import { Modal, Input, Select, Spinner, Empty, useToast } from './ui'
import { useCamera, useFacing, CameraSwitch } from './Media'

const BUCKET = 'comprobantes'
const MAX_MB = 8

/** Reduce fotos grandes (cámaras de 12+ MP) a JPEG de máx. 1600 px antes de subirlas. */
async function compressImage(file, max = 1600) {
  if (!file.type.startsWith('image/') || file.type === 'image/heic') return file
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file) })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(img.src)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82))
  return blob && blob.size < file.size ? new File([blob], 'comprobante.jpg', { type: 'image/jpeg' }) : file
}

/** Sube el comprobante al bucket privado y devuelve su ruta. */
export async function uploadProof(file, memberId) {
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`El archivo supera ${MAX_MB} MB`)
  const f = await compressImage(file)
  const ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : 'jpg'
  const path = `${memberId || 'sin-cliente'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false })
  if (error) throw new Error(error.message.includes('not found') ? 'Falta crear el bucket "comprobantes": ejecuta supabase/03_pagos_cop.sql' : error.message)
  return path
}

const signedUrl = async (path) => {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
  if (error) throw error
  return data.signedUrl
}

/** Toma una foto con la cámara del dispositivo (frontal o trasera). */
function CameraShot({ onShot, onClose }) {
  const [facing, toggle] = useFacing('proof', 'environment')
  const { ref, err, ready } = useCamera(true, facing, 1920, 1080)
  const shoot = () => {
    const v = ref.current
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    c.toBlob((b) => b && onShot(new File([b], 'comprobante.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9)
  }
  return (
    <Modal title="Foto del comprobante" onClose={onClose}>
      <div className={`cam ${facing === 'environment' ? 'rear' : ''}`} style={{ aspectRatio: '3/4', maxHeight: '60vh' }}>
        <video ref={ref} playsInline muted autoPlay />
        <div className="cam-tools"><CameraSwitch facing={facing} onToggle={toggle} /></div>
        {(err || !ready) && <div className="cam-loading">{!err && <Spinner size={26} />}<span>{err || 'Abriendo cámara…'}</span></div>}
      </div>
      <p className="tiny muted center">Encuadra todo el comprobante, con buena luz y sin reflejos.</p>
      <button type="button" className="btn primary block lg" onClick={shoot} disabled={!ready}><Camera size={18} /> Tomar foto</button>
    </Modal>
  )
}

/**
 * Casilla para adjuntar o fotografiar el comprobante de transferencia.
 * value: ruta en el bucket (string) · onChange(ruta | null)
 */
export function ProofPicker({ value, onChange, memberId, label = 'Comprobante de transferencia' }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const camRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [cam, setCam] = useState(false)
  const touch = window.matchMedia?.('(pointer: coarse)').matches

  const handle = async (file) => {
    if (!file) return
    setBusy(true); setCam(false)
    try {
      const path = await uploadProof(file, memberId)
      setPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : 'pdf')
      onChange(path)
      toast('Comprobante adjuntado', 'success')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="proof-box">
      <div className="row between"><b className="small"><ReceiptText size={14} className="y" /> {label}</b>
        {value && <button type="button" className="icon-btn" title="Quitar" onClick={() => { onChange(null); setPreview(null) }}><X size={16} /></button>}</div>
      {value ? (
        <div className="row mt">
          {preview && preview !== 'pdf' ? <img src={preview} alt="" className="proof-thumb" /> : <div className="proof-thumb pdf"><FileText /></div>}
          <div className="grow small"><span className="badge ok"><CheckCircle2 size={11} /> Adjuntado</span><div className="tiny muted mt">Puedes reemplazarlo con los botones.</div></div>
        </div>
      ) : <p className="tiny muted" style={{ margin: '6px 0' }}>Adjunta la imagen o PDF del pago, o tómale una foto.</p>}
      <div className="row wrap mt" style={{ gap: 8 }}>
        <button type="button" className="btn sm" disabled={busy} onClick={() => fileRef.current.click()}>{busy ? <Spinner size={14} /> : <Paperclip size={14} />} Adjuntar archivo</button>
        <button type="button" className="btn sm" disabled={busy} onClick={() => (touch ? camRef.current.click() : setCam(true))}><Camera size={14} /> Tomar foto</button>
      </div>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { handle(e.target.files[0]); e.target.value = '' }} />
      {/* En móviles abre directamente la cámara trasera del sistema */}
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { handle(e.target.files[0]); e.target.value = '' }} />
      {cam && <CameraShot onShot={handle} onClose={() => setCam(false)} />}
    </div>
  )
}

/** Botón para ver un comprobante guardado (enlace firmado temporal). */
export function ProofLink({ path, label = 'Ver' }) {
  const toast = useToast()
  const [url, setUrl] = useState(null)
  if (!path) return <span className="muted small">—</span>
  const open = async () => {
    try {
      const u = await signedUrl(path)
      if (path.endsWith('.pdf')) window.open(u, '_blank', 'noopener'); else setUrl(u)
    } catch (e) { toast('No se pudo abrir el comprobante: ' + e.message, 'error') }
  }
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={open}><ReceiptText size={14} /> {label}</button>
      {url && (
        <Modal title="Comprobante" onClose={() => setUrl(null)}>
          <img src={url} alt="Comprobante" style={{ width: '100%', borderRadius: 12, background: '#fff' }} />
          <a className="btn block mt" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir en otra pestaña</a>
        </Modal>
      )}
    </>
  )
}

const STATUS = {
  pendiente: ['warn', 'En revisión', Hourglass],
  aprobado: ['ok', 'Aprobado', CheckCircle2],
  rechazado: ['bad', 'Rechazado', XCircle]
}
export const ProofStatus = ({ s }) => { const [c, t, I] = STATUS[s] || STATUS.pendiente; return <span className={`badge ${c}`}><I size={11} /> {t}</span> }

/** Perfil del cliente: pagar/renovar por transferencia subiendo el comprobante. */
export function ClientTransfer({ member }) {
  const toast = useToast()
  const [plans, setPlans] = useState([])
  const [list, setList] = useState(null)
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => q(supabase.from('payment_proofs').select('*').eq('member_id', member.id).order('created_at', { ascending: false })).then(setList).catch(() => setList([]))
  useEffect(() => {
    q(supabase.from('plans').select('*').eq('active', true).order('days')).then(setPlans).catch(() => {})
    load()
  }, [member.id])

  const send = async () => {
    const plan = plans.find((p) => p.id === f.plan_id)
    if (!plan) return toast('Elige el plan que pagaste', 'error')
    if (!f.proof_path) return toast('Adjunta o toma una foto del comprobante', 'error')
    setBusy(true)
    try {
      await q(supabase.from('payment_proofs').insert({ member_id: member.id, plan_id: plan.id, plan_name: plan.name, amount: plan.price, reference: f.reference || null, proof_path: f.proof_path }))
      toast('Comprobante enviado. El gimnasio lo revisará pronto.', 'success')
      setF(null); load()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="row between wrap"><h3 style={{ margin: 0 }}><ReceiptText size={16} className="y" /> Pagos por transferencia</h3>
        <button className="btn sm primary" onClick={() => setF({ plan_id: plans.find((p) => p.days === 30)?.id || plans[0]?.id })} disabled={!plans.length}><Send size={14} /> Enviar comprobante</button></div>
      <p className="small muted">¿Renovaste por transferencia? Envía el comprobante y el gimnasio activará tu plan al verificarlo.</p>
      {list === null ? <Spinner /> : list.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Fecha</th><th>Plan</th><th>Valor</th><th>Estado</th><th>Comprobante</th></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.id}><td className="small">{fmtDateTime(p.created_at)}</td><td>{p.plan_name}</td><td>{money(p.amount)}</td>
              <td><ProofStatus s={p.status} />{p.notes && <div className="tiny muted">{p.notes}</div>}</td><td><ProofLink path={p.proof_path} /></td></tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>Aún no has enviado comprobantes</Empty>}
      {f && (
        <Modal title="Enviar comprobante" onClose={() => setF(null)} footer={<button className="btn primary" onClick={send} disabled={busy}>{busy ? <Spinner /> : <Send size={16} />} Enviar</button>}>
          <div className="col">
            <Select label="Plan pagado" value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })} options={plans.map((p) => ({ value: p.id, label: `${p.name} (${p.days} días) · ${money(p.price)}` }))} />
            <Input label="Número de referencia / aprobación (opcional)" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
            <ProofPicker value={f.proof_path} onChange={(proof_path) => setF((x) => ({ ...x, proof_path }))} memberId={member.id} />
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * Admin: comprobantes enviados por clientes. Al aprobar se crea la membresía
 * (a partir del vencimiento actual si sigue activa) con el comprobante adjunto.
 */
export function PendingProofs({ staffId, memberId, onChanged }) {
  const toast = useToast()
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)
  const load = () => {
    let qy = supabase.from('payment_proofs').select('*, members(full_name, cedula)').order('created_at', { ascending: false }).limit(100)
    qy = memberId ? qy.eq('member_id', memberId) : qy.eq('status', 'pendiente')
    return q(qy).then(setList).catch(() => setList([]))
  }
  useEffect(() => { load() }, [memberId])

  const approve = async (p) => {
    setBusy(p.id)
    try {
      const [plan] = await q(supabase.from('plans').select('*').eq('id', p.plan_id))
      const [last] = await q(supabase.from('memberships').select('end_date').eq('member_id', p.member_id).order('end_date', { ascending: false }).limit(1))
      const start = last && last.end_date >= today() ? last.end_date : today()
      const [ms] = await q(supabase.from('memberships').insert({
        member_id: p.member_id, plan_id: p.plan_id, plan_name: p.plan_name, start_date: start, end_date: addDays(start, plan?.days || 30),
        price: p.amount, payment_method: 'transferencia', payment_ref: p.reference, proof_path: p.proof_path
      }).select())
      await q(supabase.from('payment_proofs').update({ status: 'aprobado', membership_id: ms.id, reviewed_by: staffId, reviewed_at: new Date().toISOString() }).eq('id', p.id))
      toast(`Pago aprobado: membresía hasta ${fmtDate(ms.end_date)}`, 'success'); load(); onChanged?.()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(null) }
  }
  const reject = async (p) => {
    const notes = window.prompt('Motivo del rechazo (lo verá el cliente):', 'No se encontró el pago')
    if (notes === null) return
    await q(supabase.from('payment_proofs').update({ status: 'rechazado', notes, reviewed_by: staffId, reviewed_at: new Date().toISOString() }).eq('id', p.id))
    toast('Comprobante rechazado'); load(); onChanged?.()
  }

  if (list === null) return <Spinner />
  if (!list.length) return <Empty>{memberId ? 'Este cliente no ha enviado comprobantes' : 'No hay comprobantes pendientes'}</Empty>
  return (
    <div className="table-wrap"><table className="t">
      <thead><tr><th>Fecha</th>{!memberId && <th>Cliente</th>}<th>Plan</th><th>Valor</th><th>Referencia</th><th>Comprobante</th><th>Estado</th><th /></tr></thead>
      <tbody>{list.map((p) => (
        <tr key={p.id}><td className="small">{fmtDateTime(p.created_at)}</td>{!memberId && <td>{p.members?.full_name}<div className="tiny muted">C.I. {p.members?.cedula}</div></td>}
          <td>{p.plan_name}</td><td>{money(p.amount)}</td><td className="small">{p.reference || '—'}</td><td><ProofLink path={p.proof_path} /></td>
          <td><ProofStatus s={p.status} /></td>
          <td>{p.status === 'pendiente' && <div className="row" style={{ gap: 4 }}>
            <button className="btn sm primary" disabled={busy === p.id} onClick={() => approve(p)}>{busy === p.id ? <Spinner size={14} /> : <CheckCircle2 size={14} />} Aprobar</button>
            <button className="btn sm danger" onClick={() => reject(p)}><XCircle size={14} /></button></div>}</td></tr>
      ))}</tbody>
    </table></div>
  )
}
