// Versão: 1.0 | Data: 11/09/2026
// Turno da IA do comentário da Tree. Espelho de
// app/api/operacao/[scope]/ai-turn/route.ts e de
// app/api/dashboards/[id]/ai-turn/route.ts — o terceiro caso da MESMA família,
// e pelo mesmo motivo estrutural:
//
//   O Next despacha Server Actions UMA DE CADA VEZ por cliente (está na doc
//   desta versão: "Next.js dispatches Server Actions one at a time per client…
//   use a Route Handler for non-mutation requests"). Um turno de IA dura até
//   240s, e enquanto ele rodava como action TODA outra action ficava atrás
//   dele — inclusive `loadRecordTree`. O sintoma que isso produzia: clicar na
//   próxima linha da tabela durante uma análise deixava a Tree em "Carregando…"
//   até a IA terminar, que é exatamente o que o dock existe para evitar.
//
// A rota roda o MESMO `runCommentThreadCore` — gate, turnos e persistência
// seguem no núcleo, nada de cópia paralela. Devolve NDJSON:
//   {"type":"thought","text":"…"}  ← raciocínio (efêmero, nunca persistido)
//   {"type":"state","state":{…}}   ← o resultado, SEMPRE por último
//
// Só o TURNO saiu das actions. Abrir o fio, aplicar e descartar continuam
// Server Actions: são curtas, e as duas últimas são mutações — que é o caso em
// que a doc manda ficar na action mesmo.
import { runCommentThreadCore } from "@/lib/ai/analyze-comment";

export const dynamic = "force-dynamic";
// O turno tem orçamento interno de 240s + a gravação da linha.
export const maxDuration = 300;

const encoder = new TextEncoder();

function line(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj) + "\n");
}

export async function POST(request: Request) {
  // Anti-CSRF: Server Action tem essa checagem embutida, Route Handler não —
  // é a única proteção que se perde ao sair da action, então ela volta aqui.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "origem inválida" }, { status: 403 });
  }

  let threadId = "";
  let reply = "";
  try {
    const body = (await request.json()) as {
      threadId?: unknown;
      reply?: unknown;
    };
    threadId = typeof body.threadId === "string" ? body.threadId : "";
    reply = typeof body.reply === "string" ? body.reply : "";
  } catch {
    // corpo inválido → cai no estado de erro abaixo (threadId vazio)
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // O cliente pode desconectar no meio: `enqueue` passa a lançar, mas o
      // turno CONTINUA até persistir a linha — reabrir o dock recarrega o
      // estado real, então nada se perde por uma aba fechada.
      const push = (obj: unknown) => {
        try {
          controller.enqueue(line(obj));
        } catch {
          /* stream fechado */
        }
      };
      try {
        const state = await runCommentThreadCore({
          threadId,
          reply,
          onThought: (text) => push({ type: "thought", text }),
        });
        push({ type: "state", state });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        push({
          type: "state",
          state: { ok: false, message: `Falha no turno: ${msg}` },
        });
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
      // Desativa buffering de proxy (nginx) — sem isso o cano fica mudo e o
      // turno longo apanha do timeout de ociosidade.
      "x-accel-buffering": "no",
    },
  });
}
