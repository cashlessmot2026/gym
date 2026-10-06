import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { X, Dumbbell, LogOut, Loader2, Menu } from 'lucide-react'

// ---------- Toasts ----------
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((msg, type = 'info') => {
    const id = Math.random()
    setItems((x) => [...x, { id, msg, type }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------- Básicos ----------
export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
        </div>
        {children}
        {footer && <div className="row mt" style={{ justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, span }) {
  return <div className="field" style={span ? { gridColumn: `span ${span}` } : undefined}><label>{label}</label>{children}</div>
}

export function Input({ label, span, ...p }) {
  return <Field label={label} span={span}><input className="input" {...p} value={p.value ?? ''} /></Field>
}

export function Select({ label, options, span, ...p }) {
  return (
    <Field label={label} span={span}>
      <select className="input" {...p} value={p.value ?? ''}>
        {options.map((o) => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )
}

export function Stat({ label, value, icon: Icon, y, sub }) {
  return (
    <div className={`stat ${y ? 'y' : ''}`}>
      {Icon && <Icon className="ic" size={22} />}
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub && <div className="small muted" style={y ? { color: '#000' } : undefined}>{sub}</div>}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.icon && <t.icon size={16} />}{t.label}
        </button>
      ))}
    </div>
  )
}

export function Avatar({ src, name, lg }) {
  if (src) return <img className={`avatar ${lg ? 'lg' : ''}`} src={src} alt={name} />
  const ini = (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return <div className={`avatar ${lg ? 'lg' : ''}`}>{ini}</div>
}

export const Spinner = ({ size = 20 }) => <Loader2 size={size} className="spin" />

export function Loading({ text = 'Cargando...' }) {
  return <div className="empty"><Spinner /> <div className="mt">{text}</div></div>
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

export function StatusBadge({ status, days }) {
  const map = {
    activa: ['ok', `Activa · ${days} d`],
    por_vencer: ['warn', `Vence en ${days} d`],
    vencida: ['bad', 'Vencida'],
    sin_plan: ['', 'Sin plan']
  }
  const [c, t] = map[status] || map.sin_plan
  return <span className={`badge ${c}`}>{t}</span>
}

// ---------- Markdown mínimo y seguro (sin HTML crudo) ----------
function inline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('_') && p.endsWith('_') && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>
    return p
  })
}

export function Markdown({ text }) {
  const lines = (text || '').split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l) continue
    if (l.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells)
        i++
      }
      i--
      out.push(
        <div key={i} style={{ overflowX: 'auto' }}><table>
          <thead><tr>{rows[0]?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table></div>
      )
      continue
    }
    if (/^###\s/.test(l)) { out.push(<h3 key={i}>{inline(l.slice(4))}</h3>); continue }
    if (/^#{1,2}\s/.test(l)) { out.push(<h2 key={i}>{inline(l.replace(/^#+\s/, ''))}</h2>); continue }
    if (/^[-*•]\s/.test(l) || /^\d+\.\s/.test(l)) {
      const items = []
      while (i < lines.length && (/^[-*•]\s/.test(lines[i].trim()) || /^\d+\.\s/.test(lines[i].trim()))) {
        items.push(lines[i].trim().replace(/^([-*•]|\d+\.)\s/, '')); i++
      }
      i--
      out.push(<ul key={i}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</ul>)
      continue
    }
    if (l.startsWith('>')) { out.push(<blockquote key={i}>{inline(l.replace(/^>\s?/, ''))}</blockquote>); continue }
    out.push(<p key={i}>{inline(l)}</p>)
  }
  return <div className="md">{out}</div>
}

// ---------- Shell con navegación lateral + inferior (móvil) ----------
export function Brand({ sub }) {
  return (
    <div className="brand">
      <div className="brand-logo"><Dumbbell size={22} /></div>
      <div>
        <div className="brand-name">IRON<span>YELLOW</span></div>
        {sub && <div className="tiny muted" style={{ letterSpacing: '.15em', fontWeight: 700 }}>{sub}</div>}
      </div>
    </div>
  )
}

export function Shell({ sub, nav, value, onChange, user, onLogout, children }) {
  const [sheet, setSheet] = useState(false)
  // Móvil: máximo 5 botones abajo; el resto va en "Más"
  const MAX = 5
  const primary = nav.length > MAX ? nav.slice(0, MAX - 1) : nav
  const rest = nav.length > MAX ? nav.slice(MAX - 1) : []
  const go = (id) => { onChange(id); setSheet(false); window.scrollTo({ top: 0 }) }
  return (
    <div className="shell">
      <aside className="side">
        <Brand sub={sub} />
        {nav.map((n) => (
          <button key={n.id} className={`nav-item ${value === n.id ? 'on' : ''}`} onClick={() => onChange(n.id)}>
            <n.icon size={19} />{n.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {user && (
          <div className="card" style={{ padding: 12 }}>
            <div className="row">
              <Avatar src={user.photo} name={user.full_name} />
              <div className="grow"><div className="small" style={{ fontWeight: 700 }}>{user.full_name}</div><div className="tiny muted">{user.role || 'Cliente'}</div></div>
              <button className="icon-btn" onClick={onLogout} title="Cerrar sesión"><LogOut size={18} /></button>
            </div>
          </div>
        )}
      </aside>

      <header className="mobile-bar">
        <div className="brand mini"><div className="brand-logo"><Dumbbell size={18} /></div><div className="brand-name">IRON<span>YELLOW</span></div></div>
        {user && <button className="mobile-user" onClick={() => setSheet(true)} aria-label="Mi cuenta"><Avatar src={user.photo} name={user.full_name} /></button>}
      </header>

      <main className="main">{children}</main>

      <nav className="bottom-nav">
        {primary.map((n) => (
          <button key={n.id} className={value === n.id ? 'on' : ''} onClick={() => go(n.id)}>
            <n.icon size={21} /><span>{n.short || n.label}</span>
          </button>
        ))}
        {rest.length > 0 && (
          <button className={rest.some((n) => n.id === value) ? 'on' : ''} onClick={() => setSheet(true)}>
            <Menu size={21} /><span>Más</span>
          </button>
        )}
      </nav>

      {sheet && (
        <div className="overlay sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="sheet">
            <div className="sheet-grip" />
            {user && (
              <div className="row mb">
                <Avatar src={user.photo} name={user.full_name} />
                <div className="grow"><div style={{ fontWeight: 800 }}>{user.full_name}</div><div className="tiny muted">{user.role || 'Cliente'} · {sub}</div></div>
                <button className="icon-btn" onClick={() => setSheet(false)} aria-label="Cerrar"><X /></button>
              </div>
            )}
            {rest.length > 0 && (
              <div className="sheet-grid">
                {rest.map((n) => (
                  <button key={n.id} className={`sheet-item ${value === n.id ? 'on' : ''}`} onClick={() => go(n.id)}>
                    <n.icon size={22} /><span>{n.label}</span>
                  </button>
                ))}
              </div>
            )}
            {onLogout && <button className="btn danger block mt" onClick={() => { setSheet(false); onLogout() }}><LogOut size={16} /> Cerrar sesión</button>}
          </div>
        </div>
      )}
    </div>
  )
}

export function PageTitle({ a, b, children }) {
  return (
    <div className="topbar">
      <h1 className="page-title">{a} <span>{b}</span></h1>
      <div className="row wrap">{children}</div>
    </div>
  )
}
