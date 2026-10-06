// Notificaciones — sin Firebase:
// - Web / PWA: Push API + Service Worker con claves VAPID (llegan con la app cerrada).
// - App Android: notificaciones LOCALES (@capacitor/local-notifications):
//     · Alertas de clase programadas en el teléfono 10 min antes, con canal de alarma.
//     · Promociones: tarea en segundo plano (@capacitor/background-runner) que consulta
//       Supabase cada ~15 min y las muestra aunque la app esté cerrada.
// - App abierta: Supabase Realtime → banner interno (y alarma en alertas de clase).
// owner = { member_id } (clientes) o { staff_id } (coaches/personal)
import { supabase, q, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'
import { scheduleClassAlerts } from './classes'

export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BA7d65PQ5B0LqG5Nf5XTYOLBUi744wDtMDggzJgrGN-thLujug4qtflTu2vZuuSY9LiQ-27CbFysCMS4MNcRlh0'

export const isNative = () => !!window.Capacitor?.isNativePlatform?.()
const RUNNER = 'com.ironyellow.gym.check'
const toOwner = (x) => (typeof x === 'string' ? { member_id: x } : x)

export function pushSupport() {
  if (isNative()) return 'native'
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'web'
  return null
}

export function pushPermission() {
  if (isNative()) return localStorage.getItem('iy_push_native') || 'default'
  return 'Notification' in window ? Notification.permission : 'denied'
}

const toUint8 = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const deviceId = () => {
  let id = localStorage.getItem('iy_device_id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('iy_device_id', id) }
  return id
}

async function saveSubscription(row) {
  return q(supabase.from('push_subscriptions').upsert({ ...row, last_seen: new Date().toISOString(), user_agent: navigator.userAgent.slice(0, 250) }, { onConflict: 'endpoint' }))
}

async function swRegistration() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Service Worker no activo. Las notificaciones push funcionan en la versión instalada/compilada (npm run build).')), 4000))
  ])
}

/** Canales de Android: promociones (normal) y clases (alarma, máxima prioridad). */
async function nativeChannels(LocalNotifications) {
  await LocalNotifications.createChannel({ id: 'promos', name: 'Promociones y avisos', importance: 4, visibility: 1, vibration: true }).catch(() => {})
  await LocalNotifications.createChannel({
    id: 'clases', name: 'Alertas de clase', description: 'Aviso con alarma 10 minutos antes de tu clase',
    importance: 5, visibility: 1, sound: 'alarma.wav', vibration: true, lights: true, lightColor: '#FFD60A'
  }).catch(() => {})
}

/** Configura la tarea en segundo plano con el usuario actual (consulta Supabase cada ~15 min). */
async function configureBackground(owner) {
  try {
    const { BackgroundRunner } = await import('@capacitor/background-runner')
    await BackgroundRunner.dispatchEvent({ label: RUNNER, event: 'configure', details: { ...owner, url: SUPABASE_URL, key: SUPABASE_ANON_KEY } })
  } catch { /* sin runner */ }
}

/** Pide permiso y registra este dispositivo. */
export async function enablePush(ownerOrMemberId) {
  const owner = toOwner(ownerOrMemberId)
  const kind = pushSupport()
  if (!kind) throw new Error('Este navegador no soporta notificaciones push. En iPhone, instala la app en la pantalla de inicio (iOS 16.4+).')

  if (kind === 'native') {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') { localStorage.setItem('iy_push_native', 'denied'); throw new Error('Permiso de notificaciones denegado. Actívalo en Ajustes > Apps > IronYellow Gym > Notificaciones.') }
    await nativeChannels(LocalNotifications)
    // Android 12+: las alarmas exactas garantizan que la alerta suene justo 10 min antes
    try {
      const ex = await LocalNotifications.checkExactNotificationSetting?.()
      if (ex && ex.exact_notification_setting !== 'granted' && !localStorage.getItem('iy_exact_asked')) {
        localStorage.setItem('iy_exact_asked', '1')
        await LocalNotifications.changeExactNotificationSetting()
      }
    } catch { /* versión sin alarmas exactas */ }
    await saveSubscription({ ...owner, platform: 'android', endpoint: `local:${deviceId()}` })
    localStorage.setItem('iy_push_native', 'granted')
    localStorage.setItem('iy_push_owner', JSON.stringify(owner))
    await configureBackground(owner)
    await scheduleClassAlerts(owner).catch(() => {})
    return true
  }

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Permiso de notificaciones denegado. Actívalo en la configuración del navegador.')
  const reg = await swRegistration()
  let sub = await reg.pushManager.getSubscription()
  // Si la suscripción se creó con otra clave VAPID, el servidor la rechaza (403): se renueva
  const wanted = toUint8(VAPID_PUBLIC_KEY)
  const have = sub?.options?.applicationServerKey && new Uint8Array(sub.options.applicationServerKey)
  if (sub && have && (have.length !== wanted.length || have.some((b, i) => b !== wanted[i]))) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8(VAPID_PUBLIC_KEY) })
  const j = sub.toJSON()
  await saveSubscription({ ...owner, platform: 'web', endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth })
  return true
}

export async function disablePush() {
  if (isNative()) {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }))
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) }).catch(() => {})
    await supabase.from('push_subscriptions').delete().eq('endpoint', `local:${deviceId()}`)
    await configureBackground({})
    localStorage.setItem('iy_push_native', 'default')
    return
  }
  const reg = await swRegistration().catch(() => null)
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
}

/** Si ya hay permiso, vuelve a guardar la suscripción y reprograma alertas de clase. */
export async function syncPush(ownerOrMemberId) {
  try {
    if (pushPermission() === 'granted') await enablePush(ownerOrMemberId)
  } catch { /* silencioso */ }
}

/** Muestra una notificación del sistema inmediata en la app nativa (app en segundo plano). */
export async function showNativeNow(n) {
  if (!isNative() || pushPermission() !== 'granted') return
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  await LocalNotifications.schedule({
    notifications: [{
      id: Math.abs(hash(n.id || n.title)) % 2000000000, title: n.title, body: n.body, largeBody: n.body,
      channelId: n.category === 'clase' ? 'clases' : 'promos', extra: { url: n.url, id: n.id }
    }]
  }).catch(() => {})
}

export const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h }

/** Escucha notificaciones con la app abierta (SW o nativo) y aperturas desde la notificación. */
export function listenPushMessages({ onMessage, onOpen }) {
  const offs = []
  if ('serviceWorker' in navigator) {
    const h = (e) => {
      if (e.data?.type === 'push') onMessage?.(e.data.payload)
      if (e.data?.type === 'open') onOpen?.(e.data)
    }
    navigator.serviceWorker.addEventListener('message', h)
    offs.push(() => navigator.serviceWorker.removeEventListener('message', h))
  }
  if (isNative()) {
    import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
      const h = LocalNotifications.addListener('localNotificationActionPerformed', (a) => onOpen?.({ url: a.notification.extra?.url, id: a.notification.extra?.id }))
      offs.push(() => Promise.resolve(h).then((x) => x?.remove?.()))
    })
  }
  return () => offs.forEach((f) => f())
}

/** Pide a la Edge Function que envíe la notificación a todos los dispositivos de la audiencia. */
export async function dispatchPush(notificationId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ id: notificationId })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `La función send-push respondió ${res.status}`)
  return body
}

/** ¿Esta notificación es para este cliente / miembro del personal? */
export const isForMember = (n, memberId) => !n.recipients || n.recipients.includes(memberId)
export const isForStaff = (n, staffId) => (n.audience?.staff_ids || []).includes(staffId)
