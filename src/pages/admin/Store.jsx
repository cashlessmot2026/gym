import { useEffect, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Link2, ImagePlus, Eye, EyeOff, Package, Tags, Save } from 'lucide-react'
import { getAdminCatalog, saveProduct, deleteProduct, saveCategory, deleteCategory, saveDefaultPayUrl, uploadProductImage, productImg } from '../../lib/store'
import { money } from '../../lib/constants'
import { PageTitle, Loading, Empty, Modal, Input, Select, Field, Spinner, useToast } from '../../components/ui'

/** Administración de la tienda: categorías, productos (imagen en R2) y links de pago. */
export default function StoreAdmin({ me }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [edit, setEdit] = useState(null)       // producto en edición
  const [catEdit, setCatEdit] = useState(null) // categoría en edición
  const [pay, setPay] = useState('')
  const [cat, setCat] = useState('all')

  const load = async () => {
    try { const d = await getAdminCatalog(); setData(d); setPay(d.defaultPayUrl) } catch (e) { toast(e.message, 'error'); setData({ categories: [], products: [], defaultPayUrl: '' }) }
  }
  useEffect(() => { load() }, [])
  if (!data) return <Loading />

  const catName = (id) => data.categories.find((c) => c.id === id)
  const list = data.products.filter((p) => cat === 'all' || (cat === 'none' ? !p.category_id : p.category_id === cat))

  const savePay = async () => { try { await saveDefaultPayUrl(pay); toast('Link de pago general guardado', 'success'); load() } catch (e) { toast(e.message, 'error') } }
  const toggle = async (p) => { try { await saveProduct({ ...p, active: !p.active }); load() } catch (e) { toast(e.message, 'error') } }
  const remove = async (p) => {
    if (!window.confirm(`¿Eliminar "${p.name}"? También se borra su imagen.`)) return
    try { await deleteProduct(p, me.id); toast('Producto eliminado', 'success'); load() } catch (e) { toast(e.message, 'error') }
  }
  const removeCat = async (c) => {
    if (!window.confirm(`¿Eliminar la categoría "${c.name}"? Sus productos quedarán sin categoría.`)) return
    try { await deleteCategory(c.id); if (cat === c.id) setCat('all'); load() } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <PageTitle a="TIENDA" b="VIRTUAL">
        <button className="btn" onClick={() => setCatEdit({ name: '', emoji: '🛒', sort: data.categories.length + 1 })}><Tags size={16} /> Nueva categoría</button>
        <button className="btn primary" onClick={() => setEdit({ name: '', description: '', price: '', list_price: '', pay_url: '', category_id: data.categories[0]?.id || '', active: true, sort: 0 })}><Plus size={16} /> Nuevo producto</button>
      </PageTitle>

      <div className="card mb">
        <h3><Link2 size={16} className="y" /> Link de pago general</h3>
        <p className="tiny muted">Se usa en los productos que no tengan su propio link de pago (Wompi, Mercado Pago, PayU, PayPal, Nequi, etc.).</p>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" placeholder="https://…" value={pay} onChange={(e) => setPay(e.target.value)} />
          <button className="btn primary" onClick={savePay}><Save size={16} /> Guardar</button>
        </div>
      </div>

      <div className="row wrap mb" style={{ gap: 6 }}>
        <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>Todo ({data.products.length})</button>
        {data.categories.map((c) => (
          <span key={c.id} className="row" style={{ gap: 2 }}>
            <button className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{c.emoji} {c.name} ({data.products.filter((p) => p.category_id === c.id).length}){!c.active && ' · oculta'}</button>
            <button className="icon-btn" title="Editar categoría" onClick={() => setCatEdit(c)}><Pencil size={13} /></button>
            <button className="icon-btn" title="Eliminar categoría" onClick={() => removeCat(c)}><Trash2 size={13} /></button>
          </span>
        ))}
        {data.products.some((p) => !p.category_id) && <button className={`chip ${cat === 'none' ? 'on' : ''}`} onClick={() => setCat('none')}>Sin categoría</button>}
      </div>

      {!list.length ? <Empty>No hay productos aquí. Pulsa "Nuevo producto".</Empty> : (
        <div className="shop-grid">
          {list.map((p) => (
            <div key={p.id} className="shop-card" style={{ cursor: 'default', opacity: p.active ? 1 : 0.55 }}>
              <div className="shop-img">{p.image_id ? <img src={productImg(p, 480)} alt={p.name} loading="lazy" /> : <Package size={36} className="muted" />}</div>
              <div className="shop-body">
                <div className="shop-name">{p.name}</div>
                <div className="tiny muted">{catName(p.category_id)?.name || 'Sin categoría'}</div>
                <div className="shop-price"><b>{money(p.price)}</b>{p.list_price > p.price && <s className="tiny muted"> {money(p.list_price)}</s>}</div>
                <div className="tiny" style={{ color: p.pay_url ? 'var(--ok)' : 'var(--muted)' }}><Link2 size={11} /> {p.pay_url ? 'Link propio' : data.defaultPayUrl ? 'Link general' : 'Sin link de pago'}</div>
                <div className="row" style={{ gap: 4, marginTop: 6 }}>
                  <button className="btn sm grow" onClick={() => setEdit(p)}><Pencil size={13} /> Editar</button>
                  <button className="icon-btn" title={p.active ? 'Ocultar' : 'Mostrar'} onClick={() => toggle(p)}>{p.active ? <Eye size={16} /> : <EyeOff size={16} />}</button>
                  <button className="icon-btn" title="Eliminar" onClick={() => remove(p)}><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && <ProductForm p={edit} cats={data.categories} me={me} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      {catEdit && <CategoryForm c={catEdit} onClose={() => setCatEdit(null)} onSaved={() => { setCatEdit(null); load() }} />}
    </>
  )
}

function ProductForm({ p, cats, me, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState(p)
  const [busy, setBusy] = useState(false)
  const file = useRef(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const pick = async (e) => {
    const x = e.target.files?.[0]; e.target.value = ''
    if (!x) return
    setBusy(true)
    try { setF((s) => ({ ...s, image_id: '' })); const id = await uploadProductImage(x, me.id); setF((s) => ({ ...s, image_id: id })); toast('Imagen cargada a Cloudflare R2', 'success') }
    catch (err) { setF((s) => ({ ...s, image_id: p.image_id })); toast(err.message, 'error') } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true)
    try { await saveProduct(f); toast('Producto guardado', 'success'); onSaved() } catch (e) { toast(e.message, 'error'); setBusy(false) }
  }
  return (
    <Modal title={p.id ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} wide
      footer={<button className="btn primary" onClick={save} disabled={busy}>{busy ? <Spinner size={16} /> : <Save size={16} />} Guardar</button>}>
      <div className="grid g2">
        <div className="col">
          <Input label="Nombre" value={f.name} onChange={set('name')} placeholder="Proteína Whey 2 lb" />
          <Select label="Categoría" value={f.category_id || ''} onChange={set('category_id')} options={[{ value: '', label: '— Sin categoría —' }, ...cats.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` }))]} />
          <Field label="Descripción"><textarea className="input" rows={4} value={f.description || ''} onChange={set('description')} placeholder="Sabor, tamaño, beneficios…" /></Field>
        </div>
        <div className="col">
          <div className="grid g2">
            <Input label="Precio (COP)" type="number" min="0" value={f.price} onChange={set('price')} />
            <Input label="Valor anterior (opcional)" type="number" min="0" value={f.list_price ?? ''} onChange={set('list_price')} />
          </div>
          <Input label="Link de pago de este producto" value={f.pay_url || ''} onChange={set('pay_url')} placeholder="https://… (vacío = usa el link general)" />
          <Field label="Imagen">
            <div className="row" style={{ gap: 10 }}>
              <div className="shop-img" style={{ width: 96, height: 96, borderRadius: 12 }}>{busy && !f.image_id ? <Spinner /> : f.image_id ? <img src={productImg(f, 300)} alt="" /> : <Package className="muted" />}</div>
              <button type="button" className="btn" onClick={() => file.current?.click()} disabled={busy}><ImagePlus size={16} /> {f.image_id ? 'Cambiar' : 'Subir imagen'}</button>
              <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
            </div>
          </Field>
          <div className="grid g2">
            <Input label="Orden" type="number" value={f.sort ?? 0} onChange={set('sort')} />
            <Select label="Visibilidad" value={f.active === false ? '0' : '1'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })} options={[{ value: '1', label: 'Visible en la tienda' }, { value: '0', label: 'Oculto' }]} />
          </div>
        </div>
      </div>
    </Modal>
  )
}

function CategoryForm({ c, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState(c)
  const save = async () => {
    if (!f.name?.trim()) return toast('La categoría necesita un nombre', 'error')
    try { await saveCategory(f); onSaved() } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Modal title={c.id ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose} footer={<button className="btn primary" onClick={save}><Save size={16} /> Guardar</button>}>
      <div className="col">
        <div className="grid g2"><Input label="Emoji" value={f.emoji || ''} onChange={(e) => setF({ ...f, emoji: e.target.value })} /><Input label="Orden" type="number" value={f.sort ?? 0} onChange={(e) => setF({ ...f, sort: e.target.value })} /></div>
        <Input label="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Proteínas y suplementos" />
        <Select label="Visibilidad" value={f.active === false ? '0' : '1'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })} options={[{ value: '1', label: 'Visible' }, { value: '0', label: 'Oculta' }]} />
      </div>
    </Modal>
  )
}
