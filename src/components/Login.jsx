import { useState } from 'react'
import { Copy, KeyRound, LogIn, Check, Mail } from 'lucide-react'
import { login, recoverPassword } from '../lib/auth'
import { Brand, Modal, Input, Spinner, useToast } from './ui'

const TITLES = {
  member: ['ENTRENA', 'SIN LÍMITES', 'Tu rutina, tu progreso y tu nutrición en un solo lugar.', 'Correo o cédula'],
  admin: ['PANEL', 'ADMIN', 'Membresías, inscripciones, vencimientos y usuarios.', 'Usuario o correo'],
  coach: ['ZONA', 'COACH', 'Rutinas, grupos, asignaciones y analítica de tus clientes.', 'Usuario o correo'],
  check: ['CONTROL DE', 'ACCESO', 'Check-in por cédula, QR, NFC o reconocimiento facial.', 'Usuario o correo']
}

export default function Login({ scope, onLogin }) {
  const toast = useToast()
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [forgot, setForgot] = useState(false)
  const [t1, t2, desc, userLabel] = TITLES[scope]

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { onLogin(await login(scope, user, pass)) } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <Brand sub={scope === 'member' ? 'GYM APP' : scope.toUpperCase()} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>{t1}<br /><span>{t2}</span></h1>
          <p className="muted" style={{ maxWidth: 420, fontSize: '1.05rem' }}>{desc}</p>
        </div>
        <div className="stripes" />
      </div>
      <div className="login-form">
        <form className="login-box col" onSubmit={submit}>
          <h2 className="display" style={{ fontSize: '2.4rem', margin: 0 }}>INICIAR <span className="y">SESIÓN</span></h2>
          <Input label={userLabel} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required />
          <Input label="Contraseña" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required />
          {err && <div className="badge bad" style={{ padding: 10 }}>{err}</div>}
          <button className="btn primary lg block" disabled={busy}>{busy ? <Spinner /> : <LogIn size={18} />} Entrar</button>
          <button type="button" className="btn ghost block" onClick={() => setForgot(true)}><KeyRound size={16} /> ¿Olvidaste tu contraseña?</button>
          {scope === 'member' && <p className="tiny muted center">Tu usuario lo crea el gimnasio al inscribirte.</p>}
        </form>
      </div>
      {forgot && <Recover onClose={() => setForgot(false)} toast={toast} />}
    </div>
  )
}

function Recover({ onClose, toast }) {
  const [email, setEmail] = useState('')
  const [count, setCount] = useState(0)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState('')

  const go = async (e) => {
    e.preventDefault()
    setErr(''); setResult(null)
    try {
      const resP = recoverPassword(email)
      for (let i = 3; i > 0; i--) { setCount(i); await new Promise((r) => setTimeout(r, 1000)) }
      setCount(0)
      const res = await resP
      if (!res?.ok) setErr('No existe un usuario activo con ese correo')
      else setResult(res)
    } catch (ex) { setCount(0); setErr(ex.message) }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(result.password) } catch {
      const t = document.createElement('textarea'); t.value = result.password; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
    }
    setCopied(true); toast('Contraseña copiada al portapapeles', 'success')
  }

  return (
    <Modal title="Recuperar contraseña" onClose={onClose}>
      {!result ? (
        <form className="col" onSubmit={go}>
          <p className="muted small">Ingresa tu correo registrado. Por seguridad se genera una <b>clave temporal nueva</b> (las contraseñas se guardan cifradas).</p>
          <Input label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {err && <div className="badge bad" style={{ padding: 10 }}>{err}</div>}
          <button className="btn primary block" disabled={count > 0}>
            {count > 0 ? <>Generando… {count}</> : <><Mail size={16} /> Recuperar</>}
          </button>
        </form>
      ) : (
        <div className="col center">
          <p className="muted">Hola <b>{result.name}</b>, tu usuario es <b className="y">{result.username}</b></p>
          <div className="display" style={{ fontSize: '3rem', background: '#000', border: '2px dashed var(--y)', borderRadius: 16, padding: 14, letterSpacing: '.12em' }}>
            {result.password}
          </div>
          <button className="btn primary block" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiada' : 'Copiar al portapapeles'}</button>
          <p className="tiny muted">Inicia sesión con esta clave. Pide al administrador cambiarla si lo deseas.</p>
        </div>
      )}
    </Modal>
  )
}
