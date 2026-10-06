import { useRef, useState } from 'react'
import { Heart, Trash2, ImagePlus, Camera } from 'lucide-react'
import { GOALS } from '../lib/constants'
import { driveImg, toggleLike, deletePost, createPost, timeAgo } from '../lib/social'
import { Avatar, Modal, Spinner, useToast } from './ui'

/** Publicación estilo Instagram: cabecera, foto cuadrada (doble toque = me gusta), acciones y pie. */
export function PostCard({ post, me, onOpenProfile, onChange, onDeleted }) {
  const toast = useToast()
  const [burst, setBurst] = useState(false)
  const lastTap = useRef(0)
  const goal = GOALS.find((g) => g.id === post.member?.goal)

  const like = async (force) => {
    if (force && post.liked) return
    const next = { ...post, liked: !post.liked, likes_count: post.likes_count + (post.liked ? -1 : 1) }
    onChange?.(next)
    try { await toggleLike(post, me.id) } catch (e) { onChange?.(post); toast(e.message, 'error') }
  }
  const tap = () => {
    const t = Date.now()
    if (t - lastTap.current < 320) { setBurst(true); setTimeout(() => setBurst(false), 700); like(true) }
    lastTap.current = t
  }
  const remove = async () => {
    if (!window.confirm('¿Borrar esta publicación?')) return
    try { await deletePost(post); onDeleted?.(post); toast('Publicación borrada', 'success') } catch (e) { toast(e.message, 'error') }
  }

  return (
    <article className="ig-post">
      <header className="ig-post-h">
        <button className="row ig-link" onClick={() => onOpenProfile?.(post.member_id)}>
          <Avatar src={post.member?.photo} name={post.member?.full_name} />
          <div style={{ textAlign: 'left' }}>
            <div className="ig-name">{post.member?.full_name}</div>
            {goal && <div className="tiny muted">{goal.emoji} {goal.label}</div>}
          </div>
        </button>
        {post.member_id === me.id && <button className="icon-btn" onClick={remove} aria-label="Borrar"><Trash2 size={18} /></button>}
      </header>
      <div className="ig-img" onClick={tap}>
        <img src={driveImg(post.drive_id)} alt={post.caption || 'Publicación'} loading="lazy" referrerPolicy="no-referrer" />
        {burst && <Heart className="ig-burst" size={96} fill="#fff" />}
      </div>
      <div className="ig-actions">
        <button className={`icon-btn ${post.liked ? 'liked' : ''}`} onClick={() => like()} aria-label="Me gusta">
          <Heart size={26} fill={post.liked ? '#ef4444' : 'none'} />
        </button>
      </div>
      <div className="ig-body">
        <div className="ig-likes">{post.likes_count} me gusta</div>
        {post.caption && <div><b>{post.member?.full_name?.split(' ')[0]}</b> {post.caption}</div>}
        <div className="tiny muted mt-s">{timeAgo(post.created_at)}</div>
      </div>
    </article>
  )
}

/** Ventana para publicar una foto (cámara o galería). */
export function NewPost({ me, onClose, onPosted }) {
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const gallery = useRef(null), camera = useRef(null)

  const pick = (f) => {
    if (!f) return
    if (!f.type.startsWith('image/')) return toast('Solo se pueden publicar imágenes', 'error')
    setFile(f); setPreview(URL.createObjectURL(f))
  }
  const publish = async () => {
    setBusy(true)
    try { onPosted(await createPost(me, file, caption)); toast('📸 Publicado', 'success'); onClose() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal title="Nueva publicación" onClose={onClose}
      footer={<button className="btn primary" disabled={!file || busy} onClick={publish}>{busy ? <Spinner size={16} /> : null} Publicar</button>}>
      {preview
        ? <div className="ig-img mb"><img src={preview} alt="Vista previa" /></div>
        : <div className="grid g2 mb">
          <button className="btn lg" onClick={() => camera.current?.click()}><Camera /> Tomar foto</button>
          <button className="btn lg" onClick={() => gallery.current?.click()}><ImagePlus /> Galería</button>
        </div>}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files[0])} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files[0])} />
      {preview && <button className="btn sm ghost mb" onClick={() => { setFile(null); setPreview(null) }}>Cambiar foto</button>}
      <textarea className="input" rows={3} maxLength={500} placeholder="Escribe un pie de foto..." value={caption} onChange={(e) => setCaption(e.target.value)} />
      <p className="tiny muted">La foto se recorta en cuadrado y se guarda en el Google Drive del gimnasio.</p>
    </Modal>
  )
}
