// Supabase Edge Function: envía una promoción/notificación push.
// - Web Push (navegador, PWA instalada) con claves VAPID.
// - Android nativo vía Firebase Cloud Messaging HTTP v1 (opcional).
//
// Secretos necesarios:
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:admin@tugym.com
//   (opcional Android) supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
// Despliegue:
//   supabase functions deploy send-push --no-verify-jwt
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@ironyellow.gym",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

/** Convierte la audiencia elegida por el admin en una lista de IDs de clientes (null = todos). */
async function resolveRecipients(a: any): Promise<string[] | null> {
  if (!a || a.type === "all") return null;
  if (a.type === "members") return a.ids ?? [];
  const { data: rows, error } = await db.from("member_status").select("member_id, status, active");
  if (error) throw error;
  const active = (rows ?? []).filter((r: any) => r.active);
  if (a.type === "active") return active.filter((r: any) => ["activa", "por_vencer"].includes(r.status)).map((r: any) => r.member_id);
  if (a.type === "expiring") return active.filter((r: any) => r.status === "por_vencer").map((r: any) => r.member_id);
  if (a.type === "expired") return active.filter((r: any) => ["vencida", "sin_plan"].includes(r.status)).map((r: any) => r.member_id);
  if (a.type === "modes") {
    const { data, error: e2 } = await db.from("members").select("id").eq("active", true).overlaps("training_modes", a.modes ?? []);
    if (e2) throw e2;
    return (data ?? []).map((m: any) => m.id);
  }
  return null;
}

// ---------- FCM HTTP v1 (Android nativo) ----------
let fcmToken: { value: string; exp: number } | null = null;
const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function fcmAccessToken(sa: any) {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${claim}.${b64url(sig)}`,
  });
  const t = await res.json();
  if (!t.access_token) throw new Error("FCM auth: " + JSON.stringify(t));
  fcmToken = { value: t.access_token, exp: Date.now() + t.expires_in * 1000 };
  return fcmToken.value;
}

async function sendFcm(sa: any, token: string, n: any) {
  const access = await fcmAccessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: n.title, body: n.body, ...(n.image_url ? { image: n.image_url } : {}) },
        data: { id: n.id, url: n.url ?? "/", category: n.category ?? "promo" },
        android: { priority: "high", notification: { color: "#FFD60A", channel_id: "promos" } },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err: any = new Error(body);
    err.statusCode = res.status === 404 || body.includes("UNREGISTERED") ? 410 : res.status;
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let id: string | undefined;
  try {
    ({ id } = await req.json());
    const { data: n, error } = await db.from("notifications").select("*").eq("id", id).single();
    if (error || !n) return json({ error: "Notificación no encontrada" }, 404);

    await db.from("notifications").update({ status: "enviando" }).eq("id", id);
    const recipients = await resolveRecipients(n.audience);
    await db.from("notifications").update({ recipients }).eq("id", id);

    let q = db.from("push_subscriptions").select("*");
    if (recipients) {
      if (!recipients.length) {
        await db.from("notifications").update({ status: "enviada", sent_at: new Date().toISOString() }).eq("id", id);
        return json({ sent: 0, failed: 0, devices: 0 });
      }
      q = q.in("member_id", recipients);
    }
    const { data: subs, error: e2 } = await q;
    if (e2) throw e2;

    const sa = Deno.env.get("FCM_SERVICE_ACCOUNT") ? JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT")!) : null;
    const payload = JSON.stringify({ id: n.id, title: n.title, body: n.body, image: n.image_url, url: n.url ?? "/", category: n.category });
    let sent = 0, failed = 0;
    const dead: string[] = [];

    for (let i = 0; i < (subs ?? []).length; i += 50) {
      const chunk = subs!.slice(i, i + 50);
      const results = await Promise.allSettled(chunk.map((s: any) => {
        if (s.platform === "web") {
          return webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" });
        }
        if (!sa) return Promise.reject(Object.assign(new Error("FCM no configurado"), { statusCode: 0 }));
        return sendFcm(sa, s.endpoint, n);
      }));
      results.forEach((r, k) => {
        if (r.status === "fulfilled") sent++;
        else {
          failed++;
          const code = (r.reason as any)?.statusCode;
          if (code === 404 || code === 410) dead.push(chunk[k].id); // suscripción caducada
        }
      });
    }
    if (dead.length) await db.from("push_subscriptions").delete().in("id", dead);

    await db.from("notifications").update({
      status: "enviada", sent_count: sent, failed_count: failed, devices_count: subs?.length ?? 0, sent_at: new Date().toISOString(),
    }).eq("id", id);
    return json({ sent, failed, devices: subs?.length ?? 0, removed: dead.length });
  } catch (e) {
    if (id) await db.from("notifications").update({ status: "error", error: (e as Error).message }).eq("id", id);
    return json({ error: (e as Error).message }, 500);
  }
});
