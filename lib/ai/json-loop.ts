// Versão: 1.0 | Data: 30/07/2026
// Laço de autocorreção GENÉRICO "IA → JSON validado" compartilhado pelos cores
// de registros/campos/mapeamento CSV (lib/ai/insert-records.ts,
// lib/ai/create-fields.ts, lib/ai/csv-mapping.ts). Mesmo shape do laço de
// generateDashboardCore (que segue com o dele — não regredir o fluxo de
// dashboards): até 3 tentativas dentro de um orçamento de turno; a cada falha
// de validação a resposta crua vira turno assistant + um turno de correção
// pt-BR com os erros; AiTruncatedError aborta na hora (retentar só queimaria
// tentativas com JSON truncado). O chamador entrega um `validate` que devolve
// o valor tipado — nada é aplicado aqui (a IA nunca escreve).
import "server-only";

import { getAiClient, AiTruncatedError, type AiMessage } from "@/lib/ai";
import type { OrgAiConfig } from "@/lib/ai/config";

export const AI_LOOP_MAX_ATTEMPTS = 3;
export const AI_LOOP_CALL_TIMEOUT_MS = 120_000; // por chamada ao provedor
export const AI_LOOP_TURN_BUDGET_MS = 240_000; // orçamento do turno (pages usam maxDuration=300)
export const AI_LOOP_MAX_PRIOR_TURNS = 10;

/** Separador de seção do system prompt (mesmo formato do core de dashboards). */
export function aiSection(title: string, body: string): string {
  return `\n\n============================================================\n# ${title}\n============================================================\n\n${body.trim()}\n`;
}

export type JsonLoopResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; errors?: string[] };

export async function runJsonGenerationLoop<T>(opts: {
  config: OrgAiConfig;
  system: string;
  /** Turnos de usuário anteriores (stateless; o chamador aplica o cap). */
  priorTurns: string[];
  /** Pedido deste turno. */
  description: string;
  /** Pode ser assíncrono (ex.: validação de fórmula consulta o catálogo). */
  validate: (
    raw: string
  ) =>
    | { ok: true; value: T }
    | { ok: false; errors: string[] }
    | Promise<{ ok: true; value: T } | { ok: false; errors: string[] }>;
  onThought?: (chunk: string) => void;
}): Promise<JsonLoopResult<T>> {
  const t0 = Date.now();
  const client = getAiClient(opts.config);
  const messages: AiMessage[] = [
    ...opts.priorTurns
      .slice(-AI_LOOP_MAX_PRIOR_TURNS)
      .map((t): AiMessage => ({ role: "user", content: t })),
    { role: "user", content: opts.description },
  ];

  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < AI_LOOP_MAX_ATTEMPTS; attempt++) {
    // Orçamento do turno: não inicia uma tentativa sem tempo hábil.
    if (
      attempt > 0 &&
      Date.now() - t0 > AI_LOOP_TURN_BUDGET_MS - AI_LOOP_CALL_TIMEOUT_MS
    ) {
      break;
    }

    let raw: string;
    try {
      raw = await client.generateText({
        system: opts.system,
        messages,
        signal: AbortSignal.timeout(AI_LOOP_CALL_TIMEOUT_MS),
        onThought: opts.onThought,
      });
    } catch (err) {
      if (err instanceof AiTruncatedError) {
        return { ok: false, message: err.message };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Falha ao chamar a IA (${opts.config.provider}): ${msg}`,
      };
    }

    const validation = await opts.validate(raw);
    if (validation.ok) return { ok: true, value: validation.value };

    lastErrors = validation.errors;
    // Turno de correção (interno à tentativa): JSON anterior + erros pt-BR.
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        "O validador do sistema apontou estes problemas no JSON. Corrija TODOS " +
        "e responda de novo com o JSON inteiro (apenas o bloco JSON, sem texto " +
        "fora dele):\n- " +
        lastErrors.join("\n- "),
    });
  }

  return {
    ok: false,
    message:
      "A IA não conseguiu gerar uma resposta válida após algumas tentativas. Reformule o pedido e tente de novo.",
    errors: lastErrors,
  };
}
