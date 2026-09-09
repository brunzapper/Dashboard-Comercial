// Versão: 1.0 | Data: 08/09/2026
// Executor da ação `create_task`: abre uma tarefa vinculada ao registro.
//
// Não usa `createTask` (`lib/tasks/actions.ts`) de propósito — aquela é uma
// server action `(prevState, formData)` que depende de `getSessionInfo()`, e
// num tick não há sessão. Reusa o padrão de `lib/mappings/notify.ts`, a outra
// rotina que já cria tarefa sem usuário: service role, org EXPLÍCITA e webhook
// emitido à mão (o insert não passa pelas actions).
//
// A idempotência tem duas camadas, de propósito:
//  1. o avaliador pula registro que já tem tarefa aberta desta regra (evita a
//     ida ao banco);
//  2. o índice único parcial da 0129 é a trava de verdade — uma corrida entre
//     o tick agendado e um "Executar agora" esbarra nele em vez de duplicar, e
//     o erro é tratado aqui como no-op, não como falha.
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitWebhookEvent } from "@/lib/webhooks/emit";

import type { PlannedTask } from "./evaluate";

export interface TaskCreateResult {
  okIds: string[];
  failed: { recordId: string; message: string }[];
  createdByRule: Map<string, number>;
}

/** Violação do índice único parcial (23505) = a tarefa já existe. */
function isDuplicate(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "23505" || /duplicate key|already exists/i.test(err.message ?? "");
}

export async function executeAutomationTasks(
  db: SupabaseClient,
  batch: {
    tasks: PlannedTask[];
    orgId: string | null;
    /** Autor das tarefas: quem salvou a regra (execução é de sistema). */
    createdBy: string | null;
  }
): Promise<TaskCreateResult> {
  const okIds: string[] = [];
  const failed: TaskCreateResult["failed"] = [];
  const createdByRule = new Map<string, number>();
  if (batch.tasks.length === 0) return { okIds, failed, createdByRule };

  for (const t of batch.tasks) {
    const { data, error } = await db
      .from("tasks")
      .insert({
        ...(batch.orgId ? { organization_id: batch.orgId } : {}),
        title: t.title,
        description: t.description,
        record_id: t.recordId,
        responsible_id: t.responsibleId,
        due_date: t.dueDate,
        phase: "a_fazer",
        automation_rule_id: t.ruleId,
        created_by: batch.createdBy,
        // Topo da fila, como o notify do de-para: tarefa de automação é
        // cobrança, e cobrança no fim da lista não é vista.
        position: -Date.now(),
      })
      .select("id")
      .single();

    if (error) {
      // Corrida com outra rodada: a tarefa já está aberta. É o resultado
      // desejado, não uma falha — não polui o last_error da regra.
      if (isDuplicate(error)) continue;
      failed.push({ recordId: t.recordId, message: error.message });
      continue;
    }
    const id = data?.id as string | undefined;
    if (!id) continue;
    okIds.push(id);
    createdByRule.set(t.ruleId, (createdByRule.get(t.ruleId) ?? 0) + 1);
    await emitWebhookEvent(
      "task.created",
      { taskId: id, title: t.title },
      batch.orgId
    );
  }

  return { okIds, failed, createdByRule };
}

/**
 * Regras que JÁ têm tarefa aberta por registro — o fato que o avaliador usa
 * para não recriar. Uma consulta por rodada, só quando alguma regra ativa
 * cria tarefa.
 */
export async function loadOpenAutomationTasks(
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
      .select("record_id, automation_rule_id")
      .is("completed_at", null)
      .in("automation_rule_id", ruleIds)
      .in("record_id", recordIds.slice(i, i + CHUNK));
    if (orgId) q = q.eq("organization_id", orgId);
    const { data } = await q;
    for (const row of data ?? []) {
      const rec = row.record_id as string;
      const rule = row.automation_rule_id as string;
      const list = out.get(rec) ?? [];
      if (!list.includes(rule)) list.push(rule);
      out.set(rec, list);
    }
  }
  return out;
}
