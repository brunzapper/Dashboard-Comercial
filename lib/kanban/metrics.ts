// Versão: 1.0 | Data: 28/07/2026
// Métricas do kanban — helpers PUROS compartilhados entre o pipeline
// (lib/kanban/data.ts), o builder de widget e o popover da página dedicada:
//  * normalizeKanbanMetrics: UMA leitura canônica da config (columnMetric vence
//    `metric` legado; card.badges AUSENTE = badge legado de tarefas abertas —
//    [] explícito = sem badges). Cobre linhas antigas e snapshots congelados
//    sem migração de dados.
//  * aggregateMetric: agregação por coluna (sum/count definidos p/ coluna
//    vazia — 0, como o somatório legado; avg/min/max sem valor → null).
//  * encode/parseMetricSpec: forma serializada dos selects da UI
//    ("field:<ref>" | "linked:<source>" | "tasks:open|overdue" | "age").
//  * rótulos e opções compartilhadas (builder + popover) — "Base", nunca
//    "Fonte" (invariante 13); bases vinculáveis = SÓ raízes (sub-fontes nunca
//    casam — mesma regra do buildMatchFields).
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import {
  BUILTIN_SOURCES,
  fieldAppliesToSource,
  rootSources,
  type SourceDef,
} from "@/lib/sources";
import { recordRefLabel } from "@/lib/export/record-cells";
import { daysSince } from "./automations/evaluate";
import {
  KANBAN_MAX_BADGES,
  type KanbanAgg,
  type KanbanMetricSpec,
  type KanbanSettings,
} from "./types";

const AGGS: readonly KanbanAgg[] = ["sum", "count", "avg", "min", "max"];

/** Config de métricas já normalizada (legado resolvido). */
export interface NormalizedKanbanMetrics {
  columnMetric: { spec: KanbanMetricSpec; agg: KanbanAgg } | null;
  badges: KanbanMetricSpec[];
  // O usuário configurou badges explicitamente? false = default legado
  // (tarefas abertas) — o pipeline NÃO emite card.badges e o renderer cai no
  // pill de sempre (quadros legados renderizam idênticos; lista/CSV sem
  // colunas novas).
  badgesConfigured: boolean;
}

/** Valida um spec vindo do jsonb (shape quebrado → null, nunca lança). */
export function sanitizeMetricSpec(v: unknown): KanbanMetricSpec | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  switch (o.kind) {
    case "field":
      return typeof o.ref === "string" && o.ref
        ? { kind: "field", ref: o.ref }
        : null;
    case "linked":
      return typeof o.source === "string" && o.source
        ? { kind: "linked", source: o.source }
        : null;
    case "tasks":
      return o.metric === "open" || o.metric === "overdue"
        ? { kind: "tasks", metric: o.metric }
        : null;
    case "age":
      return { kind: "age" };
    default:
      return null;
  }
}

/** Agregação default por tipo de métrica (idade agrega por média). */
export function defaultAggFor(spec: KanbanMetricSpec): KanbanAgg {
  return spec.kind === "age" ? "avg" : "sum";
}

/**
 * Leitura canônica da config de métricas de um kanban. ÚNICO ponto que resolve
 * o legado: `columnMetric` vence `metric` (string = soma de campo);
 * `card.badges` ausente reproduz o badge fixo de tarefas abertas de sempre.
 */
export function normalizeKanbanMetrics(
  settings: KanbanSettings
): NormalizedKanbanMetrics {
  const cm = settings.columnMetric;
  const cmSpec = cm ? sanitizeMetricSpec(cm.spec) : null;
  const columnMetric = cmSpec
    ? {
        spec: cmSpec,
        agg:
          cm?.agg && AGGS.includes(cm.agg) ? cm.agg : defaultAggFor(cmSpec),
      }
    : settings.metric
      ? {
          spec: { kind: "field", ref: settings.metric } as KanbanMetricSpec,
          agg: "sum" as KanbanAgg,
        }
      : null;

  const raw = settings.card?.badges;
  const badges =
    raw === undefined
      ? [{ kind: "tasks", metric: "open" } as KanbanMetricSpec]
      : (Array.isArray(raw) ? raw : [])
          .map(sanitizeMetricSpec)
          .filter((s): s is KanbanMetricSpec => s !== null)
          .slice(0, KANBAN_MAX_BADGES);

  return { columnMetric, badges, badgesConfigured: raw !== undefined };
}

/**
 * Agrega os valores de uma coluna. `null` = card sem o fato (não conta em
 * nenhuma agregação). sum/count seguem definidos para coluna vazia (0 — o
 * somatório legado mostrava 0); avg/min/max sem valor → null (oculto).
 */
export function aggregateMetric(
  values: (number | null)[],
  agg: KanbanAgg
): number | null {
  const nums = values.filter(
    (v): v is number => v != null && Number.isFinite(v)
  );
  switch (agg) {
    case "count":
      return nums.length;
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "avg":
      return nums.length
        ? nums.reduce((a, b) => a + b, 0) / nums.length
        : null;
    case "min":
      return nums.length ? Math.min(...nums) : null;
    case "max":
      return nums.length ? Math.max(...nums) : null;
  }
}

/** Forma serializada de um spec (value dos selects da UI). */
export function encodeMetricSpec(spec: KanbanMetricSpec): string {
  switch (spec.kind) {
    case "field":
      return `field:${spec.ref}`;
    case "linked":
      return `linked:${spec.source}`;
    case "tasks":
      return `tasks:${spec.metric}`;
    case "age":
      return "age";
  }
}

/** Inverso de encodeMetricSpec (string desconhecida → null). */
export function parseMetricSpec(s: string): KanbanMetricSpec | null {
  if (s === "age") return { kind: "age" };
  if (s === "tasks:open") return { kind: "tasks", metric: "open" };
  if (s === "tasks:overdue") return { kind: "tasks", metric: "overdue" };
  if (s.startsWith("field:")) {
    const ref = s.slice("field:".length);
    return ref ? { kind: "field", ref } : null;
  }
  if (s.startsWith("linked:")) {
    const source = s.slice("linked:".length);
    return source ? { kind: "linked", source } : null;
  }
  return null;
}

/** Rótulo do indicador de conectados: "Leads vinculados", "Deals vinculados". */
export function linkedMetricLabel(
  source: string,
  catalog: SourceDef[]
): string {
  const def =
    catalog.find((s) => s.key === source) ??
    BUILTIN_SOURCES.find((s) => s.key === source);
  return `${def?.shortLabel ?? source} vinculados`;
}

/** Rótulo de exibição de um spec (cabeçalho da coluna, title dos badges). */
export function metricSpecLabel(
  spec: KanbanMetricSpec,
  defs: FieldDefinition[],
  catalog: SourceDef[]
): string {
  switch (spec.kind) {
    case "field":
      return recordRefLabel(spec.ref, defs);
    case "linked":
      return linkedMetricLabel(spec.source, catalog);
    case "tasks":
      return spec.metric === "open" ? "Tarefas abertas" : "Tarefas atrasadas";
    case "age":
      return "Idade (dias)";
  }
}

/**
 * Idade do registro em dias (dia de Brasília, comparação de prefixo
 * YYYY-MM-DD — mesma régua do daysSince das automações). Abertura; fallback
 * criação na origem.
 */
export function recordAgeDays(
  record: Pick<RecordRow, "opened_at" | "source_created_at">,
  todayIso: string
): number | null {
  return daysSince(
    record.opened_at ?? record.source_created_at ?? null,
    todayIso
  );
}

export interface KanbanMetricOption {
  value: string; // encodeMetricSpec
  label: string;
}

/**
 * Opções de métrica compartilhadas (builder do widget + popover da página
 * dedicada), já na forma serializada. `indicators` = calculados no engine
 * (vinculados por base raiz, tarefas, idade); `fields` = campos numéricos
 * (núcleo + customs da base, mesma régua do select legado).
 */
export function kanbanMetricOptions(
  defs: FieldDefinition[],
  source: string | undefined,
  catalog: SourceDef[]
): { indicators: KanbanMetricOption[]; fields: KanbanMetricOption[] } {
  const roots = rootSources(catalog.length ? catalog : BUILTIN_SOURCES);
  const indicators: KanbanMetricOption[] = [
    ...roots.map((s) => ({
      value: `linked:${s.key}`,
      label: `${s.shortLabel} vinculados`,
    })),
    { value: "tasks:open", label: "Tarefas abertas" },
    { value: "tasks:overdue", label: "Tarefas atrasadas" },
    { value: "age", label: "Idade (dias)" },
  ];
  const fields: KanbanMetricOption[] = [
    { value: "field:value", label: "Valor" },
    { value: "field:mrr", label: "MRR" },
    ...defs
      .filter(
        (f) =>
          (f.data_type === "numero" || f.data_type === "moeda") &&
          (!source || fieldAppliesToSource(f.applies_to, source, catalog))
      )
      .map((f) => ({ value: `field:custom:${f.field_key}`, label: f.label })),
  ];
  return { indicators, fields };
}
