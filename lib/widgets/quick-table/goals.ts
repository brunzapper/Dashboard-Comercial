// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): METAS na Tabela Livre — módulo PURO e client-safe.
//
// A Tabela Livre ganhou três tipos de coluna (rótulo da linha, metas por mês,
// total dos meses) e linhas LIGADAS a um indicador (com responsável e fonte do
// realizado opcionais) ou de TOTAL (soma das metas das ligadas acima). A MESMA
// derivação roda no servidor (o que pedir ao lib/indicators/values.ts) e no
// cliente (a matriz) — pareamento por construção, como `quickTableBI`.
//
// O servidor devolve `QuickTableGoalsData`; as somas (total da linha e linha
// de total) são feitas no CLIENTE sobre as metas otimistas — é o que deixa a
// edição da meta fluir sem esperar o servidor.
import {
  attainment,
  cleanMonthKeys,
  monthLabel,
  rollupMonths,
  type IndicatorDirection,
  type IndicatorRollup,
  type IndicatorStatus,
  type IndicatorUnit,
} from "@/lib/indicators/model";
import type { IndicatorBreakdownRow } from "@/lib/indicators/values";
import type {
  QuickTableColumn,
  QuickTableGoalFacet,
  QuickTableRow,
  QuickTableSettings,
} from "@/lib/widgets/types";

type QuickTable = NonNullable<QuickTableSettings["quickTable"]>;

export const QT_GOAL_FACET_LABELS: Record<QuickTableGoalFacet, string> = {
  composto: "Meta + realizado · atingimento",
  meta: "Só a meta",
  realizado: "Só o realizado",
  atingimento: "Só o atingimento (%)",
};

export const MAX_QT_GOAL_ROWS = 40;

/** Uma célula de mês devolvida pelo servidor. */
export interface QTGoalMonthData {
  target: number | null;
  realized: number | null;
  attainment: number | null;
  status: IndicatorStatus;
  /** Fração decorrida do mês (0 futuro … 1 fechado). */
  elapsed: number;
  error?: string;
}

/** Uma linha ligada, resolvida no servidor. */
export interface QTGoalRowData {
  indicator: string;
  /** Rótulo do indicador (quando a linha não tem rótulo próprio). */
  defaultLabel: string;
  unit: IndicatorUnit;
  rollup: IndicatorRollup;
  direction: IndicatorDirection;
  responsibleName: string | null;
  /** Responsável informado mas não cadastrado (a linha mostra o aviso). */
  responsibleMissing: boolean;
  hasRealized: boolean;
  /** Fórmula do realizado do catálogo, por extenso (o painel da linha explica
   * de onde vem o número); null = o indicador não calcula realizado. */
  formulaText?: string | null;
  /** Por mês (AAAA-MM). */
  months: Record<string, QTGoalMonthData>;
  /** Recortes do realizado marcados para aparecer ("Responsável: Ana"). */
  chips?: string[];
  /** Quebra do realizado por dimensão (alinhada com `QuickTableGoalsData.months`). */
  breakdown?: { label: string; display: "exposto" | "recolhido"; rows: IndicatorBreakdownRow[] };
}

export interface QuickTableGoalsData {
  /** União dos meses de todas as colunas de meta, em ordem. */
  months: string[];
  /** Meses de cada coluna "goal" (id → meses). */
  monthsByCol: Record<string, string[]>;
  /** Linhas ligadas (id da linha → dados). */
  rows: Record<string, QTGoalRowData>;
  /** Admin + `goals.editable`. */
  canEdit: boolean;
  message?: string;
}

export function isGoalColumn(c: QuickTableColumn): boolean {
  return c.kind === "goal" || c.kind === "goalTotal";
}

/** A tabela tem metas? (decide se o servidor resolve indicadores). */
export function quickTableHasGoals(qt: QuickTable | undefined | null): boolean {
  return Boolean(qt?.columns.some((c) => c.kind === "goal"));
}

/** Linhas ligadas a indicador (na ordem). */
export function goalBoundRows(qt: QuickTable): (QuickTableRow & {
  bind: Extract<NonNullable<QuickTableRow["bind"]>, { kind: "indicator" }>;
})[] {
  return qt.rows
    .filter((r) => r.bind?.kind === "indicator" && r.bind.indicator)
    .slice(0, MAX_QT_GOAL_ROWS) as never;
}

/** Meses de uma coluna "goal": fixos (saneados) ou os do período. */
export function goalColumnMonths(c: QuickTableColumn, periodMonths: string[]): string[] {
  const fixed = cleanMonthKeys(c.months ?? []);
  return fixed.length > 0 ? fixed : periodMonths;
}

/** União ordenada dos meses das colunas de meta. */
export function unionMonths(lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort();
}

/** A coluna "goal" que um "goalTotal" soma (padrão: a 1ª). */
export function goalTotalSource(qt: QuickTable, c: QuickTableColumn): QuickTableColumn | null {
  const goals = qt.columns.filter((x) => x.kind === "goal");
  return goals.find((x) => x.id === c.of) ?? goals[0] ?? null;
}

/** Rótulo do cabeçalho de um mês. */
export function goalMonthHeader(c: QuickTableColumn, month: string, multi: boolean): string {
  const m = monthLabel(month);
  return multi && c.header?.trim() ? `${c.header.trim()} · ${m}` : m;
}

/** Totais de UMA linha sobre um conjunto de meses (metas otimistas). */
export function goalRowTotal(
  row: QTGoalRowData,
  months: string[],
  targetOf: (month: string) => number | null
): { target: number | null; realized: number | null; attainment: number | null } {
  const target = rollupMonths(months.map(targetOf), row.rollup);
  const realized = rollupMonths(
    months.map((m) => row.months[m]?.realized ?? null),
    row.rollup
  );
  return { target, realized, attainment: attainment(realized, target, row.direction) };
}

/** Número que a célula expõe (fórmulas A1 leem este valor). */
export function goalFacetValue(
  facet: QuickTableGoalFacet,
  v: { target: number | null; realized: number | null; attainment: number | null }
): number | null {
  if (facet === "realizado") return v.realized;
  if (facet === "atingimento") return v.attainment;
  return v.target;
}

/** "R$ 30.220" → 30220; "23,5" → 23.5; vazio → null (exclui a meta). */
export function parseTypedGoal(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (t === "") return null;
  const norm = t.replace(/\s|R\$|%/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? n : "invalid";
}

/** Chave da meta otimista de uma célula. */
export function goalTargetKey(rowId: string, month: string): string {
  return `${rowId}|${month}`;
}
