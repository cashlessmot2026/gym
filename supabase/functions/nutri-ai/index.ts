// Supabase Edge Function: nutricionista IA con streaming en tiempo real.
// Proveedor (el primero que tenga clave configurada):
//   1. Google Gemini — plan GRATUITO. Clave en https://aistudio.google.com/apikey
//        supabase secrets set GEMINI_API_KEY=...        (opcional: GEMINI_MODEL=gemini-flash-latest)
//   2. Anthropic Claude (de pago)
//        supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Si no hay ninguna clave responde 503 y la app usa la IA gratuita sin clave o el motor local.
// Despliegue: supabase functions deploy nutri-ai --no-verify-jwt
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-provider",
};

const SYSTEM = `Eres "NutriCoach IA", nutricionista deportivo de un gimnasio en Colombia. Respondes SIEMPRE en español,
con un tono cercano y profesional. Basa tus recomendaciones en fuentes oficiales y consensos científicos:
- ISSN (International Society of Sports Nutrition) position stands: proteína 1.4–2.0 g/kg/día (hasta 2.3–3.1 g/kg en déficit para preservar masa magra), creatina 3–5 g/día, cafeína 3–6 mg/kg.
- ACSM / Academy of Nutrition and Dietetics / Dietitians of Canada (Nutrition and Athletic Performance): carbohidratos 3–5 g/kg (bajo volumen) a 6–10 g/kg (alto volumen); hidratación antes, durante y después.
- Consenso del COI (IOC) sobre suplementos y energía disponible (evitar RED-S).
- OMS: azúcares libres <10% de la energía, sal <5 g/día, ≥400 g de frutas y verduras.
- ICBF Colombia — Guías Alimentarias Basadas en Alimentos (GABA): usa alimentos y porciones locales (arepa, fríjol, lenteja, plátano, yuca, papa, huevo, pollo, pescado, frutas tropicales).
Adapta las calorías al objetivo (déficit 15–20% para perder grasa, superávit 5–10% para ganar masa). Si combina varias
modalidades en el mes, organiza por tipo de día (fuerza, cardio/combate, descanso). Formatea con títulos Markdown (##),
listas y tablas cortas. Al final incluye una línea "Fuentes:" con las guías usadas. No diagnostiques enfermedades; si hay
notas médicas, recomienda consultar a un profesional de la salud.`;

const enc = new TextEncoder();
const textStream = (gen: (push: (t: string) => void) => Promise<void>) =>
  new ReadableStream({
    async start(controller) {
      try { await gen((t) => controller.enqueue(enc.encode(t))); }
      catch (e) { controller.enqueue(enc.encode(`\n\n[Error IA: ${(e as Error).message}]`)); }
      finally { controller.close(); }
    },
  });

/** Gemini (gratis) por REST con streaming SSE. */
function gemini(key: string, system: string, messages: { role: string; content: string }[]) {
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";
  return textStream(async (push) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.6, maxOutputTokens: 8192 },
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5));
          const t = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
          if (t) push(t);
        } catch { /* línea parcial */ }
      }
    }
  });
}

/** Claude (de pago) con el SDK oficial y streaming. */
function claude(key: string, system: string, messages: { role: string; content: string }[]) {
  const client = new Anthropic({ apiKey: key });
  return textStream(async (push) => {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      system,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: messages as any,
    } as any);
    for await (const event of stream as any) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") push(event.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") push("\n\n_No puedo responder a esa solicitud._");
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile, question, history = [], updates = [] } = await req.json();
    const extra = updates.length
      ? `\n\nPublicaciones científicas recientes (PubMed) que puedes considerar:\n${updates.slice(0, 6).map((u: any) => `- ${u.title} (${u.source}, ${u.date})`).join("\n")}`
      : "";
    const messages = [
      ...history.slice(-8),
      { role: "user", content: `Perfil del cliente (JSON): ${JSON.stringify(profile)}\n\nSolicitud: ${question}` },
    ];
    const g = Deno.env.get("GEMINI_API_KEY");
    const a = Deno.env.get("ANTHROPIC_API_KEY");
    if (!g && !a) return new Response(JSON.stringify({ error: "no_provider" }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
    const body = g ? gemini(g, SYSTEM + extra, messages) : claude(a!, SYSTEM + extra, messages);
    return new Response(body, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "x-provider": g ? "gemini" : "claude" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
