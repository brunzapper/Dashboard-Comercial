// Versão: 1.0 | Data: 17/09/2026
// Turno da IA da BASE MANUAL (0142). Quarto caso da MESMA família das rotas de
// `app/api/dashboards/[id]/ai-turn`, `app/api/operacao/[scope]/ai-turn` e
// `app/api/tree/ai-turn` — e pelo mesmo motivo estrutural:
//
//   O Next despacha Server Actions UMA DE CADA VEZ por cliente. Um turno de IA
//   dura até 240s, e como action ele seguraria a fila do cliente inteira —
//   aqui a vítima seria justamente o que a pessoa está fazendo enquanto espera:
//   salvar uma célula da grade, e o refetch dos widgets que vem atrás.
//
// A rota roda o MESMO `runManualBaseTurnCore`: gate, turnos e persistência
// ficam no núcleo, nunca duplicados aqui. Devolve NDJSON:
//   {"type":"thought","text":"…"}  ← raciocínio (efêmero, nunca persistido)
//   {"type":"state","state":{…}}   ← o resultado, SEMPRE por último
//
// Só o TURNO saiu das actions. Abrir o fio, aplicar, colar JSON e descartar
// continuam Server Actions: são curtas, e as mutações é onde a doc manda ficar.
import { runManualBaseTurnCore } from "@/lib/ai/manual-base";

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

  let description = "";
  try {
    const body = (await request.json()) as { description?: unknown };
    description = typeof body.description === "string" ? body.description : "";
  } catch {
    // corpo inválido → cai no estado de erro do núcleo (descrição vazia)
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // O cliente pode desconectar no meio: `enqueue` passa a lançar, mas o
      // turno CONTINUA até persistir a linha — reabrir o painel recarrega o
      // estado real, então nada se perde por uma aba fechada.
      const push = (obj: unknown) => {
        try {
          controller.enqueue(line(obj));
        } catch {
          /* stream fechado */
        }
      };
      try {
        const state = await runManualBaseTurnCore({
          description,
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
