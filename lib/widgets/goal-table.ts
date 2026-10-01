// Versão: 1.0 | Data: 01/10/2026
// Tabela de metas (visual_type 'metas', 0149) — módulo PURO e client-safe.
//
// A régua ÚNICA do `settings.goalTable`: a action que computa a tabela, o
// construtor e o validador de import da IA passam todos por
// `sanitizeGoalTableSettings` (chave inválida = AVISO + descarte, nunca erro
// duro — o padrão de 07/09/2026 do validador). E `goalTableRequests` é quem
// decide QUAIS séries a tabela pede ao lib/indicators/values.ts — o widget
// nunca monta essa lista por conta própria.
import type { GoalTableRow, GoalTableSettings } from "./types";
import { MAX_TABLE_MONTHS, parseMonthKey } from "@/lib/indicators/model";

export const MAX_GOAL_TABLE_ROWS = 40;
export const MAX_GOAL_TABLE_RESPONSIBLES = 40;

export const GOAL_TABLE_MODE_LABELS = {
  indicadores: "Uma linha por indicador",
  por_responsavel: "Um indicador repartido por responsável",
} as const;

function str(v: unknown, max = 120): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export interface GoalTableSanitizeDeps {
  /** Chaves de meta conhecidas (registry: builtins ∪ goal_metrics ∪ indicadores). */
  knownKeys: Set<string>;
  where: string;
  warnings: string[];
}

export function sanitizeGoalTableSettings(
  raw: unknown,
  deps: GoalTableSanitizeDeps
): GoalTableSettings | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    deps.warnings.push(`${deps.where}: "goalTable" deve ser um objeto — ignorado.`);
    return null;
  }
  const src = raw as Record<string, unknown>;
  const out: GoalTableSettings = {};
  const mode = src.mode === "por_responsavel" ? "por_responsavel" : "indicadores";
  if (src.mode !== undefined && src.mode !== mode) {
    deps.warnings.push(`${deps.where}: "goalTable.mode" desconhecido — usando "indicadores".`);
  }
  out.mode = mode;

  const knownKey = (k: string, ctx: string): boolean => {
    if (deps.knownKeys.has(k)) return true;
    deps.warnings.push(`${deps.where}: ${ctx} "${k}" não é uma meta/indicador conhecido — ignorado.`);
    return false;
  };

  if (mode === "indicadores") {
    const rows: GoalTableRow[] = [];
    const list = Array.isArray(src.rows) ? src.rows : [];
    for (const r of list.slice(0, MAX_GOAL_TABLE_ROWS)) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const indicator = str(rr.indicator, 40);
      if (!indicator || !knownKey(indicator, "indicador")) continue;
      const row: GoalTableRow = { indicator };
      const responsible = str(rr.responsible);
      if (responsible) row.responsible = responsible;
      const label = str(rr.label);
      if (label) row.label = label;
      if (rr.bold === true) row.bold = true;
      rows.push(row);
    }
    out.rows = rows;
  } else {
    const indicator = str(src.indicator, 40);
    if (indicator && knownKey(indicator, "indicador")) out.indicator = indicator;
    const names: string[] = [];
    for (const n of Array.isArray(src.responsibles) ? src.responsibles : []) {
      const name = str(n);
      if (name && !names.includes(name)) names.push(name);
      if (names.length >= MAX_GOAL_TABLE_RESPONSIBLES) break;
    }
    out.responsibles = names;
    const totalRowLabel = str(src.totalRowLabel);
    if (totalRowLabel) out.totalRowLabel = totalRowLabel;
  }

  if (src.months !== undefined) {
    const months: string[] = [];
    for (const m of Array.isArray(src.months) ? src.months : []) {
      if (parseMonthKey(m) && !months.includes(m as string)) months.push(m as string);
      else deps.warnings.push(`${deps.where}: mês "${String(m)}" inválido (use AAAA-MM) — ignorado.`);
      if (months.length >= MAX_TABLE_MONTHS) break;
    }
    if (months.length > 0) out.months = months;
  }
  for (const key of ["showRealized", "showAttainment", "totalColumn", "editable"] as const) {
    if (src[key] !== undefined) out[key] = src[key] === true;
  }
  const headerLabel = str(src.headerLabel, 60);
  if (headerLabel) out.headerLabel = headerLabel;
  const note = str(src.note, 1000);
  if (note) out.note = note;
  return out;
}

/** Uma linha pedida ao resolvedor: indicador + responsável (nome) opcional. */
export interface GoalTableRequestRow {
  id: string;
  indicator: string;
  responsibleName: string | null;
  label: string | null;
  bold: boolean;
}

/**
 * As linhas que a tabela exibe, na ordem. Por responsável: uma linha por nome
 * (o indicador é o mesmo). Sem configuração ⇒ lista vazia (o card explica).
 */
export function goalTableRequests(s: GoalTableSettings | undefined): GoalTableRequestRow[] {
  if (!s) return [];
  if (s.mode === "por_responsavel") {
    if (!s.indicator) return [];
    return (s.responsibles ?? []).map((name, i) => ({
      id: `r${i}`,
      indicator: s.indicator!,
      responsibleName: name,
      label: name,
      bold: false,
    }));
  }
  return (s.rows ?? []).map((r, i) => ({
    id: `i${i}`,
    indicator: r.indicator,
    responsibleName: r.responsible ?? null,
    label: r.label ?? null,
    bold: r.bold === true,
  }));
}

/** Soma de uma coluna (linha de total do modo por responsável). */
export function sumColumn(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  return nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0);
}
