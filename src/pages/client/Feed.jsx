import { useCallback, useEffect, useRef, useState } from 'react'
import { PlusSquare, Trophy, Swords } from 'lucide-react'
import { getFeed, activeMembers, trainedToday, PAGE } from '../../lib/social'
import { Avatar, Empty, Loading, Spinner, useToast } from '../../components/ui'
import { PostCard, NewPost } from '../../components/Post'

/** Página de inicio tipo Instagram: miembros arriba y feed de fotos. */
export default function Feed({ me, onOpenProfile, onGo, bell }) {
  const toast = useToast()
  const [scope, setScope] = useState('all')
  const [posts, setPosts] = useState(null)
  const [more, setMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [members, setMembers] = useState([])
  const [today, setToday] = useState(new Set())
  const [composer, setComposer] = useState(false)
  const sentinel = useRef(null)

  useEffect(() => {
    activeMembers().then(setMembers).catch(() => {})
    trainedToday().then(setToday).catch(() => {})
  }, [])

  const load = useCallback(async (reset) => {
    if (loading) return
    setLoading(true)
    try {
      const before = reset ? null : posts?.[posts.length - 1]?.created_at
      const page = await getFeed({ me, scope, before })
      setPosts((p) => (reset ? page : [...(p || []), ...page]))
      setMore(page.length >= PAGE - 1)
    } catch (e) { toast(e.message, 'error'); setPosts((p) => p || []) } finally { setLoading(false) }
  }, [posts, scope, me.id, loading])

  useEffect(() => { setPosts(null); setMore(true) }, [scope])
  useEffect(() => { if (posts === null) load(true) }, [posts])

  // Scroll infinito
  useEffect(() => {
    if (!sentinel.current || !more) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && posts?.length && load(false), { rootMargin: '600px' })
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [load, more, posts])

  const update = (np) => setPosts((p) => p.map((x) => (x.id === np.id ? np : x)))
  const others = members.filter((m) => m.id !== me.id).sort((a, b) => today.has(b.id) - today.has(a.id))

  return (
    <div className="ig-wrap">
      <div className="ig-top">
        <h1 className="page-title">COMUNI<span>DAD</span></h1>
        <div className="row">
          <button className="icon-btn" onClick={() => onGo('ranking')} aria-label="Ranking"><Trophy size={22} /></button>
          <button className="icon-btn" onClick={() => onGo('challenges')} aria-label="Retos"><Swords size={22} /></button>
          {bell}
          <button className="icon-btn" onClick={() => setComposer(true)} aria-label="Publicar"><PlusSquare size={24} /></button>
        </div>
      </div>

      <div className="ig-stories">
        <button className="ig-story" onClick={() => setComposer(true)}>
          <div className="ring own"><Avatar src={me.photo} name={me.full_name} /><span className="plus">+</span></div>
          <span>Tu foto</span>
        </button>
        {others.map((m) => (
          <button key={m.id} className="ig-story" onClick={() => onOpenProfile(m.id)}>
            <div className={`ring ${today.has(m.id) ? 'on' : ''}`}><Avatar src={m.photo} name={m.full_name} /></div>
            <span>{m.full_name.split(' ')[0]}</span>
          </button>
        ))}
      </div>

      <div className="ig-scope">
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Para ti</button>
        <button className={scope === 'following' ? 'on' : ''} onClick={() => setScope('following')}>Siguiendo</button>
      </div>

      {posts === null ? <Loading /> : !posts.length
        ? <Empty>{scope === 'following' ? 'Sigue a otros miembros para ver sus fotos aquí.' : 'Aún no hay publicaciones. ¡Sé el primero en subir una foto!'}</Empty>
        : posts.map((p) => <PostCard key={p.id} post={p} me={me} onOpenProfile={onOpenProfile} onChange={update} onDeleted={(d) => setPosts((x) => x.filter((y) => y.id !== d.id))} />)}
      <div ref={sentinel} className="center" style={{ padding: 20 }}>{loading && posts?.length ? <Spinner /> : null}</div>

      {composer && <NewPost me={me} onClose={() => setComposer(false)} onPosted={(p) => setPosts((x) => [{ ...p, liked: false }, ...(x || [])])} />}
    </div>
  )
}
