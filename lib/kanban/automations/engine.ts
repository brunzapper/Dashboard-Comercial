// Versão: 1.0 | Data: 27/07/2026
// Engine I/O das automações do kanban: carrega o quadro do DONO (widget ou
// board dedicado) com SERVICE ROLE e escopo EXPLÍCITO de org (invariante
// 0089+), monta os CardFacts que as regras ativas pedem (gates — nada de
// consulta desnecessária), decide via avaliador puro (evaluate.ts) e executa
// via move.ts, com teto de movimentos por rodada e deadline cooperativo (tick
// com orçamento). Reusa runKanban inteiro (resolução de colunas, placements,
// canonicalização de responsáveis, __match) — RPCs de widget INTOCADOS.
// Quadros fora do escopo v1 (modo tarefas, bucket de data — mover reescreveria
// uma DATA real relativa a "hoje" a cada tick, não idempotente) falham ALTO
// (fatal na rodada, visível no last_error), nunca em silêncio.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition } from "@/lib/records/types";
import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import { buildAvailableFields } from "@/lib/widgets/fields";
import type { DashboardSettings } from "@/lib/widgets/types";
import { todayBrasiliaIso } from "@/lib/date/today";
import { runKanban } from "../data";
import type { KanbanSettings } from "../types";
import {
  decideMoves,
  type CardFacts,
  type EvalContext,
  type RuleError,
} from "./evaluate";
import { countRelatedBySource } from "./related-count";
import { executeAutomationMoves } from "./move";
import {
  parseAutomationRule,
  relatedCountKey,
  type AutomationOwner,
  type AutomationRow,
} from "./types";

export interface AutomationRunSummary {
  moved: number;
  evaluated: number;
  ruleErrors: RuleError[];
  // Rodada não avaliou (config fora do escopo, dono sumido, deadline…).
  fatal?: string;
}

/** Teto de movimentos por quadro por rodada (o resto fica p/ o próximo tick —
 *  mantém webhooks/write-backs e o orçamento do tick limitados). */
export const MAX_MOVES_PER_RUN = 200;

const CHUNK = 200;

const FIELD_DEF_COLS =
  "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back";

function chunksOf(list: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/**
 * Roda as automações de TODOS os quadros com regra habilitada, dentro do
 * deadline — donos mais "antigos" (min last_run_at) primeiro (round-robin
 * justo: um quadro nunca esfomeia os demais). Compartilhado pelo tick do
 * pg_cron e pelo hook pós-sync. Ocioso = um único SELECT indexado.
 */
export async function runAllKanbanAutomations(
  db: SupabaseClient,
  deadline: number
): Promise<{ boards: number; moved: number; evaluated: number; errors: number }> {
  const { data } = await db
    .from("kanban_automations")
    .select("widget_id, board_id, last_run_at")
    .eq("enabled", true);
  const byOwner = new Map<string, { owner: AutomationOwner; oldest: number }>();
  for (const r of data ?? []) {
    const owner: AutomationOwner = r.widget_id
      ? { kind: "widget", id: r.widget_id as string }
      : { kind: "board", id: r.board_id as string };
    if (!owner.id) continue;
    const key = `${owner.kind}:${owner.id}`;
    const t = r.last_run_at ? Date.parse(r.last_run_at as string) : 0;
    const cur = byOwner.get(key);
    if (!cur) byOwner.set(key, { owner, oldest: t });
    else cur.oldest = Math.min(cur.oldest, t);
  }
  const owners = [...byOwner.values()].sort((a, b) => a.oldest - b.oldest);

  let boards = 0;
  let moved = 0;
  let evaluated = 0;
  let errors = 0;
  for (const { owner } of owners) {
    if (Date.now() >= deadline) break;
    try {
      const summary = await runBoardAutomations(db, owner, { deadline });
      boards += 1;
      moved += summary.moved;
      evaluated += summary.evaluated;
      if (summary.fatal || summary.ruleErrors.length > 0) errors += 1;
    } catch (e) {
      errors += 1;
      console.error(
        `[kanban-automations] quadro ${owner.kind}:${owner.id} falhou:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  return { boards, moved, evaluated, errors };
}

export interface KanbanOwnerContext {
  settings: KanbanSettings;
  orgId: string | null;
}

// Resolve settings.kanban + org do dono. String = erro fatal (PT-BR).
// Exportado: o reconcile da alocação-como-campo (allocation-reconcile.ts)
// resolve o dono pelo MESMO caminho (service role, sem visibilidade por papel).
export async function loadKanbanOwnerContext(
  db: SupabaseClient,
  owner: AutomationOwner
): Promise<KanbanOwnerContext | string> {
  if (owner.kind === "widget") {
    const { data: w } = await db
      .from("widgets")
      .select("id, dashboard_id, settings")
      .eq("id", owner.id)
      .maybeSingle();
    if (!w) return "Widget não encontrado.";
    const kanban = (w.settings as { kanban?: KanbanSettings } | null)?.kanban;
    if (!kanban) return "Widget sem configuração de kanban.";
    const { data: d } = await db
      .from("dashboards")
      .select("id, organization_id, status")
      .eq("id", w.dashboard_id as string)
      .maybeSingle();
    if (!d || d.status === "trashed") return "Dashboard do widget indisponível.";
    return { settings: kanban, orgId: (d.organization_id as string) ?? null };
  }
  const { data: d } = await db
    .from("dashboards")
    .select("id, organization_id, status, settings")
    .eq("id", owner.id)
    .maybeSingle();
  if (!d || d.status === "trashed") return "Quadro indisponível.";
  const kanban = (d.settings as DashboardSettings | null)?.kanban;
  if (!kanban) return "Quadro sem configuração de kanban.";
  return { settings: kanban, orgId: (d.organization_id as string) ?? null };
}

export interface KanbanServiceContext {
  catalog: Awaited<ReturnType<typeof loadSources>>;
  defs: FieldDefinition[];
  available: ReturnType<typeof buildAvailableFields>;
}

/**
 * Catálogo + defs + available da org, com service role (mesma montagem do
 * runKanbanWidget, sem visibilidade por papel — execução de sistema).
 * Compartilhado entre as automações e o reconcile da alocação-como-campo.
 */
export async function loadKanbanServiceContext(
  db: SupabaseClient,
  orgId: string | null
): Promise<KanbanServiceContext> {
  const [catalog, correspondences, { data: defRows }] = await Promise.all([
    loadSources(db, orgId ?? undefined),
    loadCorrespondences(db, orgId ?? undefined),
    (() => {
      let q = db
        .from("field_definitions")
        .select(FIELD_DEF_COLS)
        .or("show_in_builder.eq.true,source_system.eq.core")
        .order("sort_order", { ascending: true });
      if (orgId) q = q.eq("organization_id", orgId);
      return q;
    })(),
  ]);
  const defs = (defRows ?? []) as FieldDefinition[];
  const available = buildAvailableFields(defs, correspondences, catalog);
  return { catalog, defs, available };
}

/**
 * Avalia e executa as automações de UM quadro. `db` DEVE ser service client
 * (a autoria das regras é gate de editor; a execução tem autoridade de
 * sistema, como o sync). `deadline` (Date.now()-based) corta a rodada
 * cooperativamente — regras não avaliadas ficam sem bookkeeping e voltam
 * primeiro no round-robin do tick.
 */
export async function runBoardAutomations(
  db: SupabaseClient,
  owner: AutomationOwner,
  opts?: { deadline?: number }
): Promise<AutomationRunSummary> {
  const overBudget = () =>
    opts?.deadline != null && Date.now() >= opts.deadline;
  const summary: AutomationRunSummary = {
    moved: 0,
    evaluated: 0,
    ruleErrors: [],
  };
  const ownerCol = owner.kind === "widget" ? "widget_id" : "board_id";

  // 1) Regras habilitadas, em ordem de avaliação.
  const { data: ruleRows, error: rulesError } = await db
    .from("kanban_automations")
    .select("id, name, enabled, position, rule, last_run_at, last_error, last_moved_count")
    .eq(ownerCol, owner.id)
    .eq("enabled", true)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (rulesError) return { ...summary, fatal: rulesError.message };
  if (!ruleRows || ruleRows.length === 0) return summary;

  // Bookkeeping por regra (gravado no final da rodada).
  const errorByRule = new Map<string, string>();
  const rules: AutomationRow[] = [];
  for (const r of ruleRows) {
    const rule = parseAutomationRule(r.rule);
    if (!rule) {
      errorByRule.set(r.id as string, "Regra inválida (estrutura fora do contrato).");
      continue;
    }
    rules.push({
      id: r.id as string,
      name: (r.name as string) ?? "",
      enabled: true,
      position: (r.position as number) ?? 0,
      rule,
      last_run_at: (r.last_run_at as string) ?? null,
      last_error: (r.last_error as string) ?? null,
      last_moved_count: (r.last_moved_count as number) ?? 0,
    });
  }

  const summaryMovedByRule = new Map<string, number>();
  const finish = async (fatal?: string): Promise<AutomationRunSummary> => {
    // Fatal do QUADRO vale p/ todas as regras (visível na UI de cada uma).
    const now = new Date().toISOString();
    for (const r of ruleRows) {
      const id = r.id as string;
      const message = fatal ?? errorByRule.get(id) ?? null;
      await db
        .from("kanban_automations")
        .update({
          last_run_at: now,
          last_error: message,
          last_moved_count: summaryMovedByRule.get(id) ?? 0,
        })
        .eq("id", id);
    }
    for (const [ruleId, message] of errorByRule) {
      if (!summary.ruleErrors.some((e) => e.ruleId === ruleId)) {
        summary.ruleErrors.push({ ruleId, message });
      }
    }
    return fatal ? { ...summary, fatal } : summary;
  };

  // 2) Config do dono (fora do escopo = fatal visível, nunca silêncio).
  const ctxOrErr = await loadKanbanOwnerContext(db, owner);
  if (typeof ctxOrErr === "string") return finish(ctxOrErr);
  const { settings, orgId } = ctxOrErr;
  if (settings.mode === "tarefas")
    return finish("Automações não se aplicam a kanban de tarefas.");
  if (settings.dateBucket && settings.dateField)
    return finish(
      "Automações não se aplicam a colunas por data (mover reescreveria a data do registro a cada execução)."
    );
  if (rules.length === 0) return finish();
  if (overBudget()) return { ...summary, fatal: "Orçamento de tempo esgotado." };

  // 3) Catálogo + quadro. period null: regra vê o dataset inteiro (a barra de
  // período é filtro de VISÃO).
  const { catalog, defs, available } = await loadKanbanServiceContext(db, orgId);

  let board;
  try {
    board = await runKanban(db, settings, null, defs, {}, owner, {
      available,
      catalog,
      orgId: orgId ?? undefined,
    });
  } catch (e) {
    return finish(e instanceof Error ? e.message : String(e));
  }
  if (overBudget()) return { ...summary, fatal: "Orçamento de tempo esgotado." };

  const cards = board.columns.flatMap((col) =>
    col.cards
      .filter((c) => c.record)
      .map((c) => ({ card: c, columnKey: col.key }))
  );
  summary.evaluated = cards.length;
  const recordIds = cards.map((c) => c.card.id);
  const recordById = new Map(cards.map((c) => [c.card.id, c.card.record!]));

  // 4) Fatos por card — só o que as regras ativas pedem.
  const conds = rules.flatMap((r) => r.rule.conditions);
  const needTasks = conds.some((c) => c.kind === "tasks");
  const needFmod = conds.some(
    (c) => c.kind === "time" && c.basis.type === "field_changed"
  );
  const needPlacement = conds.some(
    (c) => c.kind === "time" && c.basis.type === "in_column"
  );
  const relatedConds = new Map<
    string,
    Extract<(typeof conds)[number], { kind: "related_count" }>
  >();
  for (const c of conds) {
    if (c.kind === "related_count") relatedConds.set(relatedCountKey(c), c);
  }

  const todayIso = todayBrasiliaIso();
  const openByRecord = new Map<string, number>();
  const overdueByRecord = new Map<string, number>();
  if (needTasks) {
    for (const slice of chunksOf(recordIds)) {
      let q = db
        .from("tasks")
        .select("record_id, due_date")
        .is("completed_at", null)
        .in("record_id", slice);
      if (orgId) q = q.eq("organization_id", orgId);
      const { data } = await q;
      for (const t of data ?? []) {
        const k = t.record_id as string;
        openByRecord.set(k, (openByRecord.get(k) ?? 0) + 1);
        const due = (t.due_date as string | null) ?? null;
        if (due && due.slice(0, 10) < todayIso) {
          overdueByRecord.set(k, (overdueByRecord.get(k) ?? 0) + 1);
        }
      }
    }
  }

  const fmodByRecord = new Map<string, Record<string, string> | null>();
  if (needFmod) {
    for (const slice of chunksOf(recordIds)) {
      let q = db
        .from("records")
        .select("id, field_modified_at")
        .in("id", slice);
      if (orgId) q = q.eq("organization_id", orgId);
      const { data } = await q;
      for (const r of data ?? []) {
        fmodByRecord.set(
          r.id as string,
          (r.field_modified_at as Record<string, string> | null) ?? null
        );
      }
    }
  }

  const placementAtByRecord = new Map<string, string>();
  if (needPlacement && settings.columnSource === "custom") {
    for (const slice of chunksOf(recordIds)) {
      const { data } = await db
        .from("kanban_placements")
        .select("record_id, updated_at")
        .eq(ownerCol, owner.id)
        .in("record_id", slice);
      for (const p of data ?? []) {
        placementAtByRecord.set(p.record_id as string, p.updated_at as string);
      }
    }
  }

  const relatedByKey = new Map<string, Map<string, number>>();
  for (const [key, cond] of relatedConds) {
    if (overBudget())
      return { ...summary, fatal: "Orçamento de tempo esgotado." };
    relatedByKey.set(
      key,
      await countRelatedBySource(
        db,
        orgId,
        recordIds,
        cond.source,
        cond.filters,
        available,
        catalog
      )
    );
  }

  const facts: CardFacts[] = cards.map(({ card, columnKey }) => {
    const relatedCounts: Record<string, number> = {};
    for (const [key, byRecord] of relatedByKey) {
      relatedCounts[key] = byRecord.get(card.id) ?? 0;
    }
    return {
      record: card.record!,
      columnKey,
      isMock: card.isMock,
      openTasks: needTasks ? (openByRecord.get(card.id) ?? 0) : card.openTasks,
      overdueTasks: overdueByRecord.get(card.id) ?? 0,
      relatedCounts,
      fieldModifiedAt: fmodByRecord.get(card.id) ?? null,
      sourceCreatedAt: card.record!.source_created_at ?? null,
      placementUpdatedAt: placementAtByRecord.get(card.id) ?? null,
    };
  });

  // 5) Decide e executa (teto por rodada; sobras ficam p/ o próximo tick).
  const evalCtx: EvalContext = {
    available,
    todayIso,
    columns: board.columns,
  };
  const { moves, ruleErrors } = decideMoves(rules, facts, evalCtx);
  for (const e of ruleErrors) errorByRule.set(e.ruleId, e.message);
  summary.ruleErrors.push(...ruleErrors);

  const capped = moves.slice(0, MAX_MOVES_PER_RUN);
  if (capped.length > 0) {
    if (overBudget())
      return { ...summary, fatal: "Orçamento de tempo esgotado." };
    const result = await executeAutomationMoves(db, {
      moves: capped,
      recordById,
      settings,
      owner,
      orgId,
      defs,
    });
    summary.moved = result.okIds.length;
    for (const [ruleId, n] of result.movedByRule) {
      summaryMovedByRule.set(ruleId, n);
    }
    // Primeira falha de execução por regra vira last_error (diagnóstico).
    for (const f of result.failed) {
      const move = capped.find((m) => m.recordId === f.recordId);
      if (move && !errorByRule.has(move.ruleId)) {
        errorByRule.set(move.ruleId, `Falha ao mover: ${f.message}`);
        summary.ruleErrors.push({
          ruleId: move.ruleId,
          message: `Falha ao mover: ${f.message}`,
        });
      }
    }
  }

  return finish();
}
