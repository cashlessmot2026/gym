// Supabase Edge Function: alerta push 10 minutos antes de cada clase.
// La ejecuta pg_cron cada minuto (ver supabase/04_clases.sql).
// - Clientes: grupo fijo de la clase + reservas de ese día.
// - Coach: el asignado al horario (o a la clase).
// Despliegue: supabase functions deploy class-reminders --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TZ = Deno.env.get("GYM_TIMEZONE") ?? "America/Bogota";
const LEAD_MIN = Number(Deno.env.get("CLASS_REMINDER_MINUTES") ?? 10);
const db = createClient(URL, KEY);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Fecha, día de la semana y hora (HH:MM) en la zona horaria del gimnasio. */
function local(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: DAYS.indexOf(p.weekday), hm: `${p.hour}:${p.minute}` };
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
    // Ventana: clases que empiezan entre LEAD-1 y LEAD+1 minutos (tolera retrasos del cron)
    const from = local(new Date(Date.now() + (LEAD_MIN - 1) * 60000));
    const to = local(new Date(Date.now() + (LEAD_MIN + 1) * 60000));
    if (from.date !== to.date) return Response.json({ skipped: "cambio de día" });

    const { data: scheds, error } = await db.from("class_schedules")
      .select("*, gym_classes(*)")
      .eq("weekday", from.weekday).eq("active", true)
      .gte("start_time", from.hm + ":00").lte("start_time", to.hm + ":59");
    if (error) throw error;

    const sent: string[] = [];
    for (const s of scheds ?? []) {
      const cls = s.gym_classes;
      if (!cls?.active) continue;
      // Marca como enviada (si ya existe, otra ejecución la envió)
      const { error: dup } = await db.from("class_reminders").insert({ schedule_id: s.id, date: from.date });
      if (dup) continue;

      const [{ data: roster }, { data: books }] = await Promise.all([
        db.from("class_members").select("member_id").eq("class_id", cls.id),
        db.from("class_bookings").select("member_id").eq("schedule_id", s.id).eq("date", from.date).neq("status", "cancelado"),
      ]);
      const ids = [...new Set([...(roster ?? []), ...(books ?? [])].map((r: any) => r.member_id))];
      const hour = String(s.start_time).slice(0, 5);
      const where = cls.room ? ` · ${cls.room}` : "";
      const coach = s.coach_id ?? cls.coach_id;

      if (ids.length) {
        const { data: n } = await db.from("notifications").insert({
          title: `⏰ Tu clase de ${cls.name} empieza en ${LEAD_MIN} minutos`,
          body: `Hoy a las ${hour}${where}. ¡Prepárate y llega a tiempo!`,
          category: "clase", url: "/?tab=classes",
          audience: { type: "members", ids }, recipients: ids,
        }).select().single();
        if (n) await sendPush(n.id);
      }
      if (coach) {
        const { data: n } = await db.from("notifications").insert({
          title: `⏰ Clase ${cls.name} en ${LEAD_MIN} minutos`,
          body: `Hoy a las ${hour}${where} · ${ids.length} alumno${ids.length === 1 ? "" : "s"} inscrito${ids.length === 1 ? "" : "s"}.`,
          category: "clase", url: "/coach",
          audience: { type: "members", ids: [], staff_ids: [coach] }, recipients: [],
        }).select().single();
        if (n) await sendPush(n.id);
      }
      sent.push(`${cls.name} ${hour}`);
    }
    return Response.json({ now: local(new Date()), window: [from.hm, to.hm], sent });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
