// Alarma fuerte (sirena de dos tonos) para las alertas de clase con la app abierta.
// Los navegadores sólo permiten sonido después de que el usuario haya tocado la página una vez.
let ctx

export function playAlarm(seconds = 4) {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)
    const t0 = ctx.currentTime
    for (let i = 0; i < seconds * 4; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'square'
      o.frequency.value = i % 2 ? 880 : 1320
      g.gain.setValueAtTime(0.0001, t0 + i * 0.25)
      g.gain.exponentialRampToValueAtTime(1, t0 + i * 0.25 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.25 + 0.22)
      o.connect(g); g.connect(master)
      o.start(t0 + i * 0.25); o.stop(t0 + i * 0.25 + 0.24)
    }
  } catch { /* sin audio */ }
  navigator.vibrate?.([500, 200, 500, 200, 800, 200, 800])
}
