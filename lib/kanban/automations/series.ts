// Versão: 1.0 | Data: 09/09/2026
// Executor da ação `create_task_series` (0132): cria a cobrança devida hoje e
// concede o atributo a quem entrou na série.
//
// Irmão de `task.ts`, com uma diferença que é o desenho inteiro: lá a trava é
// "uma tarefa ABERTA por regra × registro" (a regra só cobra de novo depois que
// a anterior é concluída); aqui é uma tarefa por OCORRÊNCIA, e a 3ª quinzena
// vence tenha ou não a 2ª sido feita. É ver as duas em aberto lado a lado que
// mostra como o vendedor está conduzindo o lead.
//
// A escrita NÃO usa `createTask` (action `(prevState, formData)` que depende de
// `getSessionInfo()`, inexistente num tick): reusa o padrão de
// `lib/mappings/notify.ts` — service role, org EXPLÍCITA, webhook
// `task.created` à mão. Autoria = quem salvou a regra; execução = autoridade de
// sistema; responsável = o DO REGISTRO.
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitWebhookEvent } from "@/lib/webhooks/emit";

import type { PlannedSeriesTask } from "./evaluate";

export interface SeriesBatch {
  series: PlannedSeriesTask[];
  orgId: string | null;
  /** Autoria no histórico: quem salvou a regra. */
  createdBy: string | null;
}

export interface SeriesOutcome {
  okIds: string[];
  /** Ocorrências que a trava do banco já tinha — nem sucesso, nem falha. */
  skipped: number;
  createdByRule: Map<string, number>;
  failed: { recordId: string; message: string }[];
}

/** Violação do índice único parcial (23505) = a ocorrência já existe. */
function isDuplicate(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "23505" || /duplicate key|already exists/i.test(err.message ?? "")
  );
}

export async function executeAutomationSeries(
  db: SupabaseClient,
  batch: SeriesBatch
): Promise<SeriesOutcome> {
  const okIds: string[] = [];
  const createdByRule = new Map<string, number>();
  const failed: SeriesOutcome["failed"] = [];
  let skipped = 0;
  if (batch.series.length === 0) {
    return { okIds, skipped, createdByRule, failed };
  }

  for (const plan of batch.series) {
    const row: Record<string, unknown> = {
      title: plan.title,
      description: plan.description,
      record_id: plan.recordId,
      due_date: plan.dueDate,
      responsible_id: plan.responsibleId,
      created_by: batch.createdBy,
      automation_rule_id: plan.ruleId,
      series_key: plan.seriesKey,
      series_occurrence: plan.occurrence,
    };
    if (batch.orgId) row.organization_id = batch.orgId;

    const { data, error } = await db
      .from("tasks")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      // A corrida entre o tick e o "Executar agora" bate aqui. É o resultado
      // desejado — poluir o last_error com "duplicate key" esconderia os erros
      // de verdade (precedente literal do create_task na 0129).
      if (isDuplicate(error)) {
        skipped += 1;
        continue;
      }
      failed.push({ recordId: plan.recordId, message: error.message });
      continue;
    }

    okIds.push(plan.recordId);
    createdByRule.set(plan.ruleId, (createdByRule.get(plan.ruleId) ?? 0) + 1);

    const taskId = (data?.id as string | undefined) ?? null;
    if (taskId) {
      await emitWebhookEvent(
        "task.created",
        { taskId, recordId: plan.recordId, seriesKey: plan.seriesKey },
        batch.orgId
      );
    }

    // O atributo entra JUNTO com a primeira cobrança — é o que faz a linha da
    // tabela virar clicável e a Tree existir. Ensure-if-absent: conceder de
    // novo nunca reativa um atributo que alguém pausou de propósito.
    if (plan.grantAttribute && batch.orgId) {
      await db.from("record_attributes").upsert(
        {
          organization_id: batch.orgId,
          record_id: plan.recordId,
          attribute_key: plan.grantAttribute,
          granted_by_rule_id: plan.ruleId,
          created_by: batch.createdBy,
        },
        { onConflict: "record_id,attribute_key", ignoreDuplicates: true }
      );
    }
  }

  return { okIds, skipped, createdByRule, failed };
}

/**
 * Ocorrências de série JÁ criadas para estes registros, como
 * "<ruleId>:<occurrence>" — o fato que evita a ida ao banco de uma cobrança
 * que já existe. A trava de verdade continua sendo o índice único da 0132.
 */
export async function loadSeriesOccurrences(
  db: SupabaseClient,
  orgId: string | null,
  ruleIds: string[],
  recordIds: string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ruleIds.length === 0 || recordIds.length === 0) return out;

  const CHUNK = 200;
  for (let i = 0; i < recordIds.length; i += CHUNK) {
    let q = db
      .from("tasks")
      .select("record_id, automation_rule_id, series_occurrence")
      .in("automation_rule_id", ruleIds)
      .in("record_id", recordIds.slice(i, i + CHUNK))
      .not("series_occurrence", "is", null);
    if (orgId) q = q.eq("organization_id", orgId);
    const { data } = await q;
    for (const t of data ?? []) {
      const recordId = t.record_id as string;
      const key = `${t.automation_rule_id as string}:${t.series_occurrence as number}`;
      const list = out.get(recordId);
      if (list) list.push(key);
      else out.set(recordId, [key]);
    }
  }
  return out;
}
