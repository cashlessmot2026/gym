// Notificaciones push:
// - Web/PWA: Push API + Service Worker (llegan con la app cerrada).
// - Android nativo: @capacitor/push-notifications (Firebase Cloud Messaging).
// - App abierta: Supabase Realtime + mensajes del Service Worker → banner interno.
import { supabase, q, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BO-KkAYiHjgTpD5vz9H-cq6V6bbJg2nsftOMvYtUov6SqJPC_BTP43_qDaEyd3d0TUk82oRYTNgh_tUMnQviA0s'

const isNative = () => !!window.Capacitor?.isNativePlatform?.()

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

async function saveSubscription(row) {
  return q(supabase.from('push_subscriptions').upsert({ ...row, last_seen: new Date().toISOString(), user_agent: navigator.userAgent.slice(0, 250) }, { onConflict: 'endpoint' }))
}

async function swRegistration() {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Service Worker no activo. Las notificaciones push funcionan en la versión instalada/compilada (npm run build).')), 4000))
  ])
  return reg
}

/** Pide permiso y registra este dispositivo para el cliente. */
export async function enablePush(memberId) {
  const kind = pushSupport()
  if (!kind) throw new Error('Este navegador no soporta notificaciones push. En iPhone, instala la app en la pantalla de inicio (iOS 16.4+).')

  if (kind === 'native') {
    if (import.meta.env.VITE_FCM_ENABLED !== 'true') throw new Error('Las notificaciones de la app Android se activan cuando el gimnasio configure Firebase. Mientras tanto verás los avisos dentro de la app.')
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') { localStorage.setItem('iy_push_native', 'denied'); throw new Error('Permiso de notificaciones denegado') }
    await PushNotifications.createChannel({ id: 'promos', name: 'Promociones', importance: 5, visibility: 1, lights: true, vibration: true }).catch(() => {})
    const token = await new Promise((resolve, reject) => {
      PushNotifications.addListener('registration', (t) => resolve(t.value))
      PushNotifications.addListener('registrationError', (e) => reject(new Error(e.error || 'Error FCM')))
      PushNotifications.register()
    })
    await saveSubscription({ member_id: memberId, platform: 'android', endpoint: token })
    localStorage.setItem('iy_push_native', 'granted')
    return true
  }

  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Permiso de notificaciones denegado. Actívalo en la configuración del navegador.')
  const reg = await swRegistration()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8(VAPID_PUBLIC_KEY) })
  const j = sub.toJSON()
  await saveSubscription({ member_id: memberId, platform: 'web', endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth })
  return true
}

export async function disablePush() {
  if (isNative()) {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.unregister().catch(() => {})
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

/** Si ya hay permiso, vuelve a guardar la suscripción (enlaza dispositivo ↔ cliente). */
export async function syncPush(memberId) {
  try {
    if (pushPermission() === 'granted') await enablePush(memberId)
  } catch { /* silencioso */ }
}

/** Escucha notificaciones que llegan con la app abierta (SW o nativo) y aperturas desde la notificación. */
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
    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      PushNotifications.addListener('pushNotificationReceived', (n) =>
        onMessage?.({ id: n.data?.id, title: n.title, body: n.body, url: n.data?.url, category: n.data?.category }))
      PushNotifications.addListener('pushNotificationActionPerformed', (a) =>
        onOpen?.({ url: a.notification.data?.url, id: a.notification.data?.id }))
      offs.push(() => PushNotifications.removeAllListeners())
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

/** ¿Esta notificación es para este cliente? */
export const isForMember = (n, memberId) => !n.recipients || n.recipients.includes(memberId)
