// Versão: 1.0 | Data: 12/09/2026
// Turno da IA que PREENCHE um formulário do Workflow. Quarto caso da mesma
// família (dashboards, operação, Tree) e pelo mesmo motivo estrutural:
//
//   O Next despacha Server Actions UMA DE CADA VEZ por cliente ("Next.js
//   dispatches Server Actions one at a time per client… use a Route Handler for
//   non-mutation requests"). Um turno de IA dura até 240s, e como action ele
//   seguraria a fila do cliente inteira. Aqui as vítimas seriam as duas coisas
//   que a pessoa quer fazer justamente enquanto a IA lê o texto: ENVIAR o
//   formulário e atualizar o painel de lançamentos recentes — ambos actions.
//
// A rota roda o MESMO `fillWorkflowFormCore`: gate e validação seguem no
// núcleo, nada de cópia paralela. Devolve NDJSON:
//   {"type":"thought","text":"…"}  ← raciocínio (efêmero, nunca persistido)
//   {"type":"state","state":{…}}   ← o resultado, SEMPRE por último
//
// Diferente das três irmãs, este turno é SEM ESTADO: não há linha em tabela, a
// conversa vive no cliente e o resultado vai para as caixas do formulário. Não
// existe "aplicar" — quem lança é a pessoa, pelo `runWorkflow` (invariante 25).
import { fillWorkflowFormCore } from "@/lib/ai/fill-workflow-form";

export const dynamic = "force-dynamic";
// O turno tem orçamento interno de 240s.
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

  let schemaKey = "";
  let description = "";
  let priorTurns: string[] = [];
  let pendingJson: string | undefined;
  try {
    const body = (await request.json()) as {
      schemaKey?: unknown;
      description?: unknown;
      priorTurns?: unknown;
      pendingJson?: unknown;
    };
    schemaKey = typeof body.schemaKey === "string" ? body.schemaKey : "";
    description = typeof body.description === "string" ? body.description : "";
    priorTurns = Array.isArray(body.priorTurns)
      ? body.priorTurns.filter((t): t is string => typeof t === "string")
      : [];
    pendingJson =
      typeof body.pendingJson === "string" ? body.pendingJson : undefined;
  } catch {
    // corpo inválido → cai no estado de erro do núcleo (campos vazios)
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // O cliente pode desconectar no meio: `enqueue` passa a lançar, e aqui
      // não há o que preservar (o turno não grava nada) — só não derruba.
      const push = (obj: unknown) => {
        try {
          controller.enqueue(line(obj));
        } catch {
          /* stream fechado */
        }
      };
      try {
        const state = await fillWorkflowFormCore({
          schemaKey,
          description,
          priorTurns,
          pendingJson,
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
