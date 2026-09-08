// Versão: 1.0 | Data: 07/09/2026
// Turno do painel de IA da Operação. Espelho de
// app/api/dashboards/[id]/ai-turn/route.ts: server action não faz streaming,
// então o turno entra por aqui e roda o MESMO runOperacaoAiTurnCore (gate +
// linha da sessão idênticos ao caminho de action — nada de cópia paralela),
// devolvendo NDJSON:
//   {"type":"thought","text":"…"}   ← raciocínio (efêmero; hoje só o Gemini o
//                                     emite, e os cores da Operação ainda não
//                                     encadeiam o onThought — a rota já está
//                                     pronta para quando encadearem)
//   {"type":"state", "state":{…}}   ← OperacaoAiState canônico, SEMPRE por
//                                     último (inclusive em erro de gate)
// O sub-alvo viaja no CORPO (a rota é [scope], não [scope]/[target]).
// Auth pelos cookies do usuário (dentro do gate) + origin == host (anti-CSRF:
// server actions têm essa checagem embutida; rotas não).
import { gateError, runOperacaoAiTurnCore } from "@/lib/ai/operacao/session";

export const dynamic = "force-dynamic";
// O turno tem orçamento interno de 240s + a aplicação.
export const maxDuration = 300;

const encoder = new TextEncoder();

function line(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj) + "\n");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ scope: string }> }
) {
  const { scope } = await params;

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "origem inválida" }, { status: 403 });
  }

  let message = "";
  let target = "";
  try {
    const body = (await request.json()) as {
      message?: unknown;
      target?: unknown;
    };
    message = typeof body.message === "string" ? body.message : "";
    target = typeof body.target === "string" ? body.target : "";
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
        push({ type: "state", state: await runOperacaoAiTurnCore(scope, target, message) });
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
      // Desativa buffering de proxy (nginx).
      "x-accel-buffering": "no",
    },
  });
}
