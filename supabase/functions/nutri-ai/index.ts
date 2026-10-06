// Supabase Edge Function: nutricionista IA con streaming en tiempo real.
// Despliegue:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy nutri-ai --no-verify-jwt
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `Eres "NutriCoach IA", nutricionista deportivo de un gimnasio. Respondes SIEMPRE en español,
con un tono cercano y profesional. Basas tus recomendaciones en guías reconocidas (OMS, ISSN, ACSM):
proteína 1.6–2.2 g/kg para fuerza/hipertrofia, 1.2–1.6 g/kg para resistencia; hidratación ~35 ml/kg más
lo perdido al entrenar; timing de carbohidratos alrededor del entrenamiento. Adapta las calorías al
objetivo (déficit 15–20% para perder grasa, superávit 5–10% para ganar masa). Si el cliente combina
varias modalidades en el mes, ajusta por días (días de fuerza vs. días de cardio/combate).
Usa alimentos accesibles en Latinoamérica. Formatea con títulos en Markdown (##), listas y tablas cortas.
No diagnostiques enfermedades; si hay notas médicas, recomienda consultar con un profesional.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile, question, history = [] } = await req.json();
    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

    const context = `Perfil del cliente (JSON): ${JSON.stringify(profile)}`;
    const messages = [
      ...history.slice(-8),
      { role: "user", content: `${context}\n\nSolicitud: ${question}` },
    ];

    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      system: SYSTEM,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    } as any);

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream as any) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          const final = await stream.finalMessage();
          if (final.stop_reason === "refusal") {
            controller.enqueue(encoder.encode("\n\n_No puedo responder a esa solicitud._"));
          }
        } catch (e) {
          controller.enqueue(encoder.encode(`\n\n[Error IA: ${(e as Error).message}]`));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(body, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
