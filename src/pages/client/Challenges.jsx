import { useEffect, useMemo, useState } from 'react'
import { Swords, Plus, Check, X, Crown, Search } from 'lucide-react'
import { today, daysBetween, fmtDate } from '../../lib/constants'
import { METRICS, metricOf, listChallenges, createChallenge, answerChallenge, refreshChallenges } from '../../lib/challenges'
import { activeMembers } from '../../lib/social'
import { Avatar, Empty, Loading, Modal, Spinner, Tabs, useToast } from '../../components/ui'

/** Retos 1 vs 1 entre miembros del gimnasio. */
export default function Challenges({ me, preset, onClearPreset, onOpenProfile, bell }) {
  const toast = useToast()
  const [list, setList] = useState(null)
  const [tab, setTab] = useState('active')
  const [creating, setCreating] = useState(null)

  const load = async () => {
    try { await refreshChallenges(me.id) } catch { /* marcador del último cálculo */ }
    listChallenges(me.id).then(setList).catch((e) => { toast(e.message, 'error'); setList([]) })
  }
  useEffect(() => { load() }, [me.id])
  // Desde el perfil de otro miembro: "Retar"
  useEffect(() => { if (preset) { setCreating({ opponent: preset }); onClearPreset?.() } }, [preset])

  const groups = useMemo(() => ({
    active: (list || []).filter((c) => c.status === 'aceptado'),
    pending: (list || []).filter((c) => c.status === 'pendiente'),
    done: (list || []).filter((c) => c.status === 'terminado' || c.status === 'rechazado')
  }), [list])
  const wins = (list || []).filter((c) => c.winner_id === me.id).length

  const answer = async (c, ok) => {
    try { await answerChallenge(c, me, ok); toast(ok ? '🔥 ¡Reto aceptado!' : 'Reto rechazado', ok ? 'success' : 'info'); load() } catch (e) { toast(e.message, 'error') }
  }

  const items = groups[tab]
  return (
    <div className="ig-wrap">
      <div className="ig-top">
        <h1 className="page-title">RE<span>TOS</span></h1>
        <div className="row">{bell}<button className="btn primary sm" onClick={() => setCreating({})}><Plus size={16} /> Retar</button></div>
      </div>
      <div className="row wrap mb small muted"><Crown size={16} className="y" /> Has ganado <b className="y">{wins}</b> reto{wins === 1 ? '' : 's'}</div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'active', label: `Activos (${groups.active.length})` },
        { id: 'pending', label: `Pendientes (${groups.pending.length})` },
        { id: 'done', label: 'Terminados' }
      ]} />
      {!list ? <Loading /> : !items.length ? <Empty>{tab === 'active' ? 'No tienes retos activos. ¡Reta a alguien del gimnasio!' : 'Nada por aquí.'}</Empty> : (
        <div className="col mt">{items.map((c) => <ChallengeCard key={c.id} c={c} me={me} onAnswer={answer} onOpenProfile={onOpenProfile} />)}</div>
      )}
      {creating && <NewChallenge me={me} preset={creating.opponent} onClose={() => setCreating(null)} onCreated={() => { setCreating(null); setTab('pending'); load() }} />}
    </div>
  )
}

function ChallengeCard({ c, me, onAnswer, onOpenProfile }) {
  const m = metricOf(c.metric)
  const a = Number(c.challenger_value || 0), b = Number(c.opponent_value || 0)
  const total = a + b || 1
  const left = daysBetween(today(), c.end_date)
  const incoming = c.status === 'pendiente' && c.opponent_id === me.id
  const Side = ({ p, v, win }) => (
    <button className="ch-side ig-link" onClick={() => onOpenProfile(p.id)}>
      <div className={`ring ${win ? 'on' : ''}`}><Avatar src={p.photo} name={p.full_name} /></div>
      <div className="small" style={{ fontWeight: 700 }}>{p.id === me.id ? 'Tú' : p.full_name.split(' ')[0]}</div>
      <div className="ch-val">{v} <span className="tiny muted">{m.unit}</span></div>
    </button>
  )
  return (
    <div className={`card ${c.status === 'aceptado' ? 'hl' : ''}`}>
      <div className="row between mb"><b>{c.title || `${m.emoji} ${m.label}`}</b>
        <span className="badge">{c.status === 'aceptado' ? (left >= 0 ? `Quedan ${left + 1} d` : 'Cerrando') : c.status === 'pendiente' ? 'Pendiente' : c.status === 'rechazado' ? 'Rechazado' : 'Terminado'}</span>
      </div>
      <div className="ch-vs">
        <Side p={c.challenger} v={a} win={c.winner_id === c.challenger_id} />
        <Swords className="y" />
        <Side p={c.opponent} v={b} win={c.winner_id === c.opponent_id} />
      </div>
      {c.status !== 'pendiente' && c.status !== 'rechazado' && <div className="ch-bar"><div style={{ width: `${(a / total) * 100}%` }} /></div>}
      <div className="tiny muted mt-s">{fmtDate(c.start_date)} → {fmtDate(c.end_date)}
        {c.status === 'terminado' && (c.winner_id ? <> · 🏆 Ganó {c.winner_id === me.id ? 'tú' : (c.winner_id === c.challenger_id ? c.challenger : c.opponent).full_name.split(' ')[0]}</> : ' · Empate')}</div>
      {incoming && <div className="row mt">
        <button className="btn primary block" onClick={() => onAnswer(c, true)}><Check size={16} /> Aceptar</button>
        <button className="btn block" onClick={() => onAnswer(c, false)}><X size={16} /> Rechazar</button>
      </div>}
      {c.status === 'pendiente' && !incoming && <div className="tiny muted mt-s">Esperando a que {c.opponent.full_name.split(' ')[0]} acepte.</div>}
    </div>
  )
}

function NewChallenge({ me, preset, onClose, onCreated }) {
  const toast = useToast()
  const [members, setMembers] = useState(null)
  const [find, setFind] = useState('')
  const [opponent, setOpponent] = useState(preset || null)
  const [metric, setMetric] = useState('calorias')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  useEffect(() => { activeMembers().then((x) => setMembers(x.filter((m) => m.id !== me.id))).catch(() => setMembers([])) }, [])

  const send = async () => {
    setBusy(true)
    try { await createChallenge({ me, opponent, metric, days }); toast(`⚔️ Reto enviado a ${opponent.full_name.split(' ')[0]}`, 'success'); onCreated() } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const shown = (members || []).filter((m) => m.full_name.toLowerCase().includes(find.toLowerCase())).slice(0, 30)

  return (
    <Modal title="Nuevo reto" onClose={onClose} footer={<button className="btn primary" disabled={!opponent || busy} onClick={send}>{busy && <Spinner size={16} />} Enviar reto</button>}>
      <label className="small muted">Rival</label>
      {opponent
        ? <div className="row mb"><Avatar src={opponent.photo} name={opponent.full_name} /><b className="grow">{opponent.full_name}</b><button className="btn sm ghost" onClick={() => setOpponent(null)}>Cambiar</button></div>
        : <div className="mb">
          <div className="input-ic"><Search size={16} /><input className="input" placeholder="Buscar miembro..." value={find} onChange={(e) => setFind(e.target.value)} /></div>
          <div className="pick-list">{!members ? <Loading /> : shown.map((m) => (
            <button key={m.id} className="row pick" onClick={() => setOpponent(m)}><Avatar src={m.photo} name={m.full_name} /><span>{m.full_name}</span></button>
          ))}</div>
        </div>}
      <label className="small muted">¿Quién gana?</label>
      <div className="chips mb">{METRICS.map((x) => <button key={x.id} className={`chip ${metric === x.id ? 'on' : ''}`} onClick={() => setMetric(x.id)}>{x.emoji} {x.label}</button>)}</div>
      <label className="small muted">Duración</label>
      <div className="chips">{[3, 7, 14, 30].map((d) => <button key={d} className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>{d} días</button>)}</div>
      <p className="tiny muted">Cuentan las rutinas del gimnasio y las actividades sincronizadas desde la pulsera o subidas en archivo. El reto empieza cuando tu rival lo acepta.</p>
    </Modal>
  )
}
