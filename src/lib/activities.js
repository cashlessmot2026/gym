// Guarda actividades de pulseras/relojes (Health Connect, FIT, TCX, GPX) y,
// después de cada carga, sincroniza el ranking y los retos del cliente.
import { supabase, q } from './supabase'
import { refreshScore } from './ranking'
import { refreshChallenges } from './challenges'
import { healthConsented, healthSupported, readHealthWorkouts } from './health'
import { hrProfile } from './hr'

/** Inserta las actividades nuevas (las repetidas se ignoran). Devuelve cuántas eran nuevas. */
export async function saveActivities(member, list) {
  if (!list.length) return 0
  const keys = list.map((a) => a.dedupe_key)
  const existing = await q(supabase.from('activities').select('dedupe_key').eq('member_id', member.id).in('dedupe_key', keys))
  const have = new Set(existing.map((x) => x.dedupe_key))
  const fresh = list.filter((a, i) => !have.has(a.dedupe_key) && keys.indexOf(a.dedupe_key) === i)
  if (fresh.length) {
    await q(supabase.from('activities').upsert(fresh.map((a) => ({ ...a, member_id: member.id })), { onConflict: 'member_id,dedupe_key', ignoreDuplicates: true }))
  }
  await afterSync(member)
  return fresh.length
}

/** Ranking + retos al día tras cualquier carga de datos. */
export async function afterSync(member) {
  await Promise.all([refreshScore(member), refreshChallenges(member.id)]).catch((e) => console.warn('[sync]', e))
}

export async function latestWeight(memberId) {
  const r = await q(supabase.from('body_metrics').select('weight').eq('member_id', memberId).not('weight', 'is', null).order('date', { ascending: false }).limit(1))
  return r[0]?.weight ? Number(r[0].weight) : 70
}

/**
 * Sincroniza Health Connect desde la última vez (o 30 días). Se llama sola al
 * abrir la app si el cliente ya dio permiso. Devuelve cuántas actividades nuevas.
 */
export async function syncHealth(member) {
  if (!healthSupported() || !healthConsented()) return 0
  const profile = hrProfile(member, await latestWeight(member.id))
  // 1 h de margen por entrenamientos que la pulsera sube con retraso
  const since = member.health_last_sync ? new Date(new Date(member.health_last_sync).getTime() - 3600000) : null
  const list = await readHealthWorkouts(since, profile)
  const n = await saveActivities(member, list)
  await supabase.from('members').update({ health_last_sync: new Date().toISOString() }).eq('id', member.id)
  return n
}

export const listActivities = (memberId, limit = 60) =>
  q(supabase.from('activities').select('*').eq('member_id', memberId).order('started_at', { ascending: false }).limit(limit))
