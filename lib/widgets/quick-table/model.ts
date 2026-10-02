// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): METAS — colunas "rowLabel" (rótulo da linha), "goal"
//   (expande um mês por coluna, col_key "<colId>@AAAA-MM" — o mesmo esquema do
//   pivot, então ordem manual/aparência por coluna seguem valendo) e
//   "goalTotal"; linhas ligadas a indicador ou de total. A célula de meta é
//   `content: "goal"` com `QTCell.goal` e `value` = o número da faceta (as
//   fórmulas "=…" leem metas por A1 sem caso especial). Dados do servidor em
//   `BuildMatrixInput.goals` (lib/widgets/quick-table/goals.ts).
// Versão: 1.0 | Data: 15/07/2026
// Widget "Tabela Livre" (visual_type 'tabela_editavel'): modelo PURO da grade
// renderizada. A ESTRUTURA (colunas livre/dimensão/métrica + linhas livres)
// vive em widgets.settings.quickTable; os VALORES digitados vivem em
// dashboard_table_cells (row_key/col_key estáveis, nunca índices). O modo BI
// expande LINHAS pelos valores das dimensões (row_key "d:<v1>\u001f<v2>") e,
// com uma dimensão pivot, expande COLUNAS ("<colId>@<valor>") — os valores
// digitados em colunas livres ficam colados às coordenadas da dimensão.
// Conteúdo de célula (valor cru): texto/número | "=…" (fórmula de célula,
// avaliada no cliente — cell-formulas.ts) | "{=…}" (expressão de sistema,
// resolvida no servidor — quick-table-actions.ts).
import { hasAnyRole, isAdmin } from "@/lib/auth/roles";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import { formatBucketLabel } from "@/lib/widgets/date-buckets";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  formatPercent,
  type DateFormat,
} from "@/lib/widgets/format";
import { formatMoney, formatMoneyAggregate } from "@/lib/widgets/currency";
import { applyManualOrder, fracDigits } from "@/lib/widgets/appearance";
import { AGG_LABELS } from "@/lib/widgets/types";
import {
  formatIndicatorValue,
  formatAttainment,
  rollupMonths,
  type IndicatorStatus,
  type IndicatorUnit,
} from "@/lib/indicators/model";
import {
  goalFacetValue,
  goalMonthHeader,
  goalRowTotal,
  goalTargetKey,
  goalTotalSource,
  type QTGoalRowData,
  type QuickTableGoalsData,
} from "./goals";
import type {
  QuickTableGoalFacet,
  QuickTableRow,
  AppearanceSettings,
  CalcWidgetResult,
  QuickTableColumn,
  QuickTableSettings,
  WidgetData,
  WidgetRow,
} from "@/lib/widgets/types";

export type QuickTable = NonNullable<QuickTableSettings["quickTable"]>;

// ===================== chaves estáveis =====================

// Prefixo das linhas de DADOS (modo BI): "d:" + valores das dimensões-linha na
// ordem das colunas de dimensão, unidos por U+001F (unit separator — não
// aparece em texto normal). Linhas livres usam o id "qr_…".
export const QT_DATA_ROW_PREFIX = "d:";
const DIM_SEP = "\u001f";

const randSuffix = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function newColId(): string {
  return `qc_${randSuffix()}`;
}
export function newRowId(): string {
  return `qr_${randSuffix()}`;
}

/** row_key de uma linha de dados BI (valores das dimensões-linha, em ordem). */
export function dataRowKey(dimValues: (string | null | undefined)[]): string {
  return QT_DATA_ROW_PREFIX + dimValues.map((v) => v ?? "").join(DIM_SEP);
}

/** col_key de uma coluna gerada por pivot (métrica × valor da dimensão pivot). */
export function pivotColKey(colId: string, pivotValue: string): string {
  return `${colId}@${pivotValue}`;
}

/** Id da coluna configurada por trás de um col_key (strip do sufixo de pivot). */
export function baseColId(colKey: string): string {
  const i = colKey.indexOf("@");
  return i < 0 ? colKey : colKey.slice(0, i);
}

/** Chave composta de uma célula (mesma convenção da aparência: cellColors). */
export function cellKey(rowKey: string, colKey: string): string {
  return `${rowKey}:${colKey}`;
}

/** Tabela padrão rows×cols (colunas livres sem rótulo). */
export function defaultQuickTable(rows: number, cols: number): QuickTable {
  const nCols = Math.max(1, Math.min(26, Math.round(cols)));
  const nRows = Math.max(1, Math.min(100, Math.round(rows)));
  return {
    columns: Array.from({ length: nCols }, () => ({
      id: newColId(),
      kind: "free" as const,
    })),
    rows: Array.from({ length: nRows }, () => ({ id: newRowId() })),
  };
}

// ===================== conteúdo de célula =====================

export type QTCellContent = "blank" | "text" | "formula" | "expr";

/** Classifica o valor cru digitado: fórmula "=…", expressão "{=…}" ou texto. */
export function classifyCellRaw(raw: string): QTCellContent {
  const s = raw.trim();
  if (!s) return "blank";
  if (/^\{=[\s\S]*\}$/.test(s)) return "expr";
  if (s.startsWith("=")) return "formula";
  return "text";
}

/** Fonte da expressão de sistema dentro de "{= … }" (sem as chaves). */
export function exprSource(raw: string): string {
  const s = raw.trim();
  return s.slice(2, -1).trim();
}

/** Exibição de um resultado de expressão do servidor (mesma regra da Nota). */
export function calcResultDisplay(
  r: CalcWidgetResult | null | undefined,
  decimals?: number
): string {
  if (!r) return "…"; // ainda carregando (deferred)
  if (r.value == null) {
    return r.text != null && r.text !== "" ? r.text : "—";
  }
  return r.currency
    ? formatMoney(r.value, r.currency, decimals)
    : r.value.toLocaleString("pt-BR", fracDigits(decimals));
}

// ===================== config BI derivada das colunas =====================

export interface QuickTableBI {
  rowDims: QuickTableColumn[]; // dimensões que expandem LINHAS (ordem de exibição)
  pivotDim: QuickTableColumn | null; // no máx. 1 dimensão expande COLUNAS
  metricCols: QuickTableColumn[]; // métricas (ordem de exibição)
  hasBI: boolean; // alguma coluna de dados configurada e completa
}

// Deriva a configuração BI das colunas. A MESMA função roda no servidor
// (runQuickTable monta dimensions/metrics do runWidget nesta ordem: rowDims…,
// pivotDim por último) e no cliente (a matriz mapeia dim_<n>/metric_<n> de
// volta às colunas) — mantendo o pareamento por construção.
export function quickTableBI(qt: QuickTable): QuickTableBI {
  const dims = qt.columns.filter((c) => c.kind === "dimension" && c.field);
  const pivotDim = dims.find((c) => c.pivot) ?? null;
  const rowDims = dims.filter((c) => c !== pivotDim);
  const metricCols = qt.columns.filter(
    (c) => c.kind === "metric" && c.metric?.field
  );
  return {
    rowDims,
    pivotDim,
    metricCols,
    hasBI: rowDims.length > 0 || pivotDim != null || metricCols.length > 0,
  };
}

// ===================== matriz de renderização =====================

export interface QTCol {
  key: string; // col_key (id da coluna ou id@valorPivot)
  column: QuickTableColumn; // coluna configurada por trás
  label: string; // texto do cabeçalho
  numeric: boolean; // default de alinhamento (métrica = true)
  /** v1.1: mês (AAAA-MM) de uma coluna de meta expandida. */
  goalMonth?: string;
}

/** v1.1: o que uma célula de meta mostra. */
export interface QTGoalView {
  /** month = um mês; total = total dos meses da linha; sum = linha de total. */
  kind: "month" | "total" | "sum";
  month?: string;
  target: number | null;
  realized: number | null;
  attainment: number | null;
  status: IndicatorStatus;
  elapsed: number;
  unit: IndicatorUnit;
  hasRealized: boolean;
  error?: string;
  /** Admin edita a meta desta célula. */
  editable: boolean;
  facet: QuickTableGoalFacet;
}

/** v1.1: dados de exibição de uma linha com metas. */
export interface QTRowGoalView {
  label: string;
  tag: string | null;
  bold: boolean;
  unit: IndicatorUnit;
  unitMode: "auto" | "show" | "hide";
  responsibleMissing: boolean;
  hasRealized: boolean;
  /** Linha de total (soma das ligadas acima). */
  isTotal: boolean;
  chips: string[];
  breakdown?: QTGoalRowData["breakdown"];
}

export interface QTCell {
  rowKey: string;
  colKey: string;
  // Valor cru digitado (células livres) — é o que a edição mostra/regrava.
  raw: string | null;
  display: string; // texto exibido (fórmulas "=…" são sobrepostas no cliente)
  // Valor "de máquina" p/ as fórmulas de célula (cell-formulas.ts): número da
  // métrica, valor da dimensão, texto/número digitado ou o resultado de {=…}.
  // Fórmulas "=…" ficam null aqui (o valor delas é computado no cliente).
  value: number | string | boolean | null;
  // "data" = valor vindo do BI (read-only); v1.1: "label" = rótulo da linha,
  // "goal" = célula de meta (QTCell.goal).
  content: QTCellContent | "data" | "label" | "goal";
  goal?: QTGoalView;
  editable: boolean; // digitável por ESTE usuário (papel × editableRoles)
  numeric: boolean;
}

export interface QTRow {
  key: string; // row_key
  kind: "data" | "free";
  cells: QTCell[]; // alinhadas com QTMatrix.cols
  /** v1.1: linha ligada a indicador / de total. */
  goal?: QTRowGoalView;
}

export interface QTMatrix {
  cols: QTCol[];
  rows: QTRow[];
  headerRow: boolean;
  loading: boolean; // BI configurado e dados ainda não chegaram (deferred)
  error?: string; // erro do runWidget (exibido no rodapé do card)
  /** v1.1: há colunas de meta e os dados delas ainda não chegaram. */
  goalsLoading?: boolean;
  goalsMessage?: string;
}

export interface QTCellValue {
  row_key: string;
  col_key: string;
  value: number | string | null;
}

// Papel do usuário permite digitar nesta coluna livre? Ausente = todos os
// visualizadores; [] = ninguém. Admin sempre pode.
export function canTypeInColumn(
  column: QuickTableColumn,
  userRoles: string[]
): boolean {
  if (column.kind !== "free") return false;
  if (isAdmin(userRoles)) return true;
  if (!column.editableRoles) return true;
  return hasAnyRole(userRoles, column.editableRoles);
}

// Rótulo padrão de uma coluna de métrica (mesma convenção do builder).
function metricLabel(c: QuickTableColumn, available: AvailableField[]): string {
  if (c.header?.trim()) return c.header.trim();
  const m = c.metric!;
  if (m.label?.trim()) return m.label.trim();
  if (m.field === "*") return "Contagem de registros";
  return `${AGG_LABELS[m.agg] ?? m.agg} · ${fieldLabel(m.field, available)}`;
}

function dimLabel(c: QuickTableColumn, available: AvailableField[]): string {
  return c.header?.trim() || fieldLabel(c.field ?? "", available);
}

// Exibição do valor de uma dimensão vindo do RPC: buckets de data formatados
// pelo transform; datas ISO cruas pela máscara do dashboard; resto literal.
function dimDisplay(
  c: QuickTableColumn,
  value: unknown,
  isDateField: boolean,
  dateFmt: DateFormat
): string {
  if (value == null || value === "") return "—";
  if (isDateField && c.transform && c.transform !== "none") {
    return formatBucketLabel(c.transform, value, c.weekMode ?? "restricted");
  }
  if (isDateField) return formatDateValue(value, dateFmt);
  return String(value);
}

function toFiniteNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Exibição do valor de uma métrica de uma linha do WidgetData (moeda via
// __money; percentual carimbado pelo engine; senão número pt-BR).
function metricDisplay(
  row: WidgetRow,
  key: string,
  info: WidgetData["metrics"][number] | undefined,
  agg: string,
  decimals?: number
): string {
  const bd = row.__money?.[key];
  if (info?.isMoney && bd) return formatMoneyAggregate(bd, { agg }, false, decimals);
  const v = row[key];
  if (v == null || v === "") return "—";
  if (info?.percent) return formatPercent(v, true, decimals);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("pt-BR", fracDigits(decimals));
}

export interface BuildMatrixInput {
  qt: QuickTable;
  // Valores digitados (dashboard_table_cells do widget, sem rows reservadas).
  cells: QTCellValue[];
  // Resultado BI deferido: undefined = carregando; null = sem colunas BI.
  data?: WidgetData | null;
  // Resultados das expressões {=…} por chave de célula ("rowKey:colKey").
  exprValues?: Record<string, CalcWidgetResult>;
  userRoles: string[];
  available: AvailableField[];
  // Ordens manuais/aparência (columnOrder/rowOrder) — mesmas chaves das células.
  tableAp?: AppearanceSettings["table"];
  dateFormat?: DateFormat;
  // Casas decimais do widget (AppearanceSettings.decimals) — números/moeda/
  // percentual das células BI e resultados de expressão.
  decimals?: number;
  // v1.1: metas resolvidas no servidor. undefined = carregando; null = sem
  // metas (ou indisponível, ex.: link público).
  goals?: QuickTableGoalsData | null;
  // v1.1: metas digitadas que o servidor ainda não devolveu ("row|mês").
  goalTargets?: Record<string, number | null>;
}

// Monta a grade renderizada: cabeçalhos (com expansão de pivot), linhas de
// dados BI (na ordem do WidgetData) e depois as linhas livres (boas p/ totais).
export function buildQuickTableMatrix(input: BuildMatrixInput): QTMatrix {
  const {
    qt,
    cells,
    data,
    exprValues = {},
    userRoles,
    available,
    tableAp,
    dateFormat,
    decimals,
    goals,
    goalTargets = {},
  } = input;
  const dateFmt = dateFormat ?? DEFAULT_DATE_FORMAT;
  const bi = quickTableBI(qt);
  const loading = bi.hasBI && data === undefined;

  const cellByKey = new Map<string, string>();
  for (const c of cells) {
    if (c.value == null || c.value === "") continue;
    cellByKey.set(cellKey(c.row_key, c.col_key), String(c.value));
  }

  // ---- colunas exibidas (na ordem configurada, expandindo o pivot) ----
  // Chaves dim_<n>/metric_<n> do WidgetData: dims na ordem [rowDims…, pivotDim].
  const dimKeyOf = new Map<string, string>(); // column.id -> dim_<n>
  bi.rowDims.forEach((c, i) => dimKeyOf.set(c.id, `dim_${i + 1}`));
  const pivotDimKey = bi.pivotDim ? `dim_${bi.rowDims.length + 1}` : null;
  const metricKeyOf = new Map<string, string>(); // column.id -> metric_<n>
  bi.metricCols.forEach((c, i) => metricKeyOf.set(c.id, `metric_${i + 1}`));

  // Valores distintos do pivot, na ordem em que aparecem nos dados.
  const pivotValues: string[] = [];
  if (bi.pivotDim && pivotDimKey && data) {
    const seen = new Set<string>();
    for (const row of data.rows) {
      const v = String(row[pivotDimKey] ?? "");
      if (!seen.has(v)) {
        seen.add(v);
        pivotValues.push(v);
      }
    }
  }

  const isDateFieldOf = (c: QuickTableColumn) =>
    available.find((a) => a.field === c.field)?.isDate ?? false;

  const cols: QTCol[] = [];
  const multiGoal = qt.columns.filter((c) => c.kind === "goal").length > 1;
  for (const c of qt.columns) {
    if (c.kind === "dimension" && c.pivot && c === bi.pivotDim) {
      // A coluna pivot em si não aparece: seus valores viram colunas de métrica.
      // Sem métricas configuradas não há o que expandir — ignorada.
      continue;
    }
    if (c.kind === "metric" && c.metric?.field && bi.pivotDim) {
      // Pivot: cada métrica × valor da dimensão pivot vira uma coluna.
      const info = data?.metrics.find((m) => m.key === metricKeyOf.get(c.id));
      const base = metricLabel(c, available);
      if (pivotValues.length === 0) {
        // Sem dados (ou carregando): mantém a coluna base como placeholder.
        cols.push({ key: c.id, column: c, label: base, numeric: true });
      } else {
        for (const pv of pivotValues) {
          const pvLabel = bi.pivotDim
            ? dimDisplay(bi.pivotDim, pv, isDateFieldOf(bi.pivotDim), dateFmt)
            : pv;
          cols.push({
            key: pivotColKey(c.id, pv),
            column: c,
            label:
              bi.metricCols.length > 1 ? `${pvLabel} · ${base}` : pvLabel,
            numeric: true,
          });
        }
      }
      void info;
      continue;
    }
    if (c.kind === "metric" && c.metric?.field) {
      cols.push({
        key: c.id,
        column: c,
        label: metricLabel(c, available),
        numeric: true,
      });
      continue;
    }
    if (c.kind === "dimension" && c.field) {
      cols.push({
        key: c.id,
        column: c,
        label: dimLabel(c, available),
        numeric: false,
      });
      continue;
    }
    // v1.1: metas.
    if (c.kind === "rowLabel") {
      cols.push({ key: c.id, column: c, label: c.header ?? "", numeric: false });
      continue;
    }
    if (c.kind === "goal") {
      const months = goals?.monthsByCol[c.id] ?? [];
      if (months.length === 0) {
        cols.push({ key: c.id, column: c, label: c.header ?? "Metas", numeric: true });
      } else {
        for (const m of months) {
          cols.push({
            key: pivotColKey(c.id, m),
            column: c,
            label: goalMonthHeader(c, m, multiGoal),
            numeric: true,
            goalMonth: m,
          });
        }
      }
      continue;
    }
    if (c.kind === "goalTotal") {
      cols.push({ key: c.id, column: c, label: c.header ?? "Total", numeric: true });
      continue;
    }
    // Coluna livre (ou dimensão/métrica incompleta — tratada como livre).
    cols.push({
      key: c.id,
      column: c,
      label: c.header ?? "",
      numeric: false,
    });
  }
  const orderedCols = applyManualOrder(cols, tableAp?.columnOrder, (c) => c.key);

  // ---- células livres/digitadas (compartilhado entre linhas data e free) ----
  const freeCell = (rowKey: string, col: QTCol): QTCell => {
    const raw = cellByKey.get(cellKey(rowKey, col.key)) ?? null;
    const content = raw == null ? "blank" : classifyCellRaw(raw);
    let display = raw ?? "";
    let value: QTCell["value"] = raw;
    if (content === "expr") {
      const r = exprValues[cellKey(rowKey, col.key)];
      display = calcResultDisplay(r, decimals);
      value = r ? (r.value ?? r.text ?? null) : null;
    } else if (content === "formula") {
      value = null; // computado no cliente (cell-formulas.ts)
    }
    return {
      rowKey,
      colKey: col.key,
      raw,
      display,
      value,
      content,
      editable: canTypeInColumn(col.column, userRoles),
      numeric: false,
    };
  };

  // ---- linhas de dados (modo BI) ----
  const dataRows: QTRow[] = [];
  if (bi.hasBI && data && data.rows.length > 0) {
    // Agrupa as linhas do WidgetData pelas dimensões-linha (com pivot, várias
    // linhas do RPC — uma por valor do pivot — colapsam numa linha da grade).
    const groups = new Map<string, WidgetRow[]>();
    const orderKeys: string[] = [];
    for (const row of data.rows) {
      const rk = dataRowKey(
        bi.rowDims.map((c) => {
          const v = row[dimKeyOf.get(c.id)!];
          return v == null ? "" : String(v);
        })
      );
      if (!groups.has(rk)) {
        groups.set(rk, []);
        orderKeys.push(rk);
      }
      groups.get(rk)!.push(row);
    }

    for (const rk of orderKeys) {
      const rows = groups.get(rk)!;
      const first = rows[0];
      const cellsOut: QTCell[] = orderedCols.map((col) => {
        const c = col.column;
        if (c.kind === "dimension" && c.field && dimKeyOf.has(c.id)) {
          const v = first[dimKeyOf.get(c.id)!];
          const display = dimDisplay(c, v, isDateFieldOf(c), dateFmt);
          return {
            rowKey: rk,
            colKey: col.key,
            raw: null,
            display,
            value: display === "—" ? null : display,
            content: "data",
            editable: false,
            numeric: false,
          };
        }
        if (c.kind === "metric" && c.metric?.field) {
          const mKey = metricKeyOf.get(c.id)!;
          const info = data.metrics.find((m) => m.key === mKey);
          // Com pivot, o valor vem da linha do RPC cujo pivot casa com a coluna.
          const at = col.key.indexOf("@");
          const srcRow =
            at < 0 || !pivotDimKey
              ? first
              : rows.find(
                  (r) => String(r[pivotDimKey] ?? "") === col.key.slice(at + 1)
                );
          const num = srcRow == null ? null : toFiniteNumber(srcRow[mKey]);
          return {
            rowKey: rk,
            colKey: col.key,
            raw: null,
            display: srcRow
              ? metricDisplay(srcRow, mKey, info, c.metric!.agg, decimals)
              : "—",
            value: num,
            content: "data",
            editable: false,
            numeric: true,
          };
        }
        // Coluna livre numa linha de dados: digitável, keyed pela dimensão.
        return freeCell(rk, col);
      });
      dataRows.push({ key: rk, kind: "data", cells: cellsOut });
    }
  }

  // ---- linhas livres (v1.1: rótulo e metas) ----
  const goalCtx = buildGoalContext(qt, goals, goalTargets);
  const freeRows: QTRow[] = qt.rows.map((r, ri) => {
    const view = goalCtx.rowView(r, ri);
    return {
      key: r.id,
      kind: "free" as const,
      cells: orderedCols.map((col) => {
        const k = col.column.kind;
        if (k === "rowLabel") {
          const label = view?.label ?? r.label ?? "";
          return {
            rowKey: r.id,
            colKey: col.key,
            raw: null,
            display: label,
            value: label || null,
            content: "label" as const,
            editable: false,
            numeric: false,
          };
        }
        if (k === "goal" || k === "goalTotal") {
          const g = goalCtx.cell(r, ri, col);
          if (!g) {
            return {
              rowKey: r.id,
              colKey: col.key,
              raw: null,
              display: "",
              value: null,
              content: "blank" as const,
              editable: false,
              numeric: true,
            };
          }
          return {
            rowKey: r.id,
            colKey: col.key,
            raw: null,
            display: goalCellText(g),
            value: goalFacetValue(g.facet, g),
            content: "goal" as const,
            goal: g,
            editable: false,
            numeric: true,
          };
        }
        return freeCell(r.id, col);
      }),
      ...(view ? { goal: view } : {}),
    };
  });

  const rows = [
    ...applyManualOrder(dataRows, tableAp?.rowOrder, (r) => r.key),
    ...applyManualOrder(freeRows, tableAp?.rowOrder, (r) => r.key),
  ];

  const hasGoalCols = qt.columns.some((c) => c.kind === "goal");
  return {
    cols: orderedCols,
    rows,
    headerRow: qt.headerRow !== false,
    loading,
    error: data?.error,
    ...(hasGoalCols && goals === undefined ? { goalsLoading: true } : {}),
    ...(hasGoalCols && goals?.message ? { goalsMessage: goals.message } : {}),
  };
}

// ===================== metas (v1.1) =====================

/** Texto simples de uma célula de meta (a grade de planilha e o export). */
export function goalCellText(g: QTGoalView): string {
  if (g.facet === "atingimento") return formatAttainment(g.attainment);
  if (g.facet === "realizado") return formatIndicatorValue(g.realized, g.unit);
  return formatIndicatorValue(g.target, g.unit);
}

function buildGoalContext(
  qt: QuickTable,
  goals: QuickTableGoalsData | null | undefined,
  goalTargets: Record<string, number | null>
) {
  const targetOf = (rowId: string, month: string): number | null => {
    const k = goalTargetKey(rowId, month);
    if (k in goalTargets) return goalTargets[k];
    return goals?.rows[rowId]?.months[month]?.target ?? null;
  };
  // Linhas ligadas ACIMA de cada linha de total (na ordem configurada).
  const boundAbove = (ri: number) =>
    qt.rows
      .slice(0, ri)
      .filter((x) => x.bind?.kind === "indicator" && goals?.rows[x.id]);
  const monthsOfCol = (col: QTCol): string[] => {
    if (col.column.kind === "goal") return col.goalMonth ? [col.goalMonth] : [];
    const src = goalTotalSource(qt, col.column);
    return src ? (goals?.monthsByCol[src.id] ?? []) : [];
  };

  const rowView = (r: QuickTableRow, ri: number): QTRowGoalView | null => {
    if (!r.bind) return null;
    if (r.bind.kind === "total") {
      const first = boundAbove(ri)[0];
      return {
        label: r.label ?? "Total",
        tag: r.tag ?? null,
        bold: r.bold !== false,
        unit: first ? goals!.rows[first.id].unit : "quantidade",
        unitMode: r.unit ?? "auto",
        responsibleMissing: false,
        hasRealized: false,
        isTotal: true,
        chips: [],
      };
    }
    const gr = goals?.rows[r.id];
    return {
      label: r.label?.trim() || gr?.defaultLabel || r.bind.indicator,
      tag: r.tag ?? null,
      bold: r.bold === true,
      unit: gr?.unit ?? "quantidade",
      unitMode: r.unit ?? "auto",
      responsibleMissing: gr?.responsibleMissing ?? false,
      hasRealized: gr?.hasRealized ?? false,
      isTotal: false,
      chips: gr?.chips ?? [],
      ...(gr?.breakdown ? { breakdown: gr.breakdown } : {}),
    };
  };

  const cell = (r: QuickTableRow, ri: number, col: QTCol): QTGoalView | null => {
    if (!goals || !r.bind) return null;
    const facet: QuickTableGoalFacet = col.column.facet ?? "composto";
    const months = monthsOfCol(col);
    if (months.length === 0) return null;
    if (r.bind.kind === "total") {
      const rows = boundAbove(ri);
      if (rows.length === 0) return null;
      const sums = months.map((m) => {
        const vals = rows.map((x) => targetOf(x.id, m)).filter((v): v is number => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
      });
      return {
        kind: "sum",
        ...(col.goalMonth ? { month: col.goalMonth } : {}),
        target: rollupMonths(sums, "soma"),
        realized: null,
        attainment: null,
        status: "sem_dado",
        elapsed: 0,
        unit: goals.rows[rows[0].id].unit,
        hasRealized: false,
        editable: false,
        facet,
      };
    }
    const gr = goals.rows[r.id];
    if (!gr) return null;
    if (col.column.kind === "goal" && col.goalMonth) {
      const m = col.goalMonth;
      const d = gr.months[m];
      return {
        kind: "month",
        month: m,
        target: targetOf(r.id, m),
        realized: d?.realized ?? null,
        attainment: d?.attainment ?? null,
        status: d?.status ?? "sem_dado",
        elapsed: d?.elapsed ?? 0,
        unit: gr.unit,
        hasRealized: gr.hasRealized,
        ...(d?.error ? { error: d.error } : {}),
        editable: goals.canEdit && !gr.responsibleMissing,
        facet,
      };
    }
    const tot = goalRowTotal(gr, months, (m) => targetOf(r.id, m));
    return {
      kind: "total",
      ...tot,
      status: "sem_dado",
      elapsed: months.some((m) => (gr.months[m]?.elapsed ?? 0) > 0) ? 1 : 0,
      unit: gr.unit,
      hasRealized: gr.hasRealized,
      editable: false,
      facet,
    };
  };

  return { rowView, cell };
}

// Rótulo do pivot reutilizado acima; exportado p/ o painel de coluna exibir a
// dimensão pivot mesmo sem dados carregados.
export function formatDimBucket(
  transform: Parameters<typeof formatBucketLabel>[0] | undefined,
  value: unknown
): string {
  if (!transform || transform === "none") return String(value ?? "—");
  return formatBucketLabel(transform, value);
}
