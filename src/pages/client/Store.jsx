import { useEffect, useMemo, useState } from 'react'
import { Search, ShoppingBag, CreditCard, Package } from 'lucide-react'
import { getCatalog, productImg } from '../../lib/store'
import { money } from '../../lib/constants'
import { Loading, Empty, Modal, useToast } from '../../components/ui'

/** Tienda virtual del gimnasio: productos por categoría con botón de pago (link que define el admin). */
export default function Store() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [cat, setCat] = useState('all')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(null)

  useEffect(() => { getCatalog().then(setData).catch((e) => { toast(e.message, 'error'); setData({ categories: [], products: [], defaultPayUrl: '' }) }) }, [])

  const list = useMemo(() => {
    if (!data) return []
    const t = term.trim().toLowerCase()
    return data.products.filter((p) => (cat === 'all' || p.category_id === cat) && (!t || `${p.name} ${p.description || ''}`.toLowerCase().includes(t)))
  }, [data, cat, term])

  if (!data) return <Loading text="Cargando tienda…" />
  const payUrl = (p) => p.pay_url || data.defaultPayUrl
  const pay = (p) => { const u = payUrl(p); if (u) window.open(u, '_blank', 'noopener'); else toast('Este producto aún no tiene link de pago. Pídelo en recepción.', 'info') }
  const count = (id) => data.products.filter((p) => p.category_id === id).length

  return (
    <div className="col">
      <div className="row wrap" style={{ gap: 6 }}>
        <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>🛒 Todo ({data.products.length})</button>
        {data.categories.filter((c) => count(c.id) > 0).map((c) => <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{c.emoji} {c.name} ({count(c.id)})</button>)}
      </div>
      <div className="row"><Search size={16} className="muted" /><input className="input" placeholder="Buscar producto…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>

      {!list.length ? <Empty>{data.products.length ? 'No hay productos que coincidan.' : 'La tienda aún no tiene productos. ¡Vuelve pronto!'}</Empty> : (
        <div className="shop-grid">
          {list.map((p) => (
            <div key={p.id} className="shop-card" onClick={() => setOpen(p)}>
              <div className="shop-img">{p.image_id ? <img src={productImg(p, 600)} alt={p.name} loading="lazy" /> : <Package size={36} className="muted" />}</div>
              <div className="shop-body">
                <div className="shop-name">{p.name}</div>
                {p.description && <div className="tiny muted shop-desc">{p.description}</div>}
                <div className="shop-price"><b>{money(p.price)}</b>{p.list_price > p.price && <s className="tiny muted"> {money(p.list_price)}</s>}</div>
                <button className="btn primary sm block" onClick={(e) => { e.stopPropagation(); pay(p) }}><CreditCard size={14} /> Pagar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)} footer={<button className="btn primary" onClick={() => pay(open)}><CreditCard size={16} /> Pagar {money(open.price)}</button>}>
          {open.image_id && <img className="shop-big" src={productImg(open, 1000)} alt={open.name} />}
          <div className="shop-price mt"><b style={{ fontSize: '1.4rem' }}>{money(open.price)}</b>{open.list_price > open.price && <s className="muted"> {money(open.list_price)}</s>}</div>
          {open.description && <p className="small" style={{ whiteSpace: 'pre-line' }}>{open.description}</p>}
          {!payUrl(open) && <p className="tiny muted"><ShoppingBag size={12} /> Este producto aún no tiene link de pago.</p>}
        </Modal>
      )}
    </div>
  )
}
