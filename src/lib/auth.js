import { supabase, q } from './supabase'

const KEY = (scope) => `iy_session_${scope}`

export function getSession(scope) {
  try { return JSON.parse(localStorage.getItem(KEY(scope))) } catch { return null }
}
export function setSession(scope, user) {
  localStorage.setItem(KEY(scope), JSON.stringify(user))
}
export function clearSession(scope) {
  localStorage.removeItem(KEY(scope))
}

/** scope: 'member' | 'admin' | 'coach' | 'check' */
export async function login(scope, user, pass) {
  if (scope === 'member') {
    const rows = await q(supabase.rpc('member_login', { p_user: user, p_pass: pass }))
    if (!rows?.length) throw new Error('Credenciales inválidas')
    const { face_descriptors, ...m } = rows[0]
    return m
  }
  const rows = await q(supabase.rpc('staff_login', { p_user: user, p_pass: pass }))
  if (!rows?.length) throw new Error('Credenciales inválidas')
  const s = rows[0]
  const allowed = { admin: ['admin'], coach: ['coach', 'admin'], check: ['reception', 'admin', 'coach'] }[scope]
  if (!allowed.includes(s.role)) throw new Error('Tu usuario no tiene acceso a esta sección')
  return s
}

export async function recoverPassword(email) {
  return q(supabase.rpc('recover_password', { p_email: email }))
}

export async function setPassword(ownerType, ownerId, pass) {
  return q(supabase.rpc('set_password', { p_owner_type: ownerType, p_owner_id: ownerId, p_pass: pass }))
}
