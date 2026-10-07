// Tarea en segundo plano de la app Android (@capacitor/background-runner).
// Se ejecuta cada ~15 minutos aunque la app esté cerrada: consulta en Supabase las
// promociones/avisos nuevos y los muestra como notificación del teléfono (sin Firebase).
// Las alertas de clase NO se consultan aquí: la app las programa localmente 10 min antes.

const PROMO_BASE = 300000

function hash(s) {
  let x = 0
  for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0
  return Math.abs(x)
}

function kv(key) {
  try { return (CapacitorKV.get(key) || {}).value || '' } catch (e) { return '' }
}

// La app envía el usuario actual: { member_id | staff_id, url, key }
addEventListener('configure', (resolve, reject, args) => {
  try {
    CapacitorKV.set('owner', JSON.stringify(args || {}))
    if (!kv('since')) CapacitorKV.set('since', new Date().toISOString())
    resolve()
  } catch (e) {
    reject(e)
  }
})

addEventListener('checkIn', async (resolve, reject) => {
  try {
    const o = JSON.parse(kv('owner') || '{}')
    if (!o.url || !o.key || !(o.member_id || o.staff_id)) return resolve()
    const headers = { apikey: o.key, Authorization: 'Bearer ' + o.key }
    const since = kv('since') || new Date(Date.now() - 3600 * 1000).toISOString()

    let url = o.url + '/rest/v1/notifications?select=id,title,body,category,url,created_at' +
      '&status=neq.error&created_at=gt.' + encodeURIComponent(since) + '&order=created_at.asc&limit=10'
    url += o.member_id
      ? '&or=' + encodeURIComponent('(recipients.is.null,recipients.cs.{' + o.member_id + '})')
      : '&audience=cs.' + encodeURIComponent(JSON.stringify({ staff_ids: [o.staff_id] }))

    const res = await fetch(url, { headers })
    const list = await res.json()
    if (Array.isArray(list) && list.length) {
      const show = list.filter((n) => n.category !== 'clase')
      if (show.length) {
        CapacitorNotifications.schedule(show.map((n) => ({
          id: PROMO_BASE + (hash(n.id) % 100000),
          title: n.title,
          body: n.body,
          largeBody: n.body,
          channelId: 'promos',
          autoCancel: true,
          extra: { url: n.url, id: n.id }
        })))
      }
      CapacitorKV.set('since', list[list.length - 1].created_at)
    }
    resolve()
  } catch (e) {
    reject(e)
  }
})
