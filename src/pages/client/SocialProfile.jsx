import { useEffect, useState } from 'react'
import { ArrowLeft, Grid3x3, Watch, Pencil, Swords, Trophy, PlusSquare, BarChart3 } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { GOALS } from '../../lib/constants'
import { getMemberPosts, followCounts, getFollowing, setFollow, driveImg } from '../../lib/social'
import { myRank } from '../../lib/ranking'
import { Avatar, Empty, Loading, Modal, useToast } from '../../components/ui'
import { PostCard, NewPost } from '../../components/Post'
import Activities from '../../components/Activities'
import HealthAnalytics from '../../components/HealthAnalytics'

/** Perfil estilo Instagram: cabecera con contadores, seguir, cuadrícula de fotos y actividades. */
export default function SocialProfile({ me, memberId, onBack, onOpenProfile, onChallenge, bell }) {
  const toast = useToast()
  const own = memberId === me.id
  const [m, setM] = useState(null)
  const [posts, setPosts] = useState(null)
  const [counts, setCounts] = useState({ followers: 0, following: 0 })
  const [following, setFollowing] = useState(false)
  const [rank, setRank] = useState(null)
  const [tab, setTab] = useState('photos')
  const [open, setOpen] = useState(null)
  const [edit, setEdit] = useState(null)
  const [composer, setComposer] = useState(false)
  const [hv, setHv] = useState(0) // se incrementa tras sincronizar para recargar la analítica

  const loadRank = (mm) => myRank(mm).then(setRank).catch(() => {})
  useEffect(() => {
    setM(null); setPosts(null); setTab('photos')
    q(supabase.from('members').select('id, full_name, photo, goal, level, bio, birthdate, sex, active, health_last_sync').eq('id', memberId))
      .then(([x]) => { setM(x); if (x) loadRank(x) }).catch((e) => toast(e.message, 'error'))
    getMemberPosts(memberId, me.id).then(setPosts).catch(() => setPosts([]))
    followCounts(memberId).then(setCounts)
    if (!own) getFollowing(me.id).then((ids) => setFollowing(ids.includes(memberId)))
  }, [memberId])

  const toggleFollow = async () => {
    const on = !following
    setFollowing(on); setCounts((c) => ({ ...c, followers: c.followers + (on ? 1 : -1) }))
    try { await setFollow(me.id, memberId, on) } catch (e) { setFollowing(!on); toast(e.message, 'error') }
  }
  const saveBio = async () => {
    try { await q(supabase.from('members').update({ bio: edit.trim() || null }).eq('id', me.id)); setM({ ...m, bio: edit.trim() }); setEdit(null) } catch (e) { toast(e.message, 'error') }
  }

  if (!m) return <Loading />
  const goal = GOALS.find((g) => g.id === m.goal)
  const updatePost = (np) => { setPosts((p) => p.map((x) => (x.id === np.id ? np : x))); setOpen(np) }

  return (
    <div className="ig-wrap">
      <div className="ig-top">
        {onBack ? <button className="icon-btn" onClick={onBack} aria-label="Volver"><ArrowLeft /></button> : <span />}
        <div className="ig-name" style={{ fontSize: '1.05rem' }}>{m.full_name}</div>
        <div className="row">{bell}{own && <button className="icon-btn" onClick={() => setComposer(true)} aria-label="Publicar"><PlusSquare size={24} /></button>}</div>
      </div>

      <div className="ig-head">
        <Avatar lg src={m.photo} name={m.full_name} />
        <div className="ig-counts">
          <div><b>{posts?.length ?? '—'}</b><span>publicaciones</span></div>
          <div><b>{counts.followers}</b><span>seguidores</span></div>
          <div><b>{counts.following}</b><span>seguidos</span></div>
        </div>
      </div>
      <div className="ig-bio">
        <div style={{ fontWeight: 800 }}>{m.full_name}</div>
        <div className="row wrap mt-s" style={{ gap: 6 }}>
          {goal && <span className="badge y">{goal.emoji} {goal.label}</span>}
          <span className="badge" style={{ textTransform: 'capitalize' }}>{m.level}</span>
          {rank && <span className="badge"><Trophy size={12} /> #{rank.pos} de {rank.of}</span>}
        </div>
        {m.bio && <p className="small" style={{ whiteSpace: 'pre-line', margin: '8px 0 0' }}>{m.bio}</p>}
      </div>
      <div className="row mt">
        {own
          ? <button className="btn block" onClick={() => setEdit(m.bio || '')}><Pencil size={15} /> Editar perfil</button>
          : <>
            <button className={`btn block ${following ? '' : 'primary'}`} onClick={toggleFollow}>{following ? 'Siguiendo' : 'Seguir'}</button>
            <button className="btn block" onClick={() => onChallenge(m)}><Swords size={15} /> Retar</button>
          </>}
      </div>

      <div className="ig-tabs">
        <button className={tab === 'photos' ? 'on' : ''} onClick={() => setTab('photos')} aria-label="Fotos"><Grid3x3 size={20} /></button>
        <button className={tab === 'acts' ? 'on' : ''} onClick={() => setTab('acts')} aria-label="Actividades"><Watch size={20} /></button>
        {own && <button className={tab === 'health' ? 'on' : ''} onClick={() => setTab('health')} aria-label="Analítica de salud"><BarChart3 size={20} /></button>}
      </div>

      {tab === 'photos' && (posts === null ? <Loading /> : !posts.length
        ? <Empty>{own ? 'Comparte tu primera foto con el gimnasio.' : 'Aún no ha publicado fotos.'}</Empty>
        : <div className="ig-grid">{posts.map((p) => (
          <button key={p.id} onClick={() => setOpen(p)} aria-label="Ver publicación">
            <img src={driveImg(p.thumb_id || p.drive_id, 320)} alt="" loading="lazy" referrerPolicy="no-referrer" />
          </button>
        ))}</div>)}
      {tab === 'acts' && <div className="mt"><Activities key={hv} member={m} /></div>}
      {tab === 'health' && own && <div className="mt"><HealthAnalytics key={hv} member={m} /></div>}

      {open && <Modal title="Publicación" onClose={() => setOpen(null)}>
        <PostCard post={open} me={me} onChange={updatePost} onOpenProfile={(id) => { setOpen(null); if (id !== memberId) onOpenProfile(id) }}
          onDeleted={(d) => { setPosts((x) => x.filter((y) => y.id !== d.id)); setOpen(null) }} />
      </Modal>}
      {edit !== null && <Modal title="Editar perfil" onClose={() => setEdit(null)} footer={<button className="btn primary" onClick={saveBio}>Guardar</button>}>
        <label className="small muted">Biografía</label>
        <textarea className="input" rows={4} maxLength={300} value={edit} onChange={(e) => setEdit(e.target.value)} placeholder="Cuéntale al gimnasio sobre ti, tus metas..." />
        <p className="tiny muted">La foto de perfil es la registrada en recepción.</p>
      </Modal>}
      {composer && <NewPost me={me} onClose={() => setComposer(false)} onPosted={(p) => setPosts((x) => [{ ...p, liked: false }, ...(x || [])])} />}
    </div>
  )
}
