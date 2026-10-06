// Manejo de notificaciones push en el Service Worker (importado por Workbox).
// - App cerrada o en segundo plano: muestra la notificación del sistema.
// - App abierta y visible: envía el mensaje a la ventana para mostrar el banner interno.
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
      icon: '/icon.svg',
      badge: '/icon.svg',
      image: data.image || undefined,
      tag: data.id || undefined,
      renotify: true,
      vibrate: [120, 60, 120],
      data: { url: data.url || '/', id: data.id },
      actions: [{ action: 'open', title: 'Ver' }]
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href
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
