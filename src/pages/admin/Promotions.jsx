import { useEffect, useMemo, useState } from 'react'
import { Send, Megaphone, Smartphone, Users, Image as ImageIcon, Upload, Trash2, Copy, RefreshCw, CheckCircle2, XCircle, Loader2, BellRing, Link2 } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { dispatchPush } from '../../lib/push'
import { fmtDateTime, addDays, today } from '../../lib/constants'
import { PageTitle, Stat, Input, Select, Field, Empty, Loading, Avatar, Spinner, useToast } from '../../components/ui'
import { CATEGORY } from '../../components/Notifications'

const TEMPLATES = [
  { category: 'promo', title: '🔥 2x1 en membresías', body: 'Trae a un amigo esta semana y paguen una sola mensualidad. ¡Cupos limitados!', url: '/?tab=profile' },
  { category: 'recordatorio', title: '⏰ Tu membresía está por vencer', body: 'Renueva antes del vencimiento y obtén 10% de descuento en tu próximo plan.', url: '/?tab=profile' },
  { category: 'evento', title: '🏆 Reto de fuerza este sábado', body: 'Participa en nuestro reto de powerlifting y streetlifting. ¡Premios para los 3 primeros!', url: '/' },
  { category: 'publicidad', title: '🥤 Nueva barra de batidos', body: 'Prueba nuestros batidos de proteína post-entreno con 20% de descuento.', url: '/?tab=nutri' },
  { category: 'aviso', title: '📢 Horario especial', body: 'Este feriado abriremos de 8:00 a 14:00. ¡Te esperamos!', url: '/' }
]

const DESTINATIONS = [
  { value: '/', label: 'Inicio / Entrenar' },
  { value: '/?tab=nutri', label: 'Nutricionista IA' },
  { value: '/?tab=progress', label: 'Mi progreso' },
  { value: '/?tab=body', label: 'Medidas e IMC' },
  { value: '/?tab=library', label: 'Ejercicios' },
  { value: '/?tab=store', label: 'Tienda' },
  { value: '/?tab=profile', label: 'Mi perfil / membresía' },
  { value: 'external', label: 'Enlace externo…' }
]

const AUDIENCES = [
  { id: 'all', label: 'Todos los clientes (activos e inactivos)' },
  { id: 'active', label: 'Membresía activa' },
  { id: 'expiring', label: 'Por vencer (≤5 días)' },
  { id: 'expired', label: 'Vencidos / sin plan / inactivos' },
  { id: 'modes', label: 'Por modalidad' },
  { id: 'members', label: 'Clientes específicos' }
]

const audienceLabel = (a, types) => {
  const base = AUDIENCES.find((x) => x.id === a?.type)?.label || 'Todos'
  if (a?.type === 'modes') return `${base}: ${(a.modes || []).join(', ')}`
  if (a?.type === 'members') return `${(a.ids || []).length} clientes`
  return base
}

/** Pestaña de promociones y publicidad vía notificaciones push. */
export default function Promotions({ data, me }) {
  const toast = useToast()
  const [members, setMembers] = useState(null)
  const [subs, setSubs] = useState([])
  const [history, setHistory] = useState(null)
  const [busy, setBusy] = useState(false)
  const [upl, setUpl] = useState(false)
  const [external, setExternal] = useState('')
  const [term, setTerm] = useState('')
  const [f, setF] = useState({ category: 'none', title: '', body: '', image_url: '', url: '/', audience: { type: 'all' } })

  const loadHistory = () => q(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)).then(setHistory)
  useEffect(() => {
    q(supabase.from('members').select('id, full_name, photo, training_modes, active').order('full_name')).then(setMembers)
    q(supabase.from('push_subscriptions').select('member_id, platform')).then(setSubs).catch(() => setSubs([]))
    loadHistory()
  }, [])

  const statusById = useMemo(() => Object.fromEntries(data.members.map((m) => [m.member_id, m.status])), [data.members])
  const recipients = useMemo(() => {
    if (!members) return []
    const a = f.audience
    if (a.type === 'all') return members.map((m) => m.id)
    if (a.type === 'members') return a.ids || []
    if (a.type === 'modes') return members.filter((m) => (m.training_modes || []).some((x) => (a.modes || []).includes(x))).map((m) => m.id)
    const ok = { active: ['activa', 'por_vencer'], expiring: ['por_vencer'], expired: ['vencida', 'sin_plan'] }[a.type]
    // "Vencidos" incluye también a los clientes inactivos; "activa" y "por vencer" solo a los activos
    return members.filter((m) => (a.type === 'expired' && !m.active) || (m.active && ok.includes(statusById[m.id]))).map((m) => m.id)
  }, [members, f.audience, statusById])
  const reachable = useMemo(() => {
    const set = new Set(recipients)
    return { devices: subs.filter((s) => set.has(s.member_id)).length, people: new Set(subs.filter((s) => set.has(s.member_id)).map((s) => s.member_id)).size }
  }, [recipients, subs])

  const setAud = (patch) => setF((x) => ({ ...x, audience: { ...x.audience, ...patch } }))
  const toggleIn = (key, val) => setF((x) => {
    const arr = x.audience[key] || []
    return { ...x, audience: { ...x.audience, [key]: arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val] } }
  })

  const upload = async (file) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return toast('La imagen debe pesar menos de 2 MB', 'error')
    setUpl(true)
    try {
      const path = `${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await supabase.storage.from('promos').upload(path, file, { contentType: file.type, upsert: false })
      if (error) throw error
      setF((x) => ({ ...x, image_url: supabase.storage.from('promos').getPublicUrl(path).data.publicUrl }))
    } catch (e) { toast('No se pudo subir la imagen: ' + e.message, 'error') } finally { setUpl(false) }
  }

  const send = async () => {
    if (!f.title.trim()) return toast('Escribe un título para la notificación', 'error')
    if (f.audience.type !== 'all' && !recipients.length) return toast('La audiencia seleccionada no tiene clientes', 'error')
    const url = f.url === 'external' ? external.trim() : f.url
    if (f.url === 'external' && !/^https?:\/\//.test(url)) return toast('El enlace externo debe empezar por https://', 'error')
    if (!window.confirm(`¿Enviar "${f.title}" a ${f.audience.type === 'all' ? 'todos los clientes' : recipients.length + ' clientes'}?`)) return
    setBusy(true)
    try {
      const [n] = await q(supabase.from('notifications').insert({
        title: f.title.trim(), body: f.body.trim(), image_url: f.image_url || null, url, category: f.category === 'none' ? 'aviso' : f.category,
        audience: f.audience, recipients: f.audience.type === 'all' ? null : recipients, created_by: me.id
      }).select())
      try {
        const r = await dispatchPush(n.id)
        const why = r.reasons?.length ? ` (${r.reasons.join('; ')})` : ''
        toast(`${r.failed && !r.sent ? '⚠️' : '✅'} Enviada a ${r.sent} dispositivos${r.local ? ` + ${r.local} app Android (se recoge en ~15 min)` : ''}${r.failed ? ` · ${r.failed} fallidos${why}` : ''}`, r.failed && !r.sent ? 'error' : 'success')
      } catch (e) {
        await q(supabase.from('notifications').update({ status: 'enviada', sent_at: new Date().toISOString(), error: 'Solo en la app (push no configurado): ' + e.message }).eq('id', n.id))
        toast('Publicada en la app. Para push con la app cerrada despliega la función send-push.', 'info')
      }
      setF((x) => ({ ...x, title: '', body: '', image_url: '' }))
      loadHistory()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const reuse = (n) => {
    const isInternal = !n.url || n.url.startsWith('/')
    setF({ category: n.category, title: n.title, body: n.body, image_url: n.image_url || '', url: isInternal ? n.url || '/' : 'external', audience: n.audience || { type: 'all' } })
    if (!isInternal) setExternal(n.url)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const del = async (id) => { if (window.confirm('¿Eliminar del historial? Los clientes dejarán de verla en su bandeja.')) { await q(supabase.from('notifications').delete().eq('id', id)); loadHistory() } }

  const sent30 = (history || []).filter((n) => n.created_at >= addDays(today(), -30))
  const C = CATEGORY[f.category] || CATEGORY.aviso
  if (!members || !history) return <Loading />

  return (
    <>
      <PageTitle a="PROMOCIONES Y" b="PUBLICIDAD" />
      <div className="grid g4">
        <Stat label="Dispositivos suscritos" value={subs.length} icon={Smartphone} y sub={`${subs.filter((s) => s.platform !== 'web').length} app nativa · ${subs.filter((s) => s.platform === 'web').length} web/PWA`} />
        <Stat label="Clientes con push" value={new Set(subs.map((s) => s.member_id)).size} icon={BellRing} sub={`de ${members.length} activos`} />
        <Stat label="Campañas (30 días)" value={sent30.length} icon={Megaphone} />
        <Stat label="Entregas (30 días)" value={sent30.reduce((s, n) => s + (n.sent_count || 0), 0)} icon={CheckCircle2} sub={`${sent30.reduce((s, n) => s + (n.failed_count || 0), 0)} fallidas`} />
      </div>

      <div className="grid mt split split-promo">
        <div className="card">
          <h3><Megaphone size={16} className="y" /> Nueva campaña</h3>
          <Field label="Plantillas rápidas">
            <div className="row wrap" style={{ gap: 6 }}>{TEMPLATES.map((t) => <button key={t.title} className="chip" onClick={() => setF((x) => ({ ...x, ...t }))}>{t.title.split(' ').slice(0, 3).join(' ')}</button>)}</div>
          </Field>
          <div className="grid g2 mt">
            <Select label="Tipo" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={[{ value: 'none', label: 'Sin tipo (general)' }, ...Object.entries(CATEGORY).filter(([value]) => value !== 'reto' && value !== 'aviso').map(([value, c]) => ({ value, label: c.label })), { value: 'aviso', label: 'Aviso' }]} />
            <Select label="Al tocar, abrir…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} options={DESTINATIONS} />
            {f.url === 'external' && <Input label="Enlace externo" value={external} onChange={(e) => setExternal(e.target.value)} placeholder="https://…" span={2} />}
            <Field label={`Título (${f.title.length}/60)`} span={2}><input className="input" maxLength={60} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="🔥 ¡Promo de la semana!" /></Field>
            <Field label={`Mensaje opcional (${f.body.length}/180)`} span={2}><textarea className="input" maxLength={180} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Opcional: no hace falta escribir un motivo o mensaje" /></Field>
            <Field label="Imagen (opcional)" span={2}>
              <div className="row">
                <input className="input" value={f.image_url} onChange={(e) => setF({ ...f, image_url: e.target.value })} placeholder="URL de la imagen o súbela →" />
                <label className="btn">{upl ? <Spinner /> : <Upload size={16} />}<input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files[0])} /></label>
              </div>
            </Field>
          </div>

          <Field label="Audiencia">
            <div className="row wrap" style={{ gap: 6 }}>{AUDIENCES.map((a) => <button key={a.id} className={`chip ${f.audience.type === a.id ? 'on' : ''}`} onClick={() => setF({ ...f, audience: { type: a.id } })}>{a.label}</button>)}</div>
          </Field>
          {f.audience.type === 'modes' && (
            <div className="row wrap mt" style={{ gap: 6 }}>{data.types.map((t) => <button key={t.id} className={`chip ${(f.audience.modes || []).includes(t.name) ? 'on' : ''}`} onClick={() => toggleIn('modes', t.name)}>{t.emoji} {t.name}</button>)}</div>
          )}
          {f.audience.type === 'members' && (
            <div className="mt">
              <input className="input mb" placeholder="Buscar cliente…" value={term} onChange={(e) => setTerm(e.target.value)} />
              <div className="col" style={{ maxHeight: 220, overflow: 'auto', gap: 4 }}>
                {members.filter((m) => !term || m.full_name.toLowerCase().includes(term.toLowerCase())).map((m) => {
                  const on = (f.audience.ids || []).includes(m.id)
                  return (
                    <label key={m.id} className="row" style={{ padding: 6, borderRadius: 8, cursor: 'pointer', background: on ? 'var(--y-soft)' : 'transparent' }}>
                      <input type="checkbox" checked={on} onChange={() => toggleIn('ids', m.id)} /><Avatar src={m.photo} name={m.full_name} /><span className="grow">{m.full_name}{!m.active && <span className="tiny muted"> · inactivo</span>}</span>
                      {subs.some((s) => s.member_id === m.id) && <BellRing size={14} className="y" />}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <div className="card mt row between wrap" style={{ background: 'var(--bg2)' }}>
            <div className="row"><Users className="y" /><div><b>{f.audience.type === 'all' ? members.length : recipients.length} clientes</b>
              <div className="small muted">{reachable.people} con push activo · {reachable.devices} dispositivos. El resto la verá en su bandeja al abrir la app.</div></div></div>
            <button className="btn primary lg" onClick={send} disabled={busy}>{busy ? <Spinner /> : <Send size={18} />} Enviar ahora</button>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <h3><Smartphone size={16} className="y" /> Vista previa</h3>
            <div className="phone">
              <div className="tiny muted center" style={{ marginBottom: 14 }}>{new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</div>
              <div className="phone-notif">
                <div className="row" style={{ padding: '10px 12px', gap: 8 }}>
                  <img src={`${import.meta.env.BASE_URL}icon.svg`} width="20" height="20" alt="" style={{ borderRadius: 5 }} />
                  <span className="tiny muted grow">IronYellow Gym · {C?.label}</span><span className="tiny muted">ahora</span>
                </div>
                <div style={{ padding: '0 12px 12px' }}>
                  <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{f.title || 'Título de la promoción'}</div>
                  <div className="small muted">{f.body || 'El mensaje de tu campaña aparecerá aquí.'}</div>
                </div>
                {f.image_url ? <img src={f.image_url} alt="" /> : <div className="center tiny muted" style={{ padding: 20, borderTop: '1px solid #333' }}><ImageIcon size={18} /> sin imagen</div>}
              </div>
            </div>
            <p className="tiny muted center mt"><Link2 size={11} /> Abre: {f.url === 'external' ? external || '—' : DESTINATIONS.find((d) => d.value === f.url)?.label}</p>
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="row between"><h3 style={{ margin: 0 }}>Historial de campañas</h3><button className="btn sm" onClick={loadHistory}><RefreshCw size={14} /></button></div>
        {history.length ? (
          <div className="table-wrap mt"><table className="t">
            <thead><tr><th>Fecha</th><th>Campaña</th><th>Tipo</th><th>Audiencia</th><th>Dispositivos</th><th>Entregadas</th><th>Estado</th><th /></tr></thead>
            <tbody>{history.map((n) => (
              <tr key={n.id}>
                <td className="small">{fmtDateTime(n.created_at)}</td>
                <td><div className="row">{n.image_url && <img src={n.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />}<div><b>{n.title}</b><div className="tiny muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div></div></div></td>
                <td><span className="badge">{CATEGORY[n.category]?.label}</span></td>
                <td className="small">{audienceLabel(n.audience)}</td>
                <td>{n.devices_count}</td>
                <td>{n.sent_count}{n.failed_count ? <span className="bad small"> / {n.failed_count} ✗</span> : ''}</td>
                <td title={n.error || ''}>
                  {n.status === 'enviada' && !n.error && <span className="badge ok"><CheckCircle2 size={11} /> Enviada</span>}
                  {n.status === 'enviada' && n.error && <span className="badge warn">Solo en app</span>}
                  {n.status === 'enviando' && <span className="badge"><Loader2 size={11} className="spin" /> Enviando</span>}
                  {n.status === 'pendiente' && <span className="badge">Pendiente</span>}
                  {n.status === 'error' && <span className="badge bad"><XCircle size={11} /> Error</span>}
                </td>
                <td><div className="row" style={{ gap: 4 }}>
                  <button className="icon-btn" title="Reutilizar" onClick={() => reuse(n)}><Copy size={15} /></button>
                  <button className="icon-btn" title="Eliminar" onClick={() => del(n.id)}><Trash2 size={15} /></button>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>Aún no has enviado campañas</Empty>}
      </div>
    </>
  )
}
