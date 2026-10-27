// El gym ya no maneja clases (ahora son rutinas). Esto solo limpia en el teléfono
// las alarmas de clase que hubieran quedado programadas por versiones anteriores.
export async function scheduleClassAlerts() {
  if (!window.Capacitor?.isNativePlatform?.()) return 0
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }))
  const old = pending.notifications.filter((n) => n.extra?.kind === 'clase')
  if (old.length) await LocalNotifications.cancel({ notifications: old.map((n) => ({ id: n.id })) })
  return 0
}
