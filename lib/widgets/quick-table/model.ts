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
import type {
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
  content: QTCellContent | "data"; // "data" = valor vindo do BI (read-only)
  editable: boolean; // digitável por ESTE usuário (papel × editableRoles)
  numeric: boolean;
}

export interface QTRow {
  key: string; // row_key
  kind: "data" | "free";
  cells: QTCell[]; // alinhadas com QTMatrix.cols
}

export interface QTMatrix {
  cols: QTCol[];
  rows: QTRow[];
  headerRow: boolean;
  loading: boolean; // BI configurado e dados ainda não chegaram (deferred)
  error?: string; // erro do runWidget (exibido no rodapé do card)
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

  // ---- linhas livres ----
  const freeRows: QTRow[] = qt.rows.map((r) => ({
    key: r.id,
    kind: "free" as const,
    cells: orderedCols.map((col) => freeCell(r.id, col)),
  }));

  const rows = [
    ...applyManualOrder(dataRows, tableAp?.rowOrder, (r) => r.key),
    ...applyManualOrder(freeRows, tableAp?.rowOrder, (r) => r.key),
  ];

  return {
    cols: orderedCols,
    rows,
    headerRow: qt.headerRow !== false,
    loading,
    error: data?.error,
  };
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
