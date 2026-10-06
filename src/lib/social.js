// Comunidad tipo Instagram: publicaciones (solo imágenes, en Google Drive),
// "me gusta" y seguir.
import { supabase, q, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

export const PAGE = 10

/** URL directa de una imagen pública de Drive. */
export const driveImg = (id, w = 1080) => (id ? `https://lh3.googleusercontent.com/d/${id}=w${w}` : null)

const MEMBER = 'member:members!posts_member_id_fkey(id, full_name, photo, goal, active)'

/** Feed: todos o solo a quien sigo. `before` = fecha de la última publicación cargada. */
export async function getFeed({ me, scope = 'all', before }) {
  let query = supabase.from('posts').select(`*, ${MEMBER}`).order('created_at', { ascending: false }).limit(PAGE)
  if (before) query = query.lt('created_at', before)
  if (scope === 'following') {
    const ids = (await getFollowing(me.id))
    query = query.in('member_id', [me.id, ...ids])
  }
  const posts = await q(query)
  return withLikes(posts, me.id)
}

export async function getMemberPosts(memberId, viewerId) {
  return withLikes(await q(supabase.from('posts').select(`*, ${MEMBER}`).eq('member_id', memberId).order('created_at', { ascending: false }).limit(120)), viewerId)
}

async function withLikes(posts, viewerId) {
  if (!posts.length) return posts
  const mine = await q(supabase.from('post_likes').select('post_id').eq('member_id', viewerId).in('post_id', posts.map((p) => p.id)))
  const liked = new Set(mine.map((l) => l.post_id))
  // Clientes inactivos (membresía de baja) no aparecen
  return posts.filter((p) => p.member?.active).map((p) => ({ ...p, liked: liked.has(p.id) }))
}

export async function toggleLike(post, meId) {
  if (post.liked) await q(supabase.from('post_likes').delete().eq('post_id', post.id).eq('member_id', meId))
  else await q(supabase.from('post_likes').upsert({ post_id: post.id, member_id: meId }, { ignoreDuplicates: true }))
}

// ---------- Seguir ----------
export async function getFollowing(meId) {
  return (await q(supabase.from('follows').select('following_id').eq('follower_id', meId))).map((r) => r.following_id)
}
export async function followCounts(memberId) {
  const [a, b] = await Promise.all([
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', memberId),
    supabase.from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', memberId)
  ])
  return { followers: a.count || 0, following: b.count || 0 }
}
export async function setFollow(meId, otherId, on) {
  if (on) await q(supabase.from('follows').upsert({ follower_id: meId, following_id: otherId }, { ignoreDuplicates: true }))
  else await q(supabase.from('follows').delete().eq('follower_id', meId).eq('following_id', otherId))
}

/** Miembros activos para la fila de círculos y para elegir rival. */
export async function activeMembers() {
  return q(supabase.from('members').select('id, full_name, photo, goal, level, bio').eq('active', true).order('full_name'))
}

/** IDs de quienes entrenaron hoy (borde amarillo en los círculos). */
export async function trainedToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  const [s, a] = await Promise.all([
    q(supabase.from('workout_sessions').select('member_id').gte('started_at', d.toISOString())),
    q(supabase.from('activities').select('member_id').gte('started_at', d.toISOString()))
  ])
  return new Set([...s, ...a].map((x) => x.member_id))
}

// ---------- Imágenes ----------
/** Recorta al centro en cuadrado y comprime a JPEG. Devuelve base64 (sin prefijo). */
export async function squareJpeg(file, size, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const side = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = c.height = Math.min(size, side)
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, c.width, c.height)
  bmp.close?.()
  return c.toDataURL('image/jpeg', quality).split(',')[1]
}

async function driveCall(body) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/drive-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body)
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || (r.status === 404 ? 'Falta desplegar la función drive-upload en Supabase' : `Error ${r.status} al subir la imagen`))
  return d
}

export async function createPost(me, file, caption) {
  if (!file.type.startsWith('image/')) throw new Error('Solo se pueden publicar imágenes')
  const [image, thumb] = await Promise.all([squareJpeg(file, 1080), squareJpeg(file, 320, 0.75)])
  const { drive_id, thumb_id } = await driveCall({ action: 'upload', member_id: me.id, image, thumb })
  return (await q(supabase.from('posts').insert({ member_id: me.id, drive_id, thumb_id, caption: caption?.trim() || null }).select(`*, ${MEMBER}`)))[0]
}

/** Borra la publicación y sus archivos en Drive. */
export async function deletePost(post) {
  await driveCall({ action: 'delete', member_id: post.member_id, ids: [post.drive_id, post.thumb_id] }).catch((e) => console.warn('[drive]', e))
  await q(supabase.from('posts').delete().eq('id', post.id))
}

export function timeAgo(d) {
  const s = Math.max(1, Math.round((Date.now() - new Date(d)) / 1000))
  if (s < 60) return 'ahora'
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`
  if (s < 604800) return `hace ${Math.floor(s / 86400)} d`
  return new Date(d).toLocaleDateString('es', { day: 'numeric', month: 'short' })
}
