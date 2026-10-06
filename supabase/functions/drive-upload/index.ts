// Supabase Edge Function: guarda las fotos de la comunidad en Google Drive.
//   Drive / IronYellow Gym / <nombre-cliente-xxxxxxxx> / foto.jpg
//
// Usa la cuenta de Google del gimnasio con OAuth (permiso drive.file: la función
// solo ve los archivos y carpetas que ella misma creó).
//
// Secretos necesarios (Dashboard → Edge Functions → Secrets):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// Despliegue:
//   supabase functions deploy drive-upload --no-verify-jwt
//
// Acciones (POST JSON):
//   { action: "upload", member_id, image: <base64 jpeg>, thumb?: <base64 jpeg> } → { drive_id, thumb_id }
//   { action: "delete", member_id, ids: [drive_id, thumb_id] }                     → { ok: true }
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ROOT_NAME = "IronYellow Gym";
const FOLDER = "application/vnd.google-apps.folder";
const MAX_BYTES = 4 * 1024 * 1024;

// ---------- Token de acceso (se renueva con el refresh token) ----------
let token: { value: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.exp) return token.value;
  const id = Deno.env.get("GOOGLE_CLIENT_ID"), secret = Deno.env.get("GOOGLE_CLIENT_SECRET"), refresh = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (!id || !secret || !refresh) throw new Error("Faltan los secretos GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Google OAuth: ${d.error_description || d.error || r.status}`);
  token = { value: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
  return token.value;
}

async function drive(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers || {}) },
  });
  if (r.status === 204) return null;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Drive: ${d.error?.message || r.status}`);
  return d;
}

// ---------- Carpetas (se crean una sola vez y se recuerdan) ----------
const folders = new Map<string, string>();
async function folder(name: string, parent?: string): Promise<string> {
  const key = `${parent || "root"}/${name}`;
  if (folders.has(key)) return folders.get(key)!;
  const qs = [`name='${name.replace(/'/g, "\\'")}'`, `mimeType='${FOLDER}'`, "trashed=false", parent ? `'${parent}' in parents` : ""]
    .filter(Boolean).join(" and ");
  const found = await drive(`/drive/v3/files?q=${encodeURIComponent(qs)}&fields=files(id)&pageSize=1`);
  let id = found.files?.[0]?.id;
  if (!id) {
    const made = await drive("/drive/v3/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
    });
    id = made.id;
  }
  folders.set(key, id);
  return id;
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function decode(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function uploadJpeg(bytes: Uint8Array, name: string, parent: string): Promise<string> {
  const boundary = "iy" + crypto.randomUUID();
  const meta = JSON.stringify({ name, parents: [parent], mimeType: "image/jpeg" });
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const f = await drive("/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  // Visible con el enlace: la app la muestra en el feed
  await drive(`/drive/v3/files/${f.id}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  return f.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const { action = "upload", member_id, image, thumb, ids } = await req.json();
    if (!member_id) return json({ error: "Falta member_id" }, 400);
    const { data: m, error } = await db.from("members").select("id, full_name, active").eq("id", member_id).maybeSingle();
    if (error) throw error;
    if (!m || !m.active) return json({ error: "Cliente no válido" }, 403);

    if (action === "delete") {
      // Solo borra archivos que pertenezcan a publicaciones de ese cliente
      const list = (ids || []).filter(Boolean);
      const { data: own } = await db.from("posts").select("drive_id, thumb_id").eq("member_id", member_id);
      const allowed = new Set((own || []).flatMap((p: any) => [p.drive_id, p.thumb_id]));
      for (const id of list) if (allowed.has(id)) await drive(`/drive/v3/files/${id}`, { method: "DELETE" }).catch(() => {});
      return json({ ok: true });
    }

    if (!image) return json({ error: "Falta la imagen" }, 400);
    const big = decode(image);
    const small = thumb ? decode(thumb) : null;
    if (big.length > MAX_BYTES || (small && small.length > MAX_BYTES)) return json({ error: "La imagen es demasiado grande" }, 413);

    const root = await folder(ROOT_NAME);
    const dir = await folder(`${slug(m.full_name) || "cliente"}-${m.id.slice(0, 8)}`, root);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const drive_id = await uploadJpeg(big, `${stamp}.jpg`, dir);
    const thumb_id = small ? await uploadJpeg(small, `${stamp}_mini.jpg`, dir) : null;
    return json({ drive_id, thumb_id });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
