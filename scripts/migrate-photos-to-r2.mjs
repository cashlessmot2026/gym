// Migra las fotos de la comunidad de Google Drive a Cloudflare R2.
// Uso: node scripts/migrate-photos-to-r2.mjs        (usa las credenciales públicas de la app)
// - Descarga cada foto de Drive (son públicas), la sube con la función r2-upload y actualiza la publicación.
// - No borra nada en Drive. Es seguro repetirlo: solo procesa las publicaciones que aún apuntan a Drive.
import fs from 'node:fs'
const src = fs.readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8')
const URL_ = /'(https:\/\/[a-z0-9]+\.supabase\.co)'/.exec(src)[1]
const KEY = /eyJ[A-Za-z0-9._-]+/.exec(src)[0]
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const posts = await (await fetch(`${URL_}/rest/v1/posts?select=id,member_id,drive_id,thumb_id`, { headers: H })).json()
const pending = posts.filter((p) => p.drive_id && !p.drive_id.startsWith('r2:'))
console.log(`${posts.length} publicaciones, ${pending.length} por migrar`)

const grab = async (id, w) => {
  const r = await fetch(`https://lh3.googleusercontent.com/d/${id}=w${w}`)
  if (!r.ok) throw new Error(`Drive ${id}: ${r.status}`)
  return Buffer.from(await r.arrayBuffer()).toString('base64')
}
let ok = 0
for (const p of pending) {
  try {
    const image = await grab(p.drive_id, 1080)
    const thumb = await grab(p.thumb_id || p.drive_id, 320)
    const up = await (await fetch(`${URL_}/functions/v1/r2-upload`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'upload', member_id: p.member_id, image, thumb }) })).json()
    if (!up.drive_id) throw new Error(up.error || 'sin respuesta')
    const r = await fetch(`${URL_}/rest/v1/posts?id=eq.${p.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ drive_id: up.drive_id, thumb_id: up.thumb_id }) })
    if (!r.ok) throw new Error('No se pudo actualizar la publicación: ' + r.status)
    ok++; console.log('✔', p.id, '→', up.drive_id)
  } catch (e) { console.log('✘', p.id, e.message) }
}
console.log(`Migradas ${ok}/${pending.length}`)
