// Tarjetas de fidelidad para clientes temporales (planes de 7 y 14 días).
import { supabase, q } from './supabase'

export const LOYALTY_PLANS = [
  { days: 7, label: '7 días', gift: 0, desc: 'Sin obsequio. Al completar los 7 días la tarjeta termina.' },
  { days: 14, label: '14 días', gift: 1, desc: 'Al completar los 14 días se regala 1 día. Al usarlo, la tarjeta termina.' }
]

const PUBLIC_URL = 'https://cashlessmot2026.github.io/gym/'
const isNative = () => !!window.Capacitor?.isNativePlatform?.()

/** Link que se le envía al cliente para ver su tarjeta (sin iniciar sesión). */
export const cardLink = (token) =>
  (isNative() ? PUBLIC_URL : location.origin + import.meta.env.BASE_URL) + 'tarjeta/' + token

/** Lo que va dentro del QR de la tarjeta. */
export const cardQr = (code) => 'IYF:' + code

/** Acepta "IYF:ABCD1234", el link completo de la tarjeta o el código escrito a mano. */
export const parseCardCode = (text) => {
  const t = String(text || '').trim()
  const link = t.match(/tarjeta\/([0-9a-f-]{36})/i)
  if (link) return link[1]
  return t.replace(/^IYF:/i, '').replace(/\s+/g, '').toUpperCase()
}

const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()

export const listCards = () =>
  q(supabase.from('loyalty_cards').select('*, visits:loyalty_visits(created_at, kind, note)').order('created_at', { ascending: false }))

export async function createCard({ full_name, phone, plan_days, price }, staffId) {
  if (!full_name?.trim()) throw new Error('Escribe el nombre del cliente')
  if (![7, 14].includes(Number(plan_days))) throw new Error('Elige el plan de 7 o 14 días')
  const row = {
    full_name: full_name.trim(), phone: phone?.trim() || null, plan_days: Number(plan_days),
    price: price === '' || price == null ? null : Number(price), created_by: staffId || null, code: newCode()
  }
  return (await q(supabase.from('loyalty_cards').insert(row).select('*')))[0]
}

export const deleteCard = (id) => q(supabase.from('loyalty_cards').delete().eq('id', id))

export async function confirmDay(code, staffId) {
  const { data, error } = await supabase.rpc('loyalty_confirm_day', { p_code: code, p_staff: staffId || null })
  if (error) throw new Error(error.message)
  return data
}

export async function redeemGift(code, staffId) {
  const { data, error } = await supabase.rpc('loyalty_use_gift', { p_code: code, p_staff: staffId || null })
  if (error) throw new Error(error.message)
  return data
}

/** Tarjeta pública del cliente por su token. Devuelve null si ya terminó o no existe. */
export async function getCardByToken(token) {
  const rows = await q(supabase.from('loyalty_cards')
    .select('id, token, code, full_name, plan_days, days_done, gift_days, created_at, visits:loyalty_visits(created_at, kind, note)')
    .eq('token', token).limit(1))
  return rows[0] || null
}

/** Escucha cambios de una tarjeta (Supabase Realtime). Devuelve la función para dejar de escuchar. */
export function watchCard(id, onChange) {
  const ch = supabase.channel('loyalty-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loyalty_cards', filter: `id=eq.${id}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(ch)
}

export const whatsappLink = (card) => {
  const phone = String(card.phone || '').replace(/\D/g, '')
  const to = phone.length === 10 ? '57' + phone : phone
  const text = `Hola ${card.full_name.split(' ')[0]} 👋 Esta es tu tarjeta de fidelidad de IronYellow Gym (plan ${card.plan_days} días). Guárdala y muéstrala en recepción cada día: ${cardLink(card.token)}`
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`
}
