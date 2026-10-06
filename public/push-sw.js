// Manejo de notificaciones push en el Service Worker (importado por Workbox).
// - App cerrada o en segundo plano: muestra la notificación del sistema.
// - App abierta y visible: envía el mensaje a la ventana para mostrar el banner interno.
const SCOPE = self.registration.scope // p. ej. https://dominio/gym/
const resolve = (u) => /^https?:/i.test(u || '') ? u : new URL((u || '').replace(/^\//, ''), SCOPE).href

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'IronYellow Gym', body: event.data?.text() } }
  const title = data.title || 'IronYellow Gym'

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const visible = wins.find((w) => w.visibilityState === 'visible' && w.focused)
    if (visible) {
      visible.postMessage({ type: 'push', payload: data })
      return
    }
    await self.registration.showNotification(title, {
      body: data.body || '',
      icon: SCOPE + 'icon.svg',
      badge: SCOPE + 'icon.svg',
      image: data.image || undefined,
      tag: data.id || undefined,
      renotify: true,
      // Alertas de clase: quedan fijas hasta tocarlas y vibran fuerte
      requireInteraction: !!data.urgent,
      silent: false,
      vibrate: data.urgent ? [600, 200, 600, 200, 900, 200, 900, 200, 900] : [120, 60, 120],
      data: { url: data.url || '/', id: data.id },
      actions: [{ action: 'open', title: 'Ver' }]
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = resolve(event.notification.data?.url)
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus()
        w.postMessage({ type: 'open', url: event.notification.data?.url, id: event.notification.data?.id })
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})

// El navegador rota la suscripción: se avisa a la app para volver a registrarla
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((wins) => wins.forEach((w) => w.postMessage({ type: 'resubscribe' }))))
})
