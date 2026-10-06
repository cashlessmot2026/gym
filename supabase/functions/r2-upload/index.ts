// Supabase Edge Function: guarda las fotos de la comunidad en Cloudflare R2.
//   bucket / <nombre-cliente-xxxxxxxx> / <fecha>.jpg  (+ <fecha>_mini.jpg)
//
// R2 es compatible con la API S3. No tiene costo por tráfico de salida.
//
// Secretos necesarios (Dashboard → Edge Functions → Secrets):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// Despliegue:
//   supabase functions deploy r2-upload --no-verify-jwt
//
// Acciones (POST JSON) — misma forma que drive-upload:
//   { action: "upload", member_id, image: <base64 jpeg>, thumb?: <base64 jpeg> } → { drive_id, thumb_id }
//   { action: "delete", member_id, ids: [drive_id, thumb_id] }                     → { ok: true }
// Los ids devueltos llevan el prefijo "r2:" (r2:<ruta del objeto>) para distinguirlos de los de Drive.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MAX_BYTES = 4 * 1024 * 1024;
const PREFIX = "r2:";

// ---------- Firma AWS SigV4 (sin dependencias externas) ----------
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (d: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", typeof d === "string" ? enc.encode(d) : d));
async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

/** Petición firmada a R2 (API S3, región "auto"). `now` solo se usa en pruebas. */
async function r2Fetch(method: "PUT" | "DELETE", path: string, body?: Uint8Array, now = new Date()) {
  const account = Deno.env.get("R2_ACCOUNT_ID"), keyId = Deno.env.get("R2_ACCESS_KEY_ID"),
    secret = Deno.env.get("R2_SECRET_ACCESS_KEY"), bucket = Deno.env.get("R2_BUCKET");
  if (!account || !keyId || !secret || !bucket) throw new Error("Faltan los secretos R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET");
  const host = `${account}.r2.cloudflarestorage.com`;
  const uri = "/" + [bucket, ...path.split("/")].map((x) => encodeURIComponent(x)).join("/");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20261006T120000Z
  const day = amzDate.slice(0, 8);
  const payloadHash = await sha256(body ?? "");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const NL = String.fromCharCode(10);
  const canonical = [method, uri, "", `host:${host}${NL}x-amz-content-sha256:${payloadHash}${NL}x-amz-date:${amzDate}${NL}`, signedHeaders, payloadHash].join(NL);
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(canonical)].join(NL);
  let k: ArrayBuffer = await hmac(enc.encode("AWS4" + secret), day);
  for (const part of ["auto", "s3", "aws4_request"]) k = await hmac(k, part);
  const signature = hex(await hmac(k, toSign));
  const headers: Record<string, string> = {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (method === "PUT") {
    headers["Content-Type"] = "image/jpeg";
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  return fetch(`https://${host}${uri}`, { method, headers, body });
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function decode(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]+,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function put(path: string, bytes: Uint8Array) {
  const r = await r2Fetch("PUT", path, bytes);
  if (!r.ok) throw new Error(`R2: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return PREFIX + path;
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
      // Solo borra objetos que pertenezcan a publicaciones de ese cliente
      const list = (ids || []).filter((x: string) => typeof x === "string" && x.startsWith(PREFIX));
      const { data: own } = await db.from("posts").select("drive_id, thumb_id").eq("member_id", member_id);
      const allowed = new Set((own || []).flatMap((p: any) => [p.drive_id, p.thumb_id]));
      for (const id of list) {
        if (!allowed.has(id)) continue;
        await r2Fetch("DELETE", id.slice(PREFIX.length)).catch(() => {});
      }
      return json({ ok: true });
    }

    if (!image) return json({ error: "Falta la imagen" }, 400);
    const big = decode(image);
    const small = thumb ? decode(thumb) : null;
    if (big.length > MAX_BYTES || (small && small.length > MAX_BYTES)) return json({ error: "La imagen es demasiado grande" }, 413);

    const dir = `${slug(m.full_name) || "cliente"}-${m.id.slice(0, 8)}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const drive_id = await put(`${dir}/${stamp}.jpg`, big);
    const thumb_id = small ? await put(`${dir}/${stamp}_mini.jpg`, small) : null;
    return json({ drive_id, thumb_id });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
