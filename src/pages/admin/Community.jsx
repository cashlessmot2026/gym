import { useEffect, useState } from 'react'
import { Trash2, Heart } from 'lucide-react'
import { supabase, q } from '../../lib/supabase'
import { driveImg, deletePost, timeAgo } from '../../lib/social'
import { PageTitle, Loading, Empty, Avatar, useToast } from '../../components/ui'

/** Moderación de la comunidad: el admin ve y borra cualquier publicación. */
export default function Community() {
  const toast = useToast()
  const [posts, setPosts] = useState(null)
  useEffect(() => {
    q(supabase.from('posts').select('*, member:members!posts_member_id_fkey(id, full_name, photo)').order('created_at', { ascending: false }).limit(120))
      .then(setPosts).catch((e) => { toast(e.message, 'error'); setPosts([]) })
  }, [])
  const remove = async (p) => {
    if (!window.confirm(`¿Borrar la publicación de ${p.member?.full_name}? También se borra de Google Drive.`)) return
    try { await deletePost(p); setPosts((x) => x.filter((y) => y.id !== p.id)); toast('Publicación borrada', 'success') } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      <PageTitle a="COMUNI" b="DAD" />
      {!posts ? <Loading /> : !posts.length ? <Empty>Aún no hay publicaciones.</Empty> : (
        <div className="grid g4">{posts.map((p) => (
          <div key={p.id} className="card" style={{ padding: 10 }}>
            <div className="row mb" style={{ gap: 8 }}><Avatar src={p.member?.photo} name={p.member?.full_name} /><div className="grow"><div className="small" style={{ fontWeight: 700 }}>{p.member?.full_name}</div><div className="tiny muted">{timeAgo(p.created_at)}</div></div></div>
            <div className="ig-img"><img src={driveImg(p.thumb_id || p.drive_id, 480)} alt="" loading="lazy" referrerPolicy="no-referrer" /></div>
            {p.caption && <div className="small mt-s">{p.caption}</div>}
            <div className="row between mt-s"><span className="small"><Heart size={14} /> {p.likes_count}</span>
              <button className="btn sm danger" onClick={() => remove(p)}><Trash2 size={14} /> Borrar</button></div>
          </div>
        ))}</div>
      )}
    </>
  )
}
