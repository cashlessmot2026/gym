import { useEffect, useState } from 'react'
import { Trophy, Info } from 'lucide-react'
import { GOALS } from '../../lib/constants'
import { getRanking } from '../../lib/ranking'
import { Avatar, Empty, Loading, useToast } from '../../components/ui'

const HOW = {
  perder_grasa: '% de peso perdido, puntos de grasa corporal bajados y calorías quemadas.',
  hipertrofia: 'Centímetros ganados de brazo y pecho, masa magra ganada y aumento del volumen por sesión.',
  fuerza: 'Mejora media de tu carga máxima en cada ejercicio respecto a tu primer registro.',
  resistencia: 'Kilómetros recorridos y minutos en zonas de pulso 3 a 5 (pulsera o reloj).',
  recomposicion: 'Masa magra ganada y puntos de grasa corporal bajados.',
  salud: 'Minutos activos acumulados.',
  competicion: 'Minutos activos acumulados.'
}

/** Ranking histórico por objetivo: compites con quienes buscan lo mismo que tú. */
export default function Ranking({ me, onOpenProfile, bell }) {
  const toast = useToast()
  const [goal, setGoal] = useState(me.goal || 'salud')
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    setRows(null)
    getRanking(goal).then(setRows).catch((e) => { toast(e.message, 'error'); setRows([]) })
  }, [goal])

  const g = GOALS.find((x) => x.id === goal)
  return (
    <div className="ig-wrap">
      <div className="ig-top"><h1 className="page-title">RAN<span>KING</span></h1>{bell}</div>
      <div className="chips">
        {GOALS.map((x) => <button key={x.id} className={`chip ${goal === x.id ? 'on' : ''}`} onClick={() => setGoal(x.id)}>{x.emoji} {x.label}</button>)}
      </div>
      <div className="card mt small"><Info size={14} /> <b>Histórico · {g?.label}.</b> Puntos por constancia (3 por entrenamiento y 1 por asistencia) + tu mejora desde que empezaste: {HOW[goal]} Se actualiza cada vez que sincronizas tu pulsera, terminas una rutina o registras medidas.</div>

      {!rows ? <Loading /> : !rows.length ? <Empty>Nadie ha elegido este objetivo todavía.</Empty> : (
        <>
          <div className="podium">
            {[1, 0, 2].map((i) => rows[i] && (
              <button key={rows[i].id} className={`pod p${i + 1}`} onClick={() => onOpenProfile(rows[i].id)}>
                <Avatar src={rows[i].photo} name={rows[i].full_name} lg={i === 0} />
                <div className="pod-name">{rows[i].full_name.split(' ')[0]}</div>
                <div className="pod-score">{rows[i].score} pts</div>
                <div className="pod-step">{i + 1}</div>
              </button>
            ))}
          </div>
          <div className="rank-list">
            {rows.map((r, i) => (
              <div key={r.id} className={`rank-row ${r.id === me.id ? 'me' : ''}`}>
                <div className="row" onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                  <div className="rank-pos">{i < 3 ? <Trophy size={16} className={`t${i + 1}`} /> : i + 1}</div>
                  <button className="ig-link" onClick={(e) => { e.stopPropagation(); onOpenProfile(r.id) }}><Avatar src={r.photo} name={r.full_name} /></button>
                  <div className="grow"><div style={{ fontWeight: 700 }}>{r.full_name}{r.id === me.id && ' (tú)'}</div><div className="tiny muted" style={{ textTransform: 'capitalize' }}>{r.level}</div></div>
                  <div className="rank-score">{r.score}</div>
                </div>
                {open === r.id && (
                  <div className="rank-detail">{r.detail.length ? r.detail.map((d) => <div key={d.label} className="row between tiny"><span>{d.label}: <b>{d.value}</b></span><span className="y">+{d.pts}</span></div>) : <span className="tiny muted">Sin datos todavía.</span>}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
