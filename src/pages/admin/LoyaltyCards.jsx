import { useEffect, useState } from 'react'
import { Plus, ScanLine, Trash2, Eye, Copy, MessageCircle, Gift, CalendarPlus, Search, Ticket } from 'lucide-react'
import { LOYALTY_PLANS, listCards, createCard, deleteCard, confirmDay, redeemGift, cardLink, parseCardCode, whatsappLink } from '../../lib/loyalty'
import { fmtDateTime, money } from '../../lib/constants'
import LoyaltyCard from '../../components/LoyaltyCard'
import { QRScanner } from '../../components/Media'
import { PageTitle, Loading, Empty, Modal, Input, Field, Spinner, useToast } from '../../components/ui'

/** Clientes temporales: el admin crea su tarjeta de fidelidad (7 o 14 días) y confirma cada día pagado. */
export default function LoyaltyCards({ me }) {
  const toast = useToast()
  const [cards, setCards] = useState(null)
  const [term, setTerm] = useState('')
  const [form, setForm] = useState(null)
  const [view, setView] = useState(null)
  const [scan, setScan] = useState(false)
  const [busy, setBusy] = useState('')

  const load = async () => { try { setCards(await listCards()) } catch (e) { toast(e.message, 'error'); setCards([]) } }
  useEffect(() => { load() }, [])

  const run = async (key, fn) => {
    setBusy(key)
    try { await fn(); await load() } catch (e) { toast(e.message, 'error') } finally { setBusy('') }
  }
  const day = (c) => run(c.id + 'd', async () => {
    const r = await confirmDay(c.code, me.id)
    if (r.closed) toast(`${r.name} completó sus ${r.plan_days} días. La tarjeta se cerró.`, 'success')
    else if (r.gift) toast(`¡${r.name} completó los ${r.plan_days} días! Ganó 1 día de regalo 🎁`, 'success')
    else toast(`Día ${r.day} de ${r.plan_days} confirmado para ${r.name}`, 'success')
    setView(null)
  })
  const gift = (c) => {
    if (!window.confirm(`¿Usar el día de regalo de ${c.full_name}? Después la tarjeta se elimina.`)) return
    run(c.id + 'g', async () => { const r = await redeemGift(c.code, me.id); toast(`Día de regalo usado. La tarjeta de ${r.name} se cerró.`, 'success'); setView(null) })
  }
  const remove = (c) => {
    if (!window.confirm(`¿Eliminar la tarjeta de ${c.full_name}? No se puede deshacer.`)) return
    run(c.id + 'x', async () => { await deleteCard(c.id); toast('Tarjeta eliminada', 'success'); setView(null) })
  }
  const copy = async (c) => {
    try { await navigator.clipboard.writeText(cardLink(c.token)); toast('Link de la tarjeta copiado', 'success') } catch { window.prompt('Copia el link:', cardLink(c.token)) }
  }
  const onScan = (text) => {
    const code = parseCardCode(text)
    const c = cards?.find((x) => x.code === code || x.token === code)
    if (!c) return toast('Esa tarjeta no existe o ya terminó', 'error')
    setScan(false); setView(c)
  }

  if (!cards) return <Loading />
  const list = cards.filter((c) => !term || [c.full_name, c.phone, c.code].some((v) => v?.toLowerCase().includes(term.toLowerCase())))
  const actions = (c) => ({ day: () => day(c), gift: () => gift(c), remove: () => remove(c), copy: () => copy(c), busy })

  return (
    <>
      <PageTitle a="TARJETAS DE" b="FIDELIDAD">
        <button className="btn" onClick={() => setScan(true)}><ScanLine size={16} /> Escanear tarjeta</button>
        <button className="btn primary" onClick={() => setForm({ full_name: '', phone: '', plan_days: 14, price: '' })}><Plus size={16} /> Nueva tarjeta</button>
      </PageTitle>

      <div className="grid g2 mb">
        {LOYALTY_PLANS.map((p) => (
          <div key={p.days} className="card">
            <div className="row between"><b className="display" style={{ fontSize: '1.6rem' }}>Plan {p.label}</b>{p.gift ? <span className="badge y"><Gift size={12} /> +1 día gratis</span> : <span className="badge">Sin obsequio</span>}</div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>{p.desc}</p>
            <p className="tiny muted" style={{ margin: '4px 0 0' }}>{cards.filter((c) => c.plan_days === p.days).length} tarjetas activas</p>
          </div>
        ))}
      </div>

      <div className="row mb" style={{ minWidth: 240 }}><Search size={16} className="muted" /><input className="input grow" placeholder="Buscar por nombre, teléfono o código" value={term} onChange={(e) => setTerm(e.target.value)} /></div>

      {!list.length ? <Empty>{cards.length ? 'Ninguna tarjeta coincide.' : 'No hay clientes temporales. Pulsa "Nueva tarjeta".'}</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Cliente</th><th>Plan</th><th>Progreso</th><th>Último día</th><th>Código</th><th /></tr></thead>
          <tbody>{list.map((c) => {
            const last = (c.visits || []).filter((v) => v.kind === 'dia').map((v) => v.created_at).sort().pop()
            return (
              <tr key={c.id}>
                <td><b>{c.full_name}</b><div className="tiny muted">{c.phone || 'Sin teléfono'}{c.price != null && ` · ${money(c.price)}`}</div></td>
                <td><span className="badge">{c.plan_days} días</span></td>
                <td style={{ minWidth: 150 }}>
                  {c.gift_days > 0 ? <span className="badge y"><Gift size={12} /> Día gratis disponible</span> : (
                    <><div className="lc-bar"><span style={{ width: `${(c.days_done / c.plan_days) * 100}%` }} /></div>
                      <div className="tiny muted">{c.days_done} de {c.plan_days}</div></>
                  )}
                </td>
                <td className="small muted">{last ? fmtDateTime(last) : '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{c.code}</td>
                <td><CardActions c={c} {...actions(c)} onView={() => setView(c)} /></td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}

      {form && <NewCard f={form} setF={setForm} me={me} onClose={() => setForm(null)} onSaved={(c) => { setForm(null); load(); setView(c) }} />}
      {view && <Modal title={`Tarjeta · ${view.full_name}`} onClose={() => setView(null)}>
        <div className="col">
          <LoyaltyCard card={cards.find((c) => c.id === view.id) || view} />
          <p className="tiny muted center" style={{ margin: 0 }}>Toca la tarjeta para ver el dorso con el QR. Envíale el link al cliente para que la tenga en su celular.</p>
          <CardActions c={cards.find((c) => c.id === view.id) || view} {...actions(view)} big />
        </div>
      </Modal>}
      {scan && <Modal title="Escanear tarjeta" onClose={() => setScan(false)}>
        <QRScanner onScan={onScan} />
        <ManualCode onSubmit={onScan} />
      </Modal>}
    </>
  )
}

function CardActions({ c, day, gift, remove, copy, onView, busy, big }) {
  const b = (k) => busy === c.id + k
  return (
    <div className="row wrap" style={{ gap: 6, justifyContent: big ? 'center' : 'flex-end' }}>
      {c.gift_days > 0
        ? <button className="btn sm primary" onClick={gift} disabled={!!busy}>{b('g') ? <Spinner size={14} /> : <Gift size={14} />} Usar día gratis</button>
        : <button className="btn sm primary" onClick={day} disabled={!!busy}>{b('d') ? <Spinner size={14} /> : <CalendarPlus size={14} />} Confirmar día</button>}
      {onView && <button className="icon-btn" title="Ver tarjeta" onClick={onView}><Eye size={16} /></button>}
      <button className="icon-btn" title="Copiar link" onClick={copy}><Copy size={16} /></button>
      {c.phone && <a className="icon-btn" title="Enviar por WhatsApp" href={whatsappLink(c)} target="_blank" rel="noreferrer"><MessageCircle size={16} /></a>}
      <button className="icon-btn" title="Eliminar tarjeta" onClick={remove} disabled={!!busy}><Trash2 size={16} /></button>
    </div>
  )
}

function NewCard({ f, setF, me, onClose, onSaved }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { const c = await createCard(f, me.id); toast(`Tarjeta creada para ${c.full_name}`, 'success'); onSaved({ ...c, visits: [] }) }
    catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  return (
    <Modal title="Nueva tarjeta · cliente temporal" onClose={onClose}
      footer={<button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner size={16} /> : <Ticket size={16} />} Crear tarjeta</button>}>
      <div className="col">
        <div className="grid g2">
          <Input label="Nombre completo" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} placeholder="Juan Pérez" />
          <Input label="Celular (para enviar el link)" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="3001234567" />
        </div>
        <Field label="Plan pagado">
          <div className="grid g2">
            {LOYALTY_PLANS.map((p) => (
              <button key={p.days} type="button" className={`card card-click ${f.plan_days === p.days ? 'hl' : ''}`} style={{ textAlign: 'left', borderColor: f.plan_days === p.days ? 'var(--y)' : undefined }} onClick={() => setF({ ...f, plan_days: p.days })}>
                <b>{p.label}</b> {p.gift ? <span className="badge y"><Gift size={11} /> +1 gratis</span> : null}
                <div className="tiny muted mt">{p.desc}</div>
              </button>
            ))}
          </div>
        </Field>
        <Input label="Valor pagado en COP (opcional)" type="number" min="0" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
      </div>
    </Modal>
  )
}

function ManualCode({ onSubmit }) {
  const [v, setV] = useState('')
  return (
    <form className="row mt" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSubmit(v) }}>
      <input className="input grow" placeholder="O escribe el código (ej. 4F2A9C1B)" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn primary">Buscar</button>
    </form>
  )
}
