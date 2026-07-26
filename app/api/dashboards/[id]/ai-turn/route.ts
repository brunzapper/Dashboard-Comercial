// Versão: 1.0 | Data: 26/07/2026
// Turno do painel "Editar com IA" com RACIOCÍNIO ao vivo. Server action não
// faz streaming, então o turno entra por aqui: POST /api/dashboards/<id>/ai-turn
// roda o MESMO runAiEditTurnCore (lib/ai/edit-session.ts — gate + linha da
// sessão idênticos ao caminho de action; nada de cópia paralela) e devolve
// NDJSON:
//   {"type":"thought","text":"…"}   ← trechos do raciocínio (efêmeros; só onde
//                                     o modelo já raciocina por padrão — Gemini)
//   {"type":"state", "state":{…}}   ← AiEditSessionState canônico, SEMPRE por
//                                     último (inclusive erros de gate)
// Auth pelos cookies do usuário (createClient/getSessionInfo dentro do gate);
// cookies Supabase são SameSite=Lax e ainda checamos origin==host (anti-CSRF —
// diferente das rotas /api/sync|ingest, que autenticam por segredo/bearer).
import { runAiEditTurnCore, gateError } from "@/lib/ai/edit-session";

export const dynamic = "force-dynamic";
// Teto da Home (page.tsx): o turno tem orçamento interno de 240s + aplicação.
export const maxDuration = 300;

const encoder = new TextEncoder();

function line(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj) + "\n");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Anti-CSRF: navegador manda `origin` em POST — precisa bater com o host da
  // própria app (server actions têm essa checagem embutida; rotas não).
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "origem inválida" }, { status: 403 });
  }

  let message = "";
  let autoApply = true;
  try {
    const body = (await request.json()) as {
      message?: unknown;
      autoApply?: unknown;
    };
    message = typeof body.message === "string" ? body.message : "";
    autoApply = body.autoApply !== false;
  } catch {
    // corpo inválido → cai no gateError abaixo (mensagem vazia)
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Cliente pode desconectar no meio: enqueue passa a lançar, mas o turno
      // continua até persistir a sessão (o F5 recarrega o estado do banco).
      const push = (obj: unknown) => {
        try {
          controller.enqueue(line(obj));
        } catch {
          /* stream fechado */
        }
      };
      try {
        const state = await runAiEditTurnCore(id, message, autoApply, (chunk) =>
          push({ type: "thought", text: chunk })
        );
        push({ type: "state", state });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push({ type: "state", state: gateError(`Falha no turno: ${msg}`) });
      } finally {
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Desativa buffering de proxy (nginx) — o raciocínio precisa fluir.
      "x-accel-buffering": "no",
    },
  });
}
