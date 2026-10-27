// Supabase Edge Function: recordatorio diario de rutina.
// La ejecuta pg_cron cada 5 minutos (ver supabase/10_recordatorios.sql).
// A cada cliente se le avisa una vez al día a la hora de su último inicio de sesión,
// si ese día todavía no ha entrado a la app ni ha entrenado.
// Despliegue: supabase functions deploy routine-reminders --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TZ = Deno.env.get("GYM_TIMEZONE") ?? "America/Bogota";
const WINDOW_MIN = 10; // tolera retrasos del cron; routine_reminders evita repetir
const db = createClient(URL, KEY);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Fecha, día de la semana y minuto del día en la zona horaria del gimnasio. */
function local(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: DAYS.indexOf(p.weekday), min: Number(p.hour) * 60 + Number(p.minute), hm: `${p.hour}:${p.minute}` };
}

async function sendPush(id: string) {
  await fetch(`${URL}/functions/v1/send-push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
    body: JSON.stringify({ id }),
  }).catch(() => {});
}

Deno.serve(async () => {
  try {
    const now = local(new Date());
    const { data: members, error } = await db.from("members")
      .select("id, last_login_at").eq("active", true).eq("routine_reminders", true).not("last_login_at", "is", null);
    if (error) throw error;

    // Le toca si su hora de último inicio de sesión cae en la ventana y no ha entrado hoy
    const due = (members ?? []).filter((m: any) => {
      const l = local(new Date(m.last_login_at));
      const diff = now.min - l.min;
      return l.date < now.date && diff >= 0 && diff < WINDOW_MIN;
    }).map((m: any) => m.id);
    if (!due.length) return Response.json({ now: now.hm, sent: 0 });

    // Fuera quien ya entrenó hoy
    const { data: trained } = await db.from("workout_sessions").select("member_id").eq("date", now.date).in("member_id", due);
    const busy = new Set((trained ?? []).map((s: any) => s.member_id));

    // Marca como enviado (si ya existe, otra ejecución lo envió)
    const ids: string[] = [];
    for (const id of due.filter((x) => !busy.has(x))) {
      const { error: dup } = await db.from("routine_reminders").insert({ member_id: id, date: now.date });
      if (!dup) ids.push(id);
    }
    if (!ids.length) return Response.json({ now: now.hm, sent: 0 });

    const { data: routines } = await db.from("routines").select("name, weekdays").eq("published", true);
    const todays = (routines ?? []).filter((r: any) => !r.weekdays?.length || r.weekdays.includes(now.weekday)).map((r: any) => r.name);
    const body = todays.length
      ? `Hoy toca: ${todays.slice(0, 3).join(", ")}${todays.length > 3 ? ` y ${todays.length - 3} más` : ""}. ¡Empieza tu rutina!`
      : "Es la hora en que sueles entrenar. ¡Empieza tu rutina!";

    const { data: n, error: e2 } = await db.from("notifications").insert({
      title: "💪 Es hora de tu rutina", body, category: "recordatorio", url: "/?tab=train",
      audience: { type: "members", ids }, recipients: ids,
    }).select().single();
    if (e2) throw e2;
    await sendPush(n.id);
    return Response.json({ now: now.hm, sent: ids.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
