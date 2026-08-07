// Versão: 1.0 | Data: 07/08/2026
// NOTIFICAÇÃO de valores não mapeados (de-para 0117) pelo canal de TAREFAS —
// o sino de tarefas é a notificação in-app do produto (não existe tabela de
// notificações). Mantém UMA tarefa aberta por domínio, criada em nome do
// org_admin da org (created_by = admin ⇒ só ele a vê no sino, decisão do
// usuário em 07/08/2026); pendência nova ATUALIZA a descrição da tarefa
// aberta (nunca cria duplicata); zero pendências AUTO-COMPLETA a tarefa.
// Insert/update cru com service role: org carimbada explicitamente e webhook
// task.created/task.updated emitido à mão (o insert não passa pelas actions).
// Best-effort de ponta a ponta — falha de notificação nunca derruba o job.
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { MAPPING_DOMAINS } from "./domains";
import { unmappedTaskDescription, unmappedTaskTitle } from "./messages";

/** Pendências por domínio: valor cru → nº de registros. */
export type UnmappedByDomain = Record<string, Map<string, number>>;

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
 * Sincroniza as tarefas de pendência dos domínios PROCESSADOS nesta rodada:
 * com pendências → cria/atualiza a tarefa aberta do domínio; sem pendências →
 * auto-completa a aberta (se houver). Domínios fora de `processedDomains`
 * ficam intocados (rodada parcial não fecha tarefa de domínio não checado).
 * Nunca lança.
 */
export async function syncUnmappedTasks(
  db: SupabaseClient,
  orgId: string,
  unmapped: UnmappedByDomain,
  processedDomains?: string[]
): Promise<void> {
  try {
    const domains = MAPPING_DOMAINS.filter(
      (d) => !processedDomains || processedDomains.includes(d.key)
    );
    if (domains.length === 0) return;
    const adminId = await orgAdminUserId(db, orgId);
    if (!adminId) return;
    const now = new Date().toISOString();

    for (const domain of domains) {
      const title = unmappedTaskTitle(domain.key);
      const { data: open } = await db
        .from("tasks")
        .select("id, description")
        .eq("organization_id", orgId)
        .eq("title", title)
        .is("completed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const tally = unmapped[domain.key];
      if (!tally || tally.size === 0) {
        // Sem pendências: fecha a tarefa aberta (se existir).
        if (open?.id) {
          await db
            .from("tasks")
            .update({ completed_at: now })
            .eq("id", open.id)
            .eq("organization_id", orgId);
          await emitWebhookEvent(
            "task.completed",
            { taskId: open.id as string, title },
            orgId
          );
        }
        continue;
      }

      const description = unmappedTaskDescription(domain.key, tally);
      if (open?.id) {
        if ((open.description as string | null) !== description) {
          await db
            .from("tasks")
            .update({ description })
            .eq("id", open.id)
            .eq("organization_id", orgId);
          await emitWebhookEvent(
            "task.updated",
            { taskId: open.id as string, title },
            orgId
          );
        }
        continue;
      }
      const { data: created, error } = await db
        .from("tasks")
        .insert({
          organization_id: orgId,
          title,
          description,
          phase: "a_fazer",
          created_by: adminId,
          is_global: false,
          position: -Date.now(),
        })
        .select("id")
        .single();
      if (!error && created?.id) {
        await emitWebhookEvent(
          "task.created",
          { taskId: created.id as string, title },
          orgId
        );
      }
    }
  } catch (e) {
    console.warn("[mappings] notificação de pendências falhou:", e);
  }
}
