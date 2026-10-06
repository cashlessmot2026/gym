import { useEffect, useState } from 'react'
import { Save, Nfc, ScanFace, QrCode, CheckCircle2, CreditCard } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { setPassword } from '../../lib/auth'
import { assignNfcTag, nfcSupported } from '../../lib/nfc'
import { addDays, today, money } from '../../lib/constants'
import { Modal, Input, Select, Field, Spinner, Avatar, useToast } from '../../components/ui'
import { FaceEnroll, QRImage } from '../../components/Media'

const genCode = () => 'IY-' + Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()

/** Formulario de inscripción / edición de cliente. */
export default function MemberForm({ member, plans, coaches, onClose, onSaved }) {
  const toast = useToast()
  const isNew = !member
  const [f, setF] = useState(() => member ? { ...member } : { qr_code: genCode(), sex: 'M', active: true })
  const [pass, setPass] = useState('')
  const [plan, setPlan] = useState({ plan_id: plans.find((p) => p.days === 30)?.id || plans[0]?.id, start_date: today(), payment_method: 'efectivo' })
  const [face, setFace] = useState(false)
  const [nfcBusy, setNfcBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const selPlan = plans.find((p) => p.id === plan.plan_id)

  useEffect(() => {
    // al editar, carga descriptores (no vienen en el listado)
    if (member) q(supabase.from('members').select('face_descriptors, photo').eq('id', member.id)).then(([r]) => r && setF((x) => ({ ...x, ...r })))
  }, [member])

  const assignNfc = async () => {
    setNfcBusy(true)
    try {
      const uid = await assignNfcTag(f.qr_code)
      setF((x) => ({ ...x, nfc_uid: uid }))
      toast(`Tag NFC asignado: ${uid}`, 'success')
    } catch (e) { toast(e.message, 'error') } finally { setNfcBusy(false) }
  }

  const save = async () => {
    if (!f.full_name || !f.cedula) return toast('Nombre y cédula son obligatorios', 'error')
    if (isNew && pass.length < 4) return toast('Asigna una contraseña de al menos 4 caracteres', 'error')
    setBusy(true)
    try {
      const row = {
        cedula: f.cedula.trim(), full_name: f.full_name.trim(), email: f.email?.trim().toLowerCase() || null, phone: f.phone || null,
        birthdate: f.birthdate || null, sex: f.sex, address: f.address || null, emergency_name: f.emergency_name || null,
        emergency_phone: f.emergency_phone || null, medical_notes: f.medical_notes || null, photo: f.photo || null,
        face_descriptors: f.face_descriptors || null, qr_code: f.qr_code, nfc_uid: f.nfc_uid?.trim() || null,
        coach_id: f.coach_id || null, active: f.active !== false
      }
      let id = member?.id
      if (isNew) id = (await q(supabase.from('members').insert(row).select('id')))[0].id
      else await q(supabase.from('members').update(row).eq('id', id))
      if (pass) await setPassword('member', id, pass)
      if (isNew && selPlan) {
        await q(supabase.from('memberships').insert({
          member_id: id, plan_id: selPlan.id, plan_name: selPlan.name, start_date: plan.start_date,
          end_date: addDays(plan.start_date, selPlan.days), price: selPlan.price, payment_method: plan.payment_method
        }))
      }
      toast(isNew ? 'Cliente inscrito correctamente' : 'Cliente actualizado', 'success')
      onSaved()
    } catch (e) { toast(e.message.includes('duplicate') ? 'Ya existe un cliente con esa cédula, correo, QR o NFC' : e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal title={isNew ? 'Inscripción de cliente' : 'Editar cliente'} onClose={onClose} wide
      footer={<><button className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner /> : <Save size={16} />} Guardar</button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 18 }}>
        <div className="col">
          <div className="grid g2">
            <Input label="Nombre completo *" value={f.full_name} onChange={set('full_name')} />
            <Input label="Cédula *" value={f.cedula} onChange={set('cedula')} />
            <Input label="Correo (usuario)" type="email" value={f.email} onChange={set('email')} />
            <Input label="Teléfono" value={f.phone} onChange={set('phone')} />
            <Input label="Fecha de nacimiento" type="date" value={f.birthdate} onChange={set('birthdate')} />
            <Select label="Sexo" value={f.sex} onChange={set('sex')} options={[{ value: 'M', label: 'Masculino' }, { value: 'F', label: 'Femenino' }]} />
            <Input label="Dirección" value={f.address} onChange={set('address')} span={2} />
            <Input label="Contacto de emergencia" value={f.emergency_name} onChange={set('emergency_name')} />
            <Input label="Teléfono de emergencia" value={f.emergency_phone} onChange={set('emergency_phone')} />
            <Select label="Coach asignado" value={f.coach_id || ''} onChange={set('coach_id')} options={[{ value: '', label: '— Sin coach —' }, ...coaches.map((c) => ({ value: c.id, label: c.full_name }))]} />
            <Input label={isNew ? 'Contraseña *' : 'Nueva contraseña (opcional)'} type="text" value={pass} onChange={(e) => setPass(e.target.value)} />
            <Field label="Notas médicas / lesiones" span={2}><textarea className="input" value={f.medical_notes || ''} onChange={set('medical_notes')} /></Field>
          </div>

          {isNew && (
            <div className="card" style={{ background: 'var(--bg2)' }}>
              <h3><CreditCard size={16} className="y" /> Membresía inicial</h3>
              <div className="grid g3">
                <Select label="Plan" value={plan.plan_id} onChange={(e) => setPlan({ ...plan, plan_id: e.target.value })} options={plans.map((p) => ({ value: p.id, label: `${p.name} · ${money(p.price)}` }))} />
                <Input label="Inicio" type="date" value={plan.start_date} onChange={(e) => setPlan({ ...plan, start_date: e.target.value })} />
                <Select label="Pago" value={plan.payment_method} onChange={(e) => setPlan({ ...plan, payment_method: e.target.value })} options={['efectivo', 'tarjeta', 'transferencia', 'otro']} />
              </div>
              {selPlan && <p className="small muted">Vence el <b className="y">{addDays(plan.start_date, selPlan.days)}</b> ({selPlan.days} días)</p>}
            </div>
          )}
        </div>

        <div className="col">
          <div className="card center">
            <h3><ScanFace size={16} className="y" /> Reconocimiento facial</h3>
            <Avatar lg src={f.photo} name={f.full_name} />
            <div className="small mt">{f.face_descriptors?.length ? <span className="badge ok"><CheckCircle2 size={12} /> {f.face_descriptors.length} muestras registradas</span> : <span className="badge warn">Sin rostro registrado</span>}</div>
            <button type="button" className="btn block mt" onClick={() => setFace(true)}><ScanFace size={16} /> {f.face_descriptors?.length ? 'Volver a registrar' : 'Registrar rostro'}</button>
          </div>
          <div className="card">
            <h3><QrCode size={16} className="y" /> Código QR</h3>
            <QRImage value={f.qr_code} name={f.full_name} size={150} />
          </div>
          <div className="card">
            <h3><Nfc size={16} className="y" /> Tag NFC</h3>
            <button type="button" className="btn primary block" onClick={assignNfc} disabled={nfcBusy}>{nfcBusy ? <><Spinner /> Acerca el tag…</> : <><Nfc size={16} /> Asignar NFC</>}</button>
            {!nfcSupported() && <p className="tiny muted">Web NFC sólo en Chrome Android. Con lector USB: haz clic en el campo y pasa el tag.</p>}
            <div className="mt"><Input label="UID del tag" value={f.nfc_uid} onChange={set('nfc_uid')} placeholder="04:A2:3F:..." /></div>
          </div>
        </div>
      </div>
      {face && (
        <Modal title="Registro facial" onClose={() => setFace(false)}>
          <FaceEnroll onDone={({ descriptors, photo }) => { setF((x) => ({ ...x, face_descriptors: descriptors, photo: photo || x.photo })); setFace(false); toast('Rostro registrado', 'success') }} />
          <p className="tiny muted mt">Se capturan 5 muestras frontales de alta calidad para un reconocimiento preciso (umbral estricto 0.45).</p>
        </Modal>
      )}
    </Modal>
  )
}
