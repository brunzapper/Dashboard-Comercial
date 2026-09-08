// Versão: 1.0 | Data: 07/08/2026
// Server Actions da LIXEIRA de registros (soft delete 0121, retenção 30 dias).
// Contrato por item ({ id, ok, message } — lib/kanban/bulk-helpers, importado
// de LÁ pela regra do Turbopack), teto de 200 por chamada, client RLS do
// usuário, SEM revalidatePath (chamadores atualizam via refresh debounced +
// emitDataChanged). Gate de ADMIN nas três actions (espelha a records_delete;
// o trigger enforce_records_trash_guard é a muralha no banco) — para relaxar
// a editores no futuro, mude assertTrashGate E o trigger juntos.
// Enviar à lixeira AUDITA (campo deleted_at, origin 'app' — melhoria sobre o
// hard delete antigo, que não auditava) e emite record.deleted (integrações
// veem o registro sumir); restaurar audita e emite record.restored; a
// exclusão definitiva não emite nada (o deleted já saiu no trash) e só
// alcança linhas JÁ na lixeira (predicado .not("deleted_at","is",null) —
// padrão deleteBoardPermanently: registro ativo nunca é hard-deleted aqui).
// Mocks são pulados por item (congelados, 0051); id já na lixeira/já ativo é
// sucesso idempotente sem efeito colateral.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import {
  BULK_MAX_ITEMS,
  chunk,
  fanOut,
  resultsFromReturned,
  type BulkActionState,
  type BulkItemResult,
} from "@/lib/kanban/bulk-helpers";

const CHUNK = 200;

// Gate único das três actions — o ÚNICO lugar (junto com o trigger 0121) a
// mudar se a lixeira abrir para editores um dia.
function trashGateError(roles: string[]): string | null {
  return roles.includes("admin")
    ? null
    : "Só administradores podem excluir ou restaurar registros.";
}

function dedupe(recordIds: string[]): string[] {
  return [...new Set(recordIds)].filter(Boolean);
}

interface ScanRow {
  id: string;
  is_mock: boolean | null;
  deleted_at: string | null;
}

async function scanRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<Map<string, ScanRow> | string> {
  const byId = new Map<string, ScanRow>();
  for (const slice of chunk(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("records")
      .select("id, is_mock, deleted_at")
      .in("id", slice);
    if (error) return error.message;
    for (const r of (data ?? []) as ScanRow[]) byId.set(r.id, r);
  }
  return byId;
}

/** Envia registros à Lixeira (soft delete — restaurável por 30 dias). */
export async function trashRecordsBulk(
  recordIds: string[]
): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const gateError = trashGateError(session.roles);
  if (gateError) return { ok: false, message: gateError };
  const ids = dedupe(recordIds);
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} por chamada.` };
  }
  const supabase = await createClient();
  const scanned = await scanRows(supabase, ids);
  if (typeof scanned === "string") return { ok: false, message: scanned };

  const results: BulkItemResult[] = [];
  const targets: string[] = [];
  for (const id of ids) {
    const row = scanned.get(id);
    if (!row) {
      results.push({ id, ok: false, message: "Registro não encontrado." });
    } else if (row.is_mock) {
      results.push({
        id,
        ok: false,
        message: "Registro de demonstração (congelado).",
      });
    } else if (row.deleted_at) {
      results.push({ id, ok: true, message: "Já está na Lixeira." });
    } else {
      targets.push(id);
    }
  }

  const now = new Date().toISOString();
  const trashed: string[] = [];
  for (const slice of chunk(targets, CHUNK)) {
    const { data, error } = await supabase
      .from("records")
      .update({ deleted_at: now, deleted_by: session.user.id })
      .in("id", slice)
      .is("deleted_at", null)
      .select("id");
    if (error) {
      results.push(...fanOut(slice, false, error.message));
      continue;
    }
    for (const r of data ?? []) trashed.push(r.id as string);
    results.push(
      ...resultsFromReturned(
        slice,
        (data ?? []).map((r) => r.id as string),
        "Sem permissão para excluir."
      )
    );
  }

  if (trashed.length > 0) {
    // Auditoria best-effort (a escrita já persistiu).
    await supabase.from("audit_log").insert(
      trashed.map((id) => ({
        record_id: id,
        user_id: session.user.id,
        field: "deleted_at",
        old_value: null,
        new_value: now,
        origin: "app" as const,
      }))
    );
    const orgId = await getActiveOrgId();
    for (const recordId of trashed) {
      await emitWebhookEvent("record.deleted", { recordId }, orgId);
    }
  }
  return { ok: true, results };
}

/** Restaura registros da Lixeira (limpa deleted_at/deleted_by). */
export async function restoreRecordsBulk(
  recordIds: string[]
): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const gateError = trashGateError(session.roles);
  if (gateError) return { ok: false, message: gateError };
  const ids = dedupe(recordIds);
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} por chamada.` };
  }
  const supabase = await createClient();
  const scanned = await scanRows(supabase, ids);
  if (typeof scanned === "string") return { ok: false, message: scanned };

  const results: BulkItemResult[] = [];
  const targets: string[] = [];
  const oldByid = new Map<string, string>();
  for (const id of ids) {
    const row = scanned.get(id);
    if (!row) {
      results.push({ id, ok: false, message: "Registro não encontrado." });
    } else if (!row.deleted_at) {
      results.push({ id, ok: true, message: "Já está ativo." });
    } else {
      targets.push(id);
      oldByid.set(id, row.deleted_at);
    }
  }

  const restored: string[] = [];
  for (const slice of chunk(targets, CHUNK)) {
    const { data, error } = await supabase
      .from("records")
      .update({ deleted_at: null, deleted_by: null })
      .in("id", slice)
      .not("deleted_at", "is", null)
      .select("id");
    if (error) {
      results.push(...fanOut(slice, false, error.message));
      continue;
    }
    for (const r of data ?? []) restored.push(r.id as string);
    results.push(
      ...resultsFromReturned(
        slice,
        (data ?? []).map((r) => r.id as string),
        "Sem permissão para restaurar."
      )
    );
  }

  if (restored.length > 0) {
    await supabase.from("audit_log").insert(
      restored.map((id) => ({
        record_id: id,
        user_id: session.user.id,
        field: "deleted_at",
        old_value: oldByid.get(id) ?? null,
        new_value: null,
        origin: "app" as const,
      }))
    );
    const orgId = await getActiveOrgId();
    for (const recordId of restored) {
      await emitWebhookEvent("record.restored", { recordId }, orgId);
    }
  }
  return { ok: true, results };
}

/**
 * Exclui DEFINITIVAMENTE registros que já estão na Lixeira (cascade leva
 * audit/tarefas/comentários/posicionamentos/conexões). Registro ativo nunca é
 * alcançado (predicado deleted_at not null). Sem webhook — o record.deleted
 * já saiu quando o registro foi à Lixeira.
 */
export async function purgeRecordsPermanently(
  recordIds: string[]
): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const gateError = trashGateError(session.roles);
  if (gateError) return { ok: false, message: gateError };
  const ids = dedupe(recordIds);
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} por chamada.` };
  }
  const supabase = await createClient();
  const results: BulkItemResult[] = [];
  for (const slice of chunk(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("records")
      .delete()
      .in("id", slice)
      .not("deleted_at", "is", null)
      .select("id");
    if (error) {
      results.push(...fanOut(slice, false, error.message));
      continue;
    }
    results.push(
      ...resultsFromReturned(
        slice,
        (data ?? []).map((r) => r.id as string),
        "Só registros na Lixeira podem ser excluídos definitivamente."
      )
    );
  }
  return { ok: true, results };
}
