// Versão: 1.0 | Data: 28/07/2026
// Reconciliação da alocação-como-campo (invariante 24): recomputa o quadro
// inteiro com runKanban (period null — mesma leitura das automações: fallback
// 1ª coluna, colunas ocultas e chaves órfãs resolvidos de graça), sincroniza
// as options do campo (precedente: options do pipeline reescritas pelo sync) e
// grava só os DIFFS via writeAllocationValues. `db` DEVE ser service client;
// escopo de org sai do dashboard dono (loadKanbanOwnerContext). Chamado por:
// backfill do enable (allocation-actions), saves de settings com colunas
// mudadas (dashboards/actions), hook pós-sync e tick por minuto — o tick é o
// catch-all p/ registros criados no app/CSV/Sheets, edições manuais do campo
// (revertidas: o campo é derivado) e dual-writes perdidos. Módulo separado de
// allocation-field.ts p/ evitar ciclo (automations/move.ts importa o
// allocation-field; este importa o engine de automações).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadKanbanOwnerContext,
  loadKanbanServiceContext,
} from "./automations/engine";
import { runKanban, type KanbanOwner } from "./data";
import {
  applyAllocationForSettings,
  buildAllocationOptions,
  planAllocationUpdates,
  writeAllocationValues,
} from "./allocation-field";
import type { KanbanSettings } from "./types";

/**
 * Dual-write pós-move quando o chamador só tem o DONO (drag/bulk/ação single):
 * resolve settings/org no servidor e delega ao applyAllocationForSettings.
 * No-op silencioso sem toggle/modo Personalizar. Nunca lança.
 */
export async function applyAllocationOnMoves(
  db: SupabaseClient,
  owner: KanbanOwner,
  moves: { recordId: string; targetKey: string }[]
): Promise<void> {
  if (moves.length === 0) return;
  try {
    const ctx = await loadKanbanOwnerContext(db, owner);
    if (typeof ctx === "string") return;
    if (!ctx.settings.allocationFieldKey) return;
    await applyAllocationForSettings(db, {
      settings: ctx.settings,
      orgId: ctx.orgId,
      moves,
    });
  } catch (e) {
    console.warn("[kanban-alocacao] dual-write pós-move falhou:", e);
  }
}

// Limpa a chave nos settings do dono (campo excluído em /campos —
// self-healing: o reconcile para de rodar em vez de falhar p/ sempre).
async function clearAllocationKey(
  db: SupabaseClient,
  owner: KanbanOwner
): Promise<void> {
  if (owner.kind === "widget") {
    const { data: w } = await db
      .from("widgets")
      .select("id, settings")
      .eq("id", owner.id)
      .maybeSingle();
    const settings = (w?.settings as { kanban?: KanbanSettings } | null) ?? null;
    if (!settings?.kanban?.allocationFieldKey) return;
    const { allocationFieldKey: _drop, ...kanban } = settings.kanban;
    await db
      .from("widgets")
      .update({ settings: { ...settings, kanban } })
      .eq("id", owner.id);
    return;
  }
  const { data: d } = await db
    .from("dashboards")
    .select("id, settings")
    .eq("id", owner.id)
    .maybeSingle();
  const settings = (d?.settings as { kanban?: KanbanSettings } | null) ?? null;
  if (!settings?.kanban?.allocationFieldKey) return;
  const { allocationFieldKey: _drop, ...kanban } = settings.kanban;
  await db
    .from("dashboards")
    .update({ settings: { ...settings, kanban } })
    .eq("id", owner.id);
}

/**
 * Reconciliação completa de UM quadro: campo ↔ quadro. Retorna o nº de
 * registros atualizados; `skipped` explica um quadro pulado (sem toggle, fora
 * do modo Personalizar, campo excluído…). Nunca lança.
 */
export async function reconcileKanbanAllocationField(
  db: SupabaseClient,
  owner: KanbanOwner,
  opts?: { deadline?: number }
): Promise<{ updated: number; skipped?: string }> {
  try {
    const ctx = await loadKanbanOwnerContext(db, owner);
    if (typeof ctx === "string") return { updated: 0, skipped: ctx };
    const { settings, orgId } = ctx;
    const fieldKey = settings.allocationFieldKey;
    if (!fieldKey) return { updated: 0, skipped: "Sem campo de alocação." };
    if (
      settings.mode !== "registros" ||
      settings.columnSource !== "custom" ||
      !settings.source
    ) {
      return { updated: 0, skipped: "Quadro fora do modo Personalizar." };
    }

    // Def do campo por (org, field_key): ausente = admin excluiu em /campos —
    // auto-desliga o vínculo (o campo é do catálogo; o quadro obedece).
    let defQuery = db
      .from("field_definitions")
      .select("id, options")
      .eq("field_key", fieldKey);
    if (orgId) defQuery = defQuery.eq("organization_id", orgId);
    const { data: defRow, error: defError } = await defQuery.maybeSingle();
    if (defError) return { updated: 0, skipped: defError.message };
    if (!defRow) {
      await clearAllocationKey(db, owner);
      return { updated: 0, skipped: "Campo excluído — vínculo desfeito." };
    }

    const { catalog, defs, available } = await loadKanbanServiceContext(
      db,
      orgId
    );
    const board = await runKanban(db, settings, null, defs, {}, owner, {
      available,
      catalog,
      orgId: orgId ?? undefined,
      // Só colunas/cards importam aqui — pula os fatos de métricas
      // (badges/conectados), como o tick de automações.
      lean: true,
    });

    // Options do campo = rótulos visíveis em ordem (só a coluna options — os
    // demais ajustes do admin em /campos são preservados).
    const options = buildAllocationOptions(settings);
    const current = Array.isArray(defRow.options) ? defRow.options : [];
    if (JSON.stringify(current) !== JSON.stringify(options)) {
      await db
        .from("field_definitions")
        .update({ options })
        .eq("id", defRow.id as string);
    }

    const updates = planAllocationUpdates(board, fieldKey);
    const updated = await writeAllocationValues(db, {
      fieldKey,
      orgId,
      updates,
      deadline: opts?.deadline,
    });
    return { updated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[kanban-alocacao] reconcile ${owner.kind}:${owner.id} falhou:`,
      msg
    );
    return { updated: 0, skipped: msg };
  }
}

/**
 * Reconcilia TODOS os quadros com o toggle ligado, até o deadline (ordem
 * estável por id). Quadros na Lixeira ficam de fora (arquivados seguem — a
 * página deles continua aberta). Ocioso = dois SELECTs baratos.
 */
export async function reconcileAllKanbanAllocationFields(
  db: SupabaseClient,
  deadline: number
): Promise<{ boards: number; updated: number }> {
  const owners: KanbanOwner[] = [];
  try {
    const [{ data: boards }, { data: widgets }] = await Promise.all([
      db
        .from("dashboards")
        .select("id")
        .eq("kind", "kanban")
        .neq("status", "trashed")
        .not("settings->kanban->>allocationFieldKey", "is", null)
        .order("id"),
      db
        .from("widgets")
        .select("id, dashboards!inner(status)")
        .eq("visual_type", "kanban")
        .neq("dashboards.status", "trashed")
        .not("settings->kanban->>allocationFieldKey", "is", null)
        .order("id"),
    ]);
    for (const b of boards ?? []) {
      owners.push({ kind: "board", id: b.id as string });
    }
    for (const w of widgets ?? []) {
      owners.push({ kind: "widget", id: w.id as string });
    }
  } catch (e) {
    console.warn("[kanban-alocacao] enumeração de quadros falhou:", e);
    return { boards: 0, updated: 0 };
  }

  let boards = 0;
  let updated = 0;
  for (const owner of owners) {
    if (Date.now() >= deadline) break;
    const res = await reconcileKanbanAllocationField(db, owner, { deadline });
    boards += 1;
    updated += res.updated;
  }
  return { boards, updated };
}
