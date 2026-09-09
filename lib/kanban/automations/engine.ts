// Versão: 1.5 | Data: 09/09/2026
// v1.5 (09/09/2026): ação `create_task_series`. Dois fatos novos, ambos sob
//   gate (só quando alguma regra ativa mantém série): as ocorrências já criadas
//   (evita a ida ao banco; a trava real é o índice único da 0132) e as exceções
//   de cadência da rodada. O executor é irmão do de tarefas e entra no MESMO
//   teto de ações.
// Versão: 1.4 | Data: 09/09/2026
// v1.4 (09/09/2026): ação `run_schema` — a rodada carrega os esquemas ELEGÍVEIS
//   (ligados, gatilho `automacao`, definição válida) uma vez, o avaliador
//   resolve as respostas a partir do registro e o executor roda o núcleo do
//   Workflow. Teto PRÓPRIO (MAX_SCHEMA_RUNS_PER_RUN), ainda descontado do teto
//   compartilhado: efeito fora do sistema merece um limite que caiba num
//   engano. A trava contra repetição não está no engine — é o índice único da
//   0130, reivindicado antes de executar.
// Versão: 1.3 | Data: 08/09/2026
// v1.3 (08/09/2026): ação `create_task` — mais um fato por card
//   (`openAutomationRuleIds`, só consultado quando alguma regra ATIVA cria
//   tarefa) e mais um executor no fim da rodada, sob o mesmo teto de ações.
// v1.2 (08/09/2026): a rodada aceita dono de tipo `source` (0127) — a regra
//   avalia os registros de uma BASE, sem quadro. A montagem do universo saiu
//   para ./universe.ts e ramifica lá; TUDO daqui para a frente (fatos,
//   decisão, execução) é compartilhado, porque nunca foi sobre kanban. As
//   guardas de quadro (modo tarefas, colunas por data, placements, moves) só
//   valem no ramo de quadro; no de Base elas não têm o que guardar.
// Engine I/O das automações do kanban: carrega o quadro do DONO (widget ou
// board dedicado) com SERVICE ROLE e escopo EXPLÍCITO de org (invariante
// 0089+), monta os CardFacts que as regras ativas pedem (gates — nada de
// consulta desnecessária), decide via avaliador puro (evaluate.ts) e executa
// via move.ts, com teto de AÇÕES por rodada e deadline cooperativo (tick
// com orçamento). O universo (quadro ou base) vem de ./universe.ts, que no
// ramo de quadro reusa runKanban inteiro (resolução de colunas, placements,
// canonicalização de responsáveis, __match) — RPCs de widget INTOCADOS.
// Quadros fora do escopo v1 (modo tarefas, bucket de data — mover reescreveria
// uma DATA real relativa a "hoje" a cada tick, não idempotente) falham ALTO
// (fatal na rodada, visível no last_error), nunca em silêncio.
// v1.1 (31/07/2026): ação set_field — decideActions devolve {moves, sets};
// teto ÚNICO (MAX_ACTIONS_PER_RUN, ex-MAX_MOVES_PER_RUN) sobre a soma;
// last_moved_count passa a contar AÇÕES executadas (a UI rotula "ações");
// EvalContext.allocationFieldKey vem do settings do dono (invariante 24).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition } from "@/lib/records/types";
import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import { buildAvailableFields } from "@/lib/widgets/fields";
import type { DashboardSettings } from "@/lib/widgets/types";
import { todayBrasiliaIso } from "@/lib/date/today";
import type { KanbanSettings } from "../types";
import {
  decideActions,
  type CardFacts,
  type EvalContext,
  type RuleError,
} from "./evaluate";
import { countRelatedBySource } from "../related-count";
import { executeAutomationMoves, executeAutomationSets } from "./move";
import {
  executeAutomationTasks,
  loadOpenAutomationTasks,
} from "./task";
import { loadAutomationUniverse } from "./universe";
import {
  executeAutomationSeries,
  loadSeriesOccurrences,
} from "./series";
import { loadSeriesSettings } from "@/lib/series/load";
import {
  loadFieldHistory,
  type FieldHistory,
} from "@/lib/records/field-history";
import {
  executeAutomationSchemaRuns,
  MAX_SCHEMA_RUNS_PER_RUN,
} from "./schema-run";
import type { SeriesSetting } from "@/lib/series/cadence";
import { syncSchemaFailureTask } from "@/lib/workflow/notify";
import { loadWorkflowSchemas, type WorkflowSchemaRow } from "@/lib/workflow/schemas";
import type { WorkflowDefinition } from "@/lib/workflow/types";
import {
  ownerColumn,
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

/** Teto de AÇÕES (moves + sets de campo) por quadro por rodada — o resto fica
 *  p/ o próximo tick; um teto ÚNICO mantém webhooks/write-backs e o orçamento
 *  do tick limitados mesmo com regras das duas famílias. */
export const MAX_ACTIONS_PER_RUN = 200;

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
    .from("automation_rules")
    .select("widget_id, board_id, source_key, last_run_at")
    .eq("enabled", true);
  const byOwner = new Map<string, { owner: AutomationOwner; oldest: number }>();
  for (const r of data ?? []) {
    // Exatamente um dos três está preenchido (CHECK da 0127).
    const owner: AutomationOwner = r.widget_id
      ? { kind: "widget", id: r.widget_id as string }
      : r.board_id
        ? { kind: "board", id: r.board_id as string }
        : { kind: "source", id: r.source_key as string };
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
  const ownerCol = ownerColumn(owner);

  // 1) Regras habilitadas, em ordem de avaliação.
  const { data: ruleRows, error: rulesError } = await db
    .from("automation_rules")
    .select(
      "id, name, enabled, position, rule, last_run_at, last_error, last_moved_count, organization_id, created_by"
    )
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
        .from("automation_rules")
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
  // Escopo de BASE não tem quadro: a org vem da própria linha da regra
  // (carimbada pela action — o trigger da 0109 cai no coalesce), e as guardas
  // de quadro abaixo não têm o que guardar.
  let settings: KanbanSettings | null = null;
  let orgId: string | null = null;
  if (owner.kind === "source") {
    orgId = (ruleRows[0]?.organization_id as string | null) ?? null;
  } else {
    const ctxOrErr = await loadKanbanOwnerContext(db, owner);
    if (typeof ctxOrErr === "string") return finish(ctxOrErr);
    settings = ctxOrErr.settings;
    orgId = ctxOrErr.orgId;
    if (settings.mode === "tarefas")
      return finish("Automações não se aplicam a kanban de tarefas.");
    if (settings.dateBucket && settings.dateField)
      return finish(
        "Automações não se aplicam a colunas por data (mover reescreveria a data do registro a cada execução)."
      );
  }
  if (rules.length === 0) return finish();
  if (overBudget()) return { ...summary, fatal: "Orçamento de tempo esgotado." };

  // 3) Catálogo + UNIVERSO. period null: a regra vê o dataset inteiro (a barra
  // de período é filtro de VISÃO, e uma automação não tem visão).
  const service = await loadKanbanServiceContext(db, orgId);
  const { catalog, defs, available } = service;

  let universe;
  try {
    universe = await loadAutomationUniverse(db, {
      owner,
      settings,
      orgId,
      service,
    });
  } catch (e) {
    return finish(e instanceof Error ? e.message : String(e));
  }
  if (typeof universe === "string") return finish(universe);
  if (overBudget()) return { ...summary, fatal: "Orçamento de tempo esgotado." };

  const cards = universe.cards;
  summary.evaluated = cards.length;
  const recordIds = cards.map((c) => c.id);
  const recordById = new Map(cards.map((c) => [c.id, c.record]));

  // 4) Fatos por card — só o que as regras ativas pedem.
  const conds = rules.flatMap((r) => r.rule.conditions);
  const needTasks = conds.some((c) => c.kind === "tasks");
  // Campos cujo HISTÓRICO de alteração a rodada precisa. Vazio = ninguém
  // pergunta por tempo de campo e o loader nem roda.
  // v1.1 (09/09/2026): antes isto lia `records.field_modified_at`, que é o
  // marcador de proteção do sync e fica vazio para campo vindo do Bitrix — a
  // âncora nunca resolvia. Ver lib/records/field-history.ts.
  const historyFields = new Set<string>();
  for (const c of conds) {
    if (c.kind === "time" && c.basis.type === "field_changed") {
      historyFields.add(c.basis.field);
    }
  }
  for (const r of rules) {
    if (r.rule.action.type !== "create_task_series") continue;
    const series = r.rule.action.series;
    // A âncora "desde que mudou de etapa" e as bordas da janela leem o MESMO
    // fato.
    if (series.anchor.kind === "field_changed") {
      historyFields.add(series.anchor.field);
    }
    for (const bound of [series.from, series.until]) {
      if (bound?.kind === "field_changed") historyFields.add(bound.field);
    }
  }
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

  // Regras que criam tarefa: só elas motivam a consulta do fato (uma por
  // rodada), e só elas entram no `in` dela.
  const taskRuleIds = rules
    .filter((r) => r.rule.action.type === "create_task")
    .map((r) => r.id);
  const openTasksByRecord =
    taskRuleIds.length > 0
      ? await loadOpenAutomationTasks(db, orgId, taskRuleIds, recordIds)
      : new Map<string, string[]>();

  // Esquemas ELEGÍVEIS da rodada: uma consulta, e só quando alguma regra ativa
  // executa esquema. Ligado + gatilho `automacao` + definição válida — o resto
  // não entra no mapa, e é a AUSÊNCIA no mapa que deixa a regra inerte.
  const schemaRows = new Map<string, WorkflowSchemaRow>();
  const schemaDefs = new Map<string, WorkflowDefinition>();
  if (rules.some((r) => r.rule.action.type === "run_schema") && orgId) {
    for (const row of await loadWorkflowSchemas(db, orgId)) {
      if (!row.enabled || row.triggerKind !== "automacao" || !row.definition) {
        continue;
      }
      schemaRows.set(row.key, row);
      schemaDefs.set(row.key, row.definition);
    }
  }

  // Séries da rodada: as ocorrências já criadas (evita a escrita que a trava
  // recusaria) e as exceções de cadência. Só quando alguma regra ativa mantém
  // série — o caso comum não paga consulta nenhuma.
  const seriesRules = rules.filter(
    (r) => r.rule.action.type === "create_task_series"
  );
  const seriesKeys = [
    ...new Set(
      seriesRules.map((r) =>
        r.rule.action.type === "create_task_series" ? r.rule.action.series.key : ""
      )
    ),
  ].filter(Boolean);
  const [seriesByRecord, seriesSettings] =
    seriesRules.length > 0
      ? await Promise.all([
          loadSeriesOccurrences(
            db,
            orgId,
            seriesRules.map((r) => r.id),
            recordIds
          ),
          loadSeriesSettings(db, orgId, seriesKeys),
        ])
      : [new Map<string, string[]>(), new Map<string, SeriesSetting[]>()];

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

  // v1.2 (09/09/2026): atributos PAUSADOS do registro. Só consulta quando
  // alguma regra ativa concede atributo — pausar precisa parar a cobrança, e
  // até aqui o status era escrito e nunca lido (a 0131 prometia o contrário).
  const grantedAttributes = [
    ...new Set(
      rules.flatMap((r) =>
        r.rule.action.type === "create_task_series" &&
        r.rule.action.series.grantAttribute
          ? [r.rule.action.series.grantAttribute]
          : []
      )
    ),
  ];
  const pausedByRecord = new Map<string, string[]>();
  if (grantedAttributes.length > 0) {
    for (const slice of chunksOf(recordIds)) {
      let q = db
        .from("record_attributes")
        .select("record_id, attribute_key")
        .in("record_id", slice)
        .in("attribute_key", grantedAttributes)
        .eq("status", "pausado");
      if (orgId) q = q.eq("organization_id", orgId);
      const { data } = await q;
      for (const r of data ?? []) {
        const id = r.record_id as string;
        const list = pausedByRecord.get(id);
        if (list) list.push(r.attribute_key as string);
        else pausedByRecord.set(id, [r.attribute_key as string]);
      }
    }
  }

  let history: FieldHistory = new Map();
  if (historyFields.size > 0) {
    const fmodById = new Map<string, Record<string, string> | null>();
    for (const slice of chunksOf(recordIds)) {
      let q = db.from("records").select("id, field_modified_at").in("id", slice);
      if (orgId) q = q.eq("organization_id", orgId);
      const { data } = await q;
      for (const r of data ?? []) {
        fmodById.set(
          r.id as string,
          (r.field_modified_at as Record<string, string> | null) ?? null
        );
      }
    }
    history = await loadFieldHistory(
      db,
      recordIds.map((id) => ({ id, fieldModifiedAt: fmodById.get(id) ?? null })),
      [...historyFields]
    );
  }

  const placementAtByRecord = new Map<string, string>();
  if (needPlacement && settings?.columnSource === "custom") {
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

  const facts: CardFacts[] = cards.map((card) => {
    const relatedCounts: Record<string, number> = {};
    for (const [key, byRecord] of relatedByKey) {
      relatedCounts[key] = byRecord.get(card.id) ?? 0;
    }
    return {
      record: card.record,
      columnKey: card.columnKey,
      isMock: card.isMock,
      openTasks: needTasks ? (openByRecord.get(card.id) ?? 0) : card.openTasks,
      overdueTasks: overdueByRecord.get(card.id) ?? 0,
      relatedCounts,
      changedAt: historyFields.size > 0 ? (history.get(card.id) ?? null) : null,
      sourceCreatedAt: card.record.source_created_at ?? null,
      placementUpdatedAt: placementAtByRecord.get(card.id) ?? null,
      openAutomationRuleIds: openTasksByRecord.get(card.id) ?? [],
      seriesOccurrences: seriesByRecord.get(card.id) ?? [],
      pausedAttributes: pausedByRecord.get(card.id) ?? [],
    };
  });

  // 5) Decide e executa (teto ÚNICO por rodada — moves + sets somam; sobras
  // ficam p/ o próximo tick).
  const evalCtx: EvalContext = {
    available,
    todayIso,
    // [] no escopo de Base: sem colunas, decideActions já recusa qualquer
    // move_to_column pelo mesmo caminho que trata "coluna removida".
    columns: universe.columns,
    // Campo espelho da alocação (invariante 24) — nunca alvo de set_field; o
    // vínculo pode nascer DEPOIS da regra, por isso a guarda é de avaliação.
    allocationFieldKey: universe.allocationFieldKey,
    schemaDefs,
    seriesSettings,
  };
  const { moves, sets, tasks, schemaRuns, seriesTasks, ruleErrors } = decideActions(
    rules,
    facts,
    evalCtx
  );
  for (const e of ruleErrors) errorByRule.set(e.ruleId, e.message);
  summary.ruleErrors.push(...ruleErrors);

  // Orçamento compartilhado: moves primeiro (ordem estável), sets no que sobrar.
  const cappedMoves = moves.slice(0, MAX_ACTIONS_PER_RUN);
  const cappedSets = sets.slice(0, MAX_ACTIONS_PER_RUN - cappedMoves.length);
  const cappedTasks = tasks.slice(
    0,
    MAX_ACTIONS_PER_RUN - cappedMoves.length - cappedSets.length
  );
  const cappedSeries = seriesTasks.slice(
    0,
    MAX_ACTIONS_PER_RUN - cappedMoves.length - cappedSets.length - cappedTasks.length
  );
  // Teto próprio E o que sobrou do compartilhado — o menor dos dois.
  const cappedSchemaRuns = schemaRuns.slice(
    0,
    Math.min(
      MAX_SCHEMA_RUNS_PER_RUN,
      MAX_ACTIONS_PER_RUN -
        cappedMoves.length -
        cappedSets.length -
        cappedTasks.length -
        cappedSeries.length
    )
  );

  const noteFailures = (
    failed: { recordId: string; message: string }[],
    planned: { recordId: string; ruleId: string }[],
    verb: string
  ) => {
    // Primeira falha de execução por regra vira last_error (diagnóstico).
    for (const f of failed) {
      const p = planned.find((m) => m.recordId === f.recordId);
      if (p && !errorByRule.has(p.ruleId)) {
        errorByRule.set(p.ruleId, `${verb}: ${f.message}`);
        summary.ruleErrors.push({
          ruleId: p.ruleId,
          message: `${verb}: ${f.message}`,
        });
      }
    }
  };

  // Mover exige quadro. No escopo de Base `cappedMoves` já vem vazio (sem
  // colunas, decideActions recusou o alvo) — a guarda é defesa em profundidade
  // e o que prova ao compilador que `settings`/`owner` são de quadro aqui.
  if (cappedMoves.length > 0 && settings && owner.kind !== "source") {
    if (overBudget())
      return { ...summary, fatal: "Orçamento de tempo esgotado." };
    const result = await executeAutomationMoves(db, {
      moves: cappedMoves,
      recordById,
      settings,
      owner,
      orgId,
      defs,
    });
    summary.moved += result.okIds.length;
    for (const [ruleId, n] of result.movedByRule) {
      summaryMovedByRule.set(ruleId, (summaryMovedByRule.get(ruleId) ?? 0) + n);
    }
    noteFailures(result.failed, cappedMoves, "Falha ao mover");
  }

  if (cappedSets.length > 0) {
    if (overBudget())
      return { ...summary, fatal: "Orçamento de tempo esgotado." };
    const result = await executeAutomationSets(db, {
      sets: cappedSets,
      recordById,
      writeBack: universe.writeBack,
      orgId,
      defs,
    });
    summary.moved += result.okIds.length;
    for (const [ruleId, n] of result.movedByRule) {
      summaryMovedByRule.set(ruleId, (summaryMovedByRule.get(ruleId) ?? 0) + n);
    }
    noteFailures(result.failed, cappedSets, "Falha ao definir campo");
  }

  if (cappedTasks.length > 0) {
    if (overBudget())
      return { ...summary, fatal: "Orçamento de tempo esgotado." };
    const result = await executeAutomationTasks(db, {
      tasks: cappedTasks,
      orgId,
      // Autoria: quem salvou a regra. A execução é de sistema, mas a tarefa
      // precisa de um dono humano no histórico.
      createdBy: (ruleRows[0]?.created_by as string | null) ?? null,
    });
    summary.moved += result.okIds.length;
    for (const [ruleId, n] of result.createdByRule) {
      summaryMovedByRule.set(ruleId, (summaryMovedByRule.get(ruleId) ?? 0) + n);
    }
    noteFailures(result.failed, cappedTasks, "Falha ao abrir tarefa");
  }

  if (cappedSeries.length > 0) {
    if (overBudget())
      return { ...summary, fatal: "Orçamento de tempo esgotado." };
    const result = await executeAutomationSeries(db, {
      series: cappedSeries,
      orgId,
      createdBy: (ruleRows[0]?.created_by as string | null) ?? null,
    });
    summary.moved += result.okIds.length;
    for (const [ruleId, n] of result.createdByRule) {
      summaryMovedByRule.set(ruleId, (summaryMovedByRule.get(ruleId) ?? 0) + n);
    }
    noteFailures(result.failed, cappedSeries, "Falha ao abrir a cobrança");
  }

  if (cappedSchemaRuns.length > 0 && orgId) {
    if (overBudget())
      return { ...summary, fatal: "Orçamento de tempo esgotado." };
    const result = await executeAutomationSchemaRuns(db, {
      runs: cappedSchemaRuns,
      schemas: schemaRows,
      recordById,
      orgId,
      createdBy: (ruleRows[0]?.created_by as string | null) ?? null,
      defs,
      catalog,
    });
    summary.moved += result.okIds.length;
    for (const [ruleId, n] of result.runsByRule) {
      summaryMovedByRule.set(ruleId, (summaryMovedByRule.get(ruleId) ?? 0) + n);
    }
    noteFailures(result.failed, cappedSchemaRuns, "Falha ao executar o esquema");

    // Notificação: a execução falha NÃO se repete sozinha, então o erro
    // precisa chegar a alguém. Uma tarefa aberta por REGRA que tentou nesta
    // rodada — quem não tentou fica como está (auto-completar aí apagaria o
    // registro de uma falha que ninguém resolveu).
    const failedByRule = new Map<string, { recordId: string; message: string }[]>();
    for (const r of cappedSchemaRuns) {
      if (!failedByRule.has(r.ruleId)) failedByRule.set(r.ruleId, []);
    }
    for (const f of result.failed) {
      const planned = cappedSchemaRuns.find((r) => r.recordId === f.recordId);
      if (planned) failedByRule.get(planned.ruleId)?.push(f);
    }
    for (const [ruleId, failures] of failedByRule) {
      const row = rules.find((r) => r.id === ruleId);
      await syncSchemaFailureTask(db, orgId, {
        ruleId,
        ruleName: row?.name || "sem nome",
        failures,
      });
    }
  }

  return finish();
}
