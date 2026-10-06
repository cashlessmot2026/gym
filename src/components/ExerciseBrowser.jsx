import { useEffect, useState } from 'react'
import { Globe, CirclePlay, Plus, Search, Dumbbell } from 'lucide-react'
import { fetchWger, WGER_CATEGORIES, CURATED, videoSearch } from '../lib/exerciseLibrary'
import { Loading, Empty } from './ui'

/** Explorador de ejercicios de internet por modalidad (wger.de + catálogo curado). */
export default function ExerciseBrowser({ types, initialType, onImport }) {
  const [type, setType] = useState(initialType || types[0]?.name)
  const t = types.find((x) => x.name === type)
  const cats = t?.wger_categories?.length ? t.wger_categories : []
  const [cat, setCat] = useState(cats[0])
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [term, setTerm] = useState('')

  useEffect(() => { setCat(cats[0]) }, [type])
  useEffect(() => {
    if (!cat) { setList([]); return }
    setList(null); setErr('')
    fetchWger(cat, { limit: 60 }).then(setList).catch((e) => { setErr(e.message); setList([]) })
  }, [cat])

  const filtered = (list || []).filter((e) => !term || e.name.toLowerCase().includes(term.toLowerCase()))

  return (
    <div className="col">
      <div className="row wrap">
        {types.map((x) => <button key={x.id} className={`chip ${x.name === type ? 'on' : ''}`} onClick={() => setType(x.name)}>{x.emoji} {x.name}</button>)}
      </div>
      {t?.description && <p className="muted small" style={{ margin: 0 }}>{t.description}</p>}

      <div className="card">
        <h3><Dumbbell size={16} className="y" /> Ejercicios clave de {type}</h3>
        <div className="grid auto">
          {(CURATED[type] || []).map((n) => (
            <div key={n} className="ex" style={{ cursor: 'default' }}>
              <div className="ex-img"><Dumbbell size={22} /></div>
              <div className="grow"><div style={{ fontWeight: 700 }}>{n}</div>
                <div className="row" style={{ gap: 6, marginTop: 4 }}>
                  <a className="btn sm ghost" href={videoSearch(n)} target="_blank" rel="noreferrer"><CirclePlay size={14} /> Ver técnica</a>
                  {onImport && <button className="btn sm" onClick={() => onImport({ name: n, training_type: type })}><Plus size={14} /></button>}
                </div>
              </div>
            </div>
          ))}
          {!CURATED[type] && <Empty>Modalidad personalizada: usa la biblioteca en línea o crea tus propios ejercicios.</Empty>}
        </div>
      </div>

      {cats.length > 0 && (
        <div className="card">
          <div className="row between wrap mb">
            <h3 style={{ margin: 0 }}><Globe size={16} className="y" /> Biblioteca en línea <span className="tiny muted">(wger.de)</span></h3>
            <div className="row wrap">
              {cats.map((c) => <button key={c} className={`chip ${c === cat ? 'on' : ''}`} onClick={() => setCat(c)}>{WGER_CATEGORIES[c]}</button>)}
            </div>
          </div>
          <div className="row mb"><Search size={16} className="muted" /><input className="input" placeholder="Buscar ejercicio…" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
          {list === null ? <Loading text="Consultando internet…" /> : err ? <Empty>{err}</Empty> : (
            <div className="grid auto">
              {filtered.map((e) => (
                <div key={e.id} className="card" style={{ padding: 12 }}>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    {e.image_url ? <img className="ex-img" src={e.image_url} alt="" loading="lazy" style={{ background: '#fff' }} /> : <div className="ex-img"><Dumbbell size={22} /></div>}
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{e.name} {e.lang === 'en' && <span className="badge tiny">EN</span>}</div>
                      <div className="tiny muted">{e.muscle_group}{e.equipment.length ? ' · ' + e.equipment.join(', ') : ''}</div>
                    </div>
                  </div>
                  {e.description && <p className="tiny muted" style={{ maxHeight: 54, overflow: 'hidden' }}>{e.description}</p>}
                  <div className="row" style={{ gap: 6 }}>
                    <a className="btn sm ghost" href={videoSearch(e.name)} target="_blank" rel="noreferrer"><CirclePlay size={14} /> Video</a>
                    {onImport && <button className="btn sm primary" onClick={() => onImport({ name: e.name, muscle_group: e.muscle_group, description: e.description, image_url: e.image_url, training_type: type })}><Plus size={14} /> Importar</button>}
                  </div>
                </div>
              ))}
              {!filtered.length && <Empty>Sin resultados</Empty>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
