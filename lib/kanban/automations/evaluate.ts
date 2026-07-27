// Versão: 1.0 | Data: 27/07/2026
// Avaliador PURO das automações do kanban: sem I/O — recebe fatos por card
// (CardFacts, montados pelo engine) e decide os movimentos. Semântica:
// regras em ordem (position), a PRIMEIRA que casar vence por card; decisões
// sobre o snapshot ORIGINAL do quadro (uma regra não "vê" o efeito de outra na
// mesma rodada — mata ping-pong intra-run); card já na coluna alvo = no-op
// (a regra casou, mas nada a fazer); mock nunca move (congelado, 0051);
// alvo overflow/inexistente/oculto = ERRO da regra (visível em last_error),
// nunca silêncio. Condição de campo espelha a semântica dos widgets via
// recordMatchesConds/evalCondition (trim, case-insensitive, null ≡ '');
// ilike é avaliado localmente (contém, case-insensitive) p/ não degradar.
// Tempo é dia de CALENDÁRIO (prefixo YYYY-MM-DD — todayIso já vem ancorado em
// Brasília pelo chamador; coerente com a regra de datas 0079/0085).
import type { RecordRow } from "@/lib/records/types";
import type { AggCondition } from "@/lib/records/formulas";
import { recordMatchesConds } from "@/lib/widgets/calc-metrics";
import { recordRawValue } from "@/lib/widgets/quick-filters";
import type { AvailableField } from "@/lib/widgets/fields";
import type { FilterOp, WidgetFilter } from "@/lib/widgets/types";
import { KANBAN_OVERFLOW_KEY, type KanbanColumn } from "../types";
import {
  relatedCountKey,
  type AutomationCondition,
  type AutomationNumOp,
  type AutomationRow,
} from "./types";

/** Fatos de um card, pré-carregados pelo engine (só o que as regras pedem). */
export interface CardFacts {
  // Registro completo (com __match preenchido — runRecordList já anexa).
  record: RecordRow;
  // Coluna ATUAL resolvida (saída do runKanban — inclui placements/overflow).
  columnKey: string;
  isMock: boolean;
  openTasks: number;
  overdueTasks: number;
  // Contagens de conectados por chave canônica da condição (relatedCountKey).
  relatedCounts: Record<string, number>;
  // records.field_modified_at ({ campo: timestamp }) — null = nunca carimbado.
  fieldModifiedAt: Record<string, string> | null;
  sourceCreatedAt: string | null;
  // kanban_placements.updated_at (colunas Personalizar) — null = sem posição.
  placementUpdatedAt: string | null;
}

export interface EvalContext {
  // Catálogo p/ resolver refs custom:/unified:/match: (recordRawValue).
  available: AvailableField[];
  // Dia de hoje YYYY-MM-DD (Brasília) — injetado p/ teste determinístico.
  todayIso: string;
  // Colunas derivadas do quadro (visíveis) — validação do alvo.
  columns: KanbanColumn[];
}

export interface PlannedMove {
  recordId: string;
  fromKey: string;
  targetKey: string;
  ruleId: string;
}

export interface RuleError {
  ruleId: string;
  message: string;
}

/** Dias de calendário entre `iso` e hoje (positivo = passado); null = sem
 *  data válida. Compara os prefixos YYYY-MM-DD — nunca converte fuso. */
export function daysSince(
  iso: string | null | undefined,
  todayIso: string
): number | null {
  const d = iso?.slice(0, 10);
  const t = todayIso.slice(0, 10);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(t))
    return null;
  const [y1, m1, d1] = d.split("-").map(Number);
  const [y2, m2, d2] = t.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000
  );
}

// Ops de comparação → op de AggCondition (mesma normalização dos widgets:
// eq_ci/neq_ci e *_num compartilham a semântica do evalCondition, que já
// decide texto×número pelo TIPO do literal).
const CMP_OPS: Partial<Record<FilterOp, "=" | "<>" | "<" | ">" | "<=" | ">=">> =
  {
    eq: "=",
    eq_ci: "=",
    eq_num: "=",
    neq: "<>",
    neq_ci: "<>",
    neq_num: "<>",
    gt: ">",
    gt_num: ">",
    gte: ">=",
    gte_num: ">=",
    lt: "<",
    lt_num: "<",
    lte: "<=",
    lte_num: "<=",
  };

function scalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

/**
 * Um valor cru passa por um WidgetFilter? Avaliação LOCAL usada nas condições
 * de campo e nos filtros de registros conectados. Op desconhecido/valor não
 * escalar → false (fail-closed).
 */
export function fieldFilterMatches(
  filter: WidgetFilter,
  rawOf: (ref: string) => unknown
): boolean {
  if (filter.op === "ilike") {
    const term = String(filter.value ?? "")
      .trim()
      .toLowerCase();
    if (term === "") return true;
    const v = rawOf(filter.field);
    return v != null && String(v).toLowerCase().includes(term);
  }
  if (filter.op === "in" || filter.op === "in_ci") {
    const list = (
      Array.isArray(filter.value)
        ? filter.value
        : filter.value == null
          ? []
          : [filter.value]
    ).filter(scalar);
    if (list.length === 0) return false;
    const conds: AggCondition[] = [
      { ref: filter.field, op: "in", value: list },
    ];
    return recordMatchesConds(rawOf, conds);
  }
  if (filter.op === "is_null" || filter.op === "not_null") {
    return recordMatchesConds(rawOf, [{ ref: filter.field, op: filter.op }]);
  }
  const op = CMP_OPS[filter.op];
  if (!op) return false;
  const value = filter.op.endsWith("_num")
    ? Number(filter.value)
    : filter.value;
  if (!scalar(value) || (typeof value === "number" && !Number.isFinite(value)))
    return false;
  return recordMatchesConds(rawOf, [{ ref: filter.field, op, value }]);
}

function cmpNum(actual: number, op: AutomationNumOp, value: number): boolean {
  if (op === "gte") return actual >= value;
  if (op === "lte") return actual <= value;
  return actual === value;
}

/** Uma condição casa com um card? (puro — os fatos já foram carregados). */
export function evaluateCondition(
  cond: AutomationCondition,
  facts: CardFacts,
  ctx: EvalContext
): boolean {
  switch (cond.kind) {
    case "field":
      return fieldFilterMatches(cond.filter, (ref) =>
        recordRawValue(ref, facts.record, ctx.available)
      );
    case "related_count":
      return cmpNum(
        facts.relatedCounts[relatedCountKey(cond)] ?? 0,
        cond.op,
        cond.value
      );
    case "tasks":
      return cmpNum(
        cond.metric === "open" ? facts.openTasks : facts.overdueTasks,
        cond.op,
        cond.value
      );
    case "time": {
      const iso =
        cond.basis.type === "field_changed"
          ? facts.fieldModifiedAt?.[cond.basis.field]
          : cond.basis.type === "created"
            ? facts.sourceCreatedAt
            : facts.placementUpdatedAt;
      const days = daysSince(iso ?? null, ctx.todayIso);
      if (days == null) return false;
      return cond.op === "gte" ? days >= cond.days : days <= cond.days;
    }
  }
}

/**
 * Decide os movimentos da rodada: por card, primeira regra (ordem do array)
 * cujas condições TODAS casam vence; já na coluna alvo = consome a regra sem
 * mover. Regras com alvo inválido (overflow, coluna inexistente/oculta) são
 * INERTES na rodada e saem em ruleErrors — o quadro pode ter perdido a coluna
 * depois da regra criada.
 */
export function decideMoves(
  rules: AutomationRow[],
  cards: CardFacts[],
  ctx: EvalContext
): { moves: PlannedMove[]; ruleErrors: RuleError[] } {
  const ruleErrors: RuleError[] = [];
  const validKeys = new Set(
    ctx.columns.filter((c) => !c.noDrop).map((c) => c.key)
  );
  const active: AutomationRow[] = [];
  for (const rule of rules) {
    const target = rule.rule.action.targetKey;
    if (target === KANBAN_OVERFLOW_KEY || !validKeys.has(target)) {
      ruleErrors.push({
        ruleId: rule.id,
        message: `Coluna alvo "${target}" não existe no quadro (removida ou oculta).`,
      });
      continue;
    }
    active.push(rule);
  }

  const moves: PlannedMove[] = [];
  for (const card of cards) {
    if (card.isMock) continue;
    for (const rule of active) {
      const matched = rule.rule.conditions.every((c) =>
        evaluateCondition(c, card, ctx)
      );
      if (!matched) continue;
      const targetKey = rule.rule.action.targetKey;
      if (card.columnKey !== targetKey) {
        moves.push({
          recordId: card.record.id,
          fromKey: card.columnKey,
          targetKey,
          ruleId: rule.id,
        });
      }
      break; // primeira regra que casou consome o card (mesmo sem mover)
    }
  }
  return { moves, ruleErrors };
}
