// Versão: 1.0 | Data: 09/09/2026
// NOTIFICAÇÃO de falha na ação `run_schema`, pelo canal de TAREFAS — o sino de
// tarefas é a notificação in-app do produto (não existe tabela de notificações).
// Molde: lib/mappings/notify.ts, que já faz exatamente isso para as pendências
// do de-para.
//
// Por que existe: a decisão de produto é que uma execução falha NÃO se repete
// sozinha (uma entidade duplicada num sistema externo é sujeira que alguém
// limpa à mão). O preço disso é que uma falha silenciosa ficaria só no
// `last_error` da regra, que ninguém abre. Uma tarefa aberta em nome do
// org_admin é o que faz alguém olhar.
//
// UMA tarefa aberta por regra: falha nova ATUALIZA a descrição, nunca cria
// outra; rodada sem falha AUTO-COMPLETA a tarefa. Service role com org
// EXPLÍCITA, webhooks task.* à mão (o insert não passa pelas actions) e
// best-effort de ponta a ponta — falha de notificação nunca derruba a rodada.
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitWebhookEvent } from "@/lib/webhooks/emit";

/** Falhas de uma regra nesta rodada: id do registro → motivo. */
export interface SchemaRunFailures {
  ruleId: string;
  ruleName: string;
  failures: { recordId: string; message: string }[];
}

/** Título é a IDENTIDADE da tarefa aberta (é por ele que ela é reencontrada). */
export function schemaFailureTaskTitle(ruleName: string): string {
  return `Automação "${ruleName}": falha ao executar o esquema`;
}

export function schemaFailureTaskDescription(
  failures: { recordId: string; message: string }[]
): string {
  const linhas = failures
    .slice(0, 20)
    .map((f) => `• Registro ${f.recordId}: ${f.message}`);
  const resto =
    failures.length > 20 ? `\n… e mais ${failures.length - 20} registro(s).` : "";
  return [
    `${failures.length} registro(s) não puderam ser processados.`,
    "",
    ...linhas,
    resto,
    "",
    "A execução não se repete sozinha — o mesmo registro não é reenviado ao",
    "destino por conta própria. Depois de resolver a causa, use “Tentar de novo”",
    "na aba Execuções do Workflow para devolver o registro à fila.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

/** user_id do org_admin da org (organization_members.is_org_admin, 0089). */
async function orgAdminUserId(
  db: SupabaseClient,
  orgId: string
): Promise<string | null> {
  const { data } = await db
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("is_org_admin", true)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

/**
 * Sincroniza a tarefa de falha de UMA regra: com falhas cria/atualiza a tarefa
 * aberta; sem falhas completa a que existir. Nunca lança.
 */
export async function syncSchemaFailureTask(
  db: SupabaseClient,
  orgId: string,
  input: SchemaRunFailures
): Promise<void> {
  try {
    const title = schemaFailureTaskTitle(input.ruleName);
    const { data: existing } = await db
      .from("tasks")
      .select("id")
      .eq("organization_id", orgId)
      .eq("title", title)
      .is("completed_at", null)
      .maybeSingle();
    const openId = (existing?.id as string | undefined) ?? null;

    if (input.failures.length === 0) {
      if (openId) {
        await db
          .from("tasks")
          .update({ completed_at: new Date().toISOString() })
          .eq("id", openId);
        await emitWebhookEvent("task.updated", { taskId: openId }, orgId);
      }
      return;
    }

    const description = schemaFailureTaskDescription(input.failures);
    if (openId) {
      await db.from("tasks").update({ description }).eq("id", openId);
      await emitWebhookEvent("task.updated", { taskId: openId }, orgId);
      return;
    }

    const createdBy = await orgAdminUserId(db, orgId);
    const { data: inserted } = await db
      .from("tasks")
      .insert({
        organization_id: orgId,
        title,
        description,
        created_by: createdBy,
      })
      .select("id")
      .maybeSingle();
    const taskId = (inserted?.id as string | undefined) ?? null;
    if (taskId) {
      await emitWebhookEvent("task.created", { taskId }, orgId);
    }
  } catch {
    /* best-effort: notificar nunca derruba a rodada. */
  }
}
