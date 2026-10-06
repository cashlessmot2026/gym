import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'

/** Dibuja una ruta [[lat, lon], ...] sobre OpenStreetMap. */
export default function RouteMap({ route, height = 260, interactive = true }) {
  const el = useRef(null)
  useEffect(() => {
    if (!route?.length || !el.current) return
    let map
    let off = false
    import('leaflet').then(({ default: L }) => {
      if (off) return
      map = L.map(el.current, { zoomControl: interactive, dragging: interactive, scrollWheelZoom: false, touchZoom: interactive, doubleClickZoom: interactive, attributionControl: true })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
      const line = L.polyline(route, { color: '#FFD60A', weight: 4 }).addTo(map)
      L.circleMarker(route[0], { radius: 6, color: '#000', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }).addTo(map)
      L.circleMarker(route[route.length - 1], { radius: 6, color: '#000', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }).addTo(map)
      map.fitBounds(line.getBounds(), { padding: [18, 18] })
    })
    return () => { off = true; map?.remove() }
  }, [route, interactive])
  if (!route?.length) return null
  return <div ref={el} className="route-map" style={{ height }} />
}
