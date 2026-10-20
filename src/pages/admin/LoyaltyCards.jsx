import { useEffect, useState } from 'react'
import { Plus, ScanLine, Trash2, Eye, Copy, MessageCircle, Gift, Search, Ticket } from 'lucide-react'
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
  const [result, setResult] = useState(null)   // último escaneo

  const load = async () => { try { setCards(await listCards()) } catch (e) { toast(e.message, 'error'); setCards([]) } }
  useEffect(() => { load() }, [])

  const run = async (key, fn) => {
    setBusy(key)
    try { await fn(); await load() } catch (e) { toast(e.message, 'error') } finally { setBusy('') }
  }
  const remove = (c) => {
    if (!window.confirm(`¿Eliminar la tarjeta de ${c.full_name}? No se puede deshacer.`)) return
    run(c.id + 'x', async () => { await deleteCard(c.id); toast('Tarjeta eliminada', 'success'); setView(null) })
  }
  const copy = async (c) => {
    try { await navigator.clipboard.writeText(cardLink(c.token)); toast('Link de la tarjeta copiado', 'success') } catch { window.prompt('Copia el link:', cardLink(c.token)) }
  }
  // El día solo se suma al escanear el QR de la tarjeta (las visitas no tienen que ser seguidas).
  const onScan = async (text) => {
    if (busy) return
    const code = parseCardCode(text)
    setBusy('scan')
    try {
      const fresh = await listCards()
      setCards(fresh)
      const c = fresh.find((x) => x.code === code || x.token === code)
      if (!c) throw new Error('Esa tarjeta no existe o ya terminó')
      if (c.gift_days > 0) {
        if (!window.confirm(`${c.full_name} tiene 1 día gratis. ¿Usarlo hoy? Después la tarjeta se elimina.`)) return
        await redeemGift(c.code, me.id)
        setResult({ card: { ...c, gift_days: 0 }, msg: `Día gratis usado. La tarjeta de ${c.full_name} se cerró.`, closed: true })
      } else {
        const r = await confirmDay(c.code, me.id)
        const card = { ...c, days_done: r.day, gift_days: r.gift, visits: [...(c.visits || []), { kind: 'dia', created_at: new Date().toISOString() }] }
        setResult({
          card, stamped: true, closed: r.closed,
          msg: r.closed ? `${r.name} completó sus ${r.plan_days} días. La tarjeta se cerró.`
            : r.gift ? `¡${r.name} completó los ${r.plan_days} días! Ganó 1 día gratis 🎁`
              : `+1 estrella · día ${r.day} de ${r.plan_days} para ${r.name}`
        })
      }
      toast('Tarjeta actualizada', 'success')
      load()
    } catch (e) { toast(e.message, 'error') } finally { setBusy('') }
  }

  if (!cards) return <Loading />
  const list = cards.filter((c) => !term || [c.full_name, c.phone, c.code].some((v) => v?.toLowerCase().includes(term.toLowerCase())))
  const actions = (c) => ({ remove: () => remove(c), copy: () => copy(c), busy })

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
          <thead><tr><th>Cliente</th><th>Plan</th><th>Progreso</th><th>Última visita</th><th>Código</th><th /></tr></thead>
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
          <p className="tiny muted center" style={{ margin: 0 }}>Los días se suman solo escaneando el QR de la tarjeta en "Escanear tarjeta". Envíale el link al cliente para que la tenga en su celular.</p>
          <CardActions c={cards.find((c) => c.id === view.id) || view} {...actions(view)} big />
        </div>
      </Modal>}
      {scan && <Modal title="Escanear tarjeta" onClose={() => { setScan(false); setResult(null) }}>
        {result ? (
          <div className="col">
            <LoyaltyCard card={result.card} justStamped={result.stamped} />
            <div className={`badge ${result.closed ? 'warn' : 'ok'}`} style={{ justifyContent: 'center', padding: 10, fontSize: '.9rem' }}>{result.msg}</div>
            <button className="btn primary" onClick={() => setResult(null)}><ScanLine size={16} /> Escanear otra tarjeta</button>
          </div>
        ) : (
          <>
            <QRScanner onScan={onScan} active={!busy} />
            {busy === 'scan' && <p className="center"><Spinner /> Validando…</p>}
            <p className="tiny muted center">Apunta la cámara al QR de la tarjeta del cliente (en su celular, al girar la tarjeta). Cada escaneo suma 1 estrella; máximo uno cada 12 horas.</p>
          </>
        )}
      </Modal>}
    </>
  )
}

function CardActions({ c, remove, copy, onView, busy, big }) {
  return (
    <div className="row wrap" style={{ gap: 6, justifyContent: big ? 'center' : 'flex-end' }}>
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
