// Tienda virtual: categorías, productos (imágenes en Cloudflare R2) y links de pago.
import { supabase, q } from './supabase'
import { driveCall, driveImg } from './social'

export const productImg = (p, w = 600) => driveImg(p?.image_id, w)

const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim())
export const cleanUrl = (s) => { const v = String(s || '').trim(); return v ? (isUrl(v) ? v : (isUrl('https://' + v) ? 'https://' + v : null)) : '' }

/** Catálogo visible para el cliente. */
export async function getCatalog() {
  const [categories, products, settings] = await Promise.all([
    q(supabase.from('store_categories').select('*').eq('active', true).order('sort').order('name')),
    q(supabase.from('store_products').select('*').eq('active', true).order('sort').order('created_at', { ascending: false })),
    q(supabase.from('store_settings').select('*'))
  ])
  return { categories, products, defaultPayUrl: settings.find((s) => s.key === 'default_pay_url')?.value || '' }
}

/** Catálogo completo para el administrador (incluye ocultos). */
export async function getAdminCatalog() {
  const [categories, products, settings] = await Promise.all([
    q(supabase.from('store_categories').select('*').order('sort').order('name')),
    q(supabase.from('store_products').select('*').order('sort').order('created_at', { ascending: false })),
    q(supabase.from('store_settings').select('*'))
  ])
  return { categories, products, defaultPayUrl: settings.find((s) => s.key === 'default_pay_url')?.value || '' }
}

export const saveCategory = (c) => c.id
  ? q(supabase.from('store_categories').update({ name: c.name.trim(), emoji: c.emoji || '🛒', sort: Number(c.sort) || 0, active: c.active !== false }).eq('id', c.id))
  : q(supabase.from('store_categories').insert({ name: c.name.trim(), emoji: c.emoji || '🛒', sort: Number(c.sort) || 0 }))
export const deleteCategory = (id) => q(supabase.from('store_categories').delete().eq('id', id))

export async function saveProduct(p) {
  const pay = cleanUrl(p.pay_url)
  if (pay === null) throw new Error('El link de pago no es una dirección válida (debe empezar por https://)')
  const row = {
    category_id: p.category_id || null, name: p.name.trim(), description: p.description?.trim() || null,
    price: Number(p.price) || 0, list_price: p.list_price === '' || p.list_price == null ? null : Number(p.list_price),
    image_id: p.image_id || null, pay_url: pay || null, active: p.active !== false, sort: Number(p.sort) || 0
  }
  if (!row.name) throw new Error('El producto necesita un nombre')
  return p.id ? q(supabase.from('store_products').update(row).eq('id', p.id)) : q(supabase.from('store_products').insert(row))
}

export async function deleteProduct(p, staffId) {
  if (p.image_id) await driveCall({ action: 'product_delete', staff_id: staffId, ids: [p.image_id] }, 'r2-upload').catch((e) => console.warn('[r2]', e))
  return q(supabase.from('store_products').delete().eq('id', p.id))
}

export const saveDefaultPayUrl = async (url) => {
  const v = cleanUrl(url)
  if (v === null) throw new Error('El link de pago no es una dirección válida (debe empezar por https://)')
  return q(supabase.from('store_settings').upsert({ key: 'default_pay_url', value: v }))
}

/** Reduce la imagen (sin recortar) a un JPEG de máx. `size` px y la sube a R2. Devuelve "r2:tienda/…". */
export async function uploadProductImage(file, staffId, size = 1000) {
  if (!file.type.startsWith('image/')) throw new Error('Solo se pueden subir imágenes')
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const k = Math.min(1, size / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
  g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.()
  const image = c.toDataURL('image/jpeg', 0.82).split(',')[1]
  const { image_id } = await driveCall({ action: 'product_upload', staff_id: staffId, image }, 'r2-upload')
  return image_id
}
