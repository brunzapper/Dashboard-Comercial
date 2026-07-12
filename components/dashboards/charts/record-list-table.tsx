// Versão: 3.0 | Data: 11/07/2026
// Widget de Tabela em modo "registros individuais" (Fonte das linhas = Registros).
// Uma linha por registro; colunas do núcleo read-only, colunas personalizadas
// NÃO calculadas editáveis por padrão (respeitando editable_by_roles do campo).
// v3.0 (11/07/2026): datas formatadas (dd/mm/aaaa | dd/mm/aa | mm/aa) com padrão
//   global do dashboard + override por coluna; edição de custom por padrão (sem a
//   antiga caixa "editável"); duplo-clique numa data abre calendário; largura de
//   coluna e altura de linha redimensionáveis na edição de layout.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EditableCell } from "@/components/registros/editable-cell";
import { CoreEditableCell } from "@/components/registros/core-editable-cell";
import { RelationEditableCell } from "@/components/registros/relation-editable-cell";
import {
  NUMERIC_DATA_TYPES,
  type FieldDefinition,
  type RecordRow,
} from "@/lib/records/types";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import {
  buildRecordBreakdown,
  formatMoney,
  formatMoneyAggregate,
  formatMoneyDisplay,
  resolveCurrencyCode,
  resolveFieldMoney,
  yearQuarterOf,
  type CurrencyRates,
} from "@/lib/widgets/currency";
import {
  EDITABLE_CORE_COLUMNS,
  isEditableCoreColumn,
  isEditableRelation,
} from "@/lib/config/core-writeback";
import { AGG_LABELS, DATE_AGG_LABELS } from "@/lib/widgets/types";
import { bucketRecordDate } from "@/lib/widgets/date-buckets";
import {
  applyManualOrder,
  distinctFills,
  groupByLevels,
  reorderKeys,
} from "@/lib/widgets/appearance";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  type DateFormat,
} from "@/lib/widgets/format";
import type {
  AppearanceSettings,
  ColorPair,
  DateAgg,
  Metric,
  RecordListColumn,
} from "@/lib/widgets/types";
import {
  ColorOrderDialog,
  ColorPopover,
  ContextMenu,
  ResizeHandle,
  type ColorScope,
} from "../appearance-editing";

const FK_FIELDS = new Set(["responsible_id", "operation_id", "related_lead_id"]);
const MONEY_FIELDS = new Set(["value", "mrr"]);
const DATE_FIELDS = new Set(["closed_at", "opened_at", "source_created_at"]);

// Valor monetário na moeda do registro (quando informada); sem moeda cai em BRL.
// Usado tanto para células por registro (com r.currency) quanto para subtotais
// agregados (sem moeda — podem misturar registros de moedas diferentes).
function money(v: unknown, currency?: string | null): string {
  return formatMoney(v, currency);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Moda: valor mais frequente (empate → o menor). Só faz sentido p/ números aqui.
function mode(nums: number[]): number {
  if (nums.length === 0) return 0;
  const count = new Map<number, number>();
  let best = nums[0];
  let bestCount = 0;
  for (const n of nums) {
    const c = (count.get(n) ?? 0) + 1;
    count.set(n, c);
    if (c > bestCount || (c === bestCount && n < best)) {
      best = n;
      bestCount = c;
    }
  }
  return best;
}

function coreDisplay(
  field: string,
  record: RecordRow,
  fkLabels: Record<string, string>,
  dateFmt: DateFormat
): string {
  const v = (record as unknown as Record<string, unknown>)[field];
  if (FK_FIELDS.has(field)) return v ? (fkLabels[String(v)] ?? "—") : "—";
  if (MONEY_FIELDS.has(field)) return money(v, record.currency);
  if (field === "closed") return v ? "Sim" : "Não";
  if (DATE_FIELDS.has(field)) return v ? formatDateValue(v, dateFmt) : "—";
  return v == null || v === "" ? "—" : String(v);
}

function rawValue(field: string, record: RecordRow): unknown {
  if (field.startsWith("custom:")) return record.custom_fields?.[field.slice(7)];
  return (record as unknown as Record<string, unknown>)[field];
}

type Menu =
  | { kind: "ctx"; x: number; y: number; column: string; rowKey?: string; scopes: ColorScope[]; isDate: boolean; group?: boolean }
  | { kind: "color"; x: number; y: number; scope: ColorScope; column: string; rowKey?: string; group?: boolean }
  | { kind: "colorOrder"; x: number; y: number; column: string };

// Opção do SELECT de responsável (coluna responsible_id editável). `bitrixLinked`
// marca os responsáveis com vínculo no Bitrix (bitrix_user_id) — os únicos
// oferecidos quando a coluna grava de volta no Bitrix (writeBack).
export type ResponsibleOption = {
  value: string;
  label: string;
  bitrixLinked?: boolean;
};

export function RecordListTable({
  records,
  columns,
  metrics = [],
  fields,
  available,
  userRoles,
  canEditValues,
  fkLabels,
  responsibleOptions = [],
  appearance,
  dateFormat,
  currencyRates = {},
  conversionPeriod,
  canEdit = false,
  onAppearanceChange,
}: {
  records: RecordRow[];
  columns: RecordListColumn[];
  metrics?: Metric[];
  fields: FieldDefinition[];
  available: AvailableField[];
  userRoles: string[];
  canEditValues: boolean;
  fkLabels: Record<string, string>;
  // Responsáveis ativos (id→nome) para o SELECT da coluna responsible_id editável.
  responsibleOptions?: ResponsibleOption[];
  appearance?: AppearanceSettings;
  dateFormat?: DateFormat;
  currencyRates?: CurrencyRates;
  // Ano/trimestre do período do widget (p/ métricas com base = "período").
  conversionPeriod?: { year: number; quarter: number };
  canEdit?: boolean;
  onAppearanceChange?: (a: AppearanceSettings) => void;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const ap = appearance ?? {};
  const t = ap.table ?? {};
  const editable = canEdit && Boolean(onAppearanceChange);
  const change = onAppearanceChange ?? (() => {});
  const dashFmt = dateFormat ?? DEFAULT_DATE_FORMAT;

  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [page, setPage] = useState(1);
  // Grupos EXPANDIDOS no "Agrupar por" (efêmero). Vazio = tudo colapsado, então a
  // visualização padrão de uma tabela agrupada abre sempre recolhida.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const baseCols = columns.filter((c) => c.field);
  const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));
  const cols = applyManualOrder(baseCols, t.columnOrder, (c) => c.field);

  // Métricas do widget (mesmo comportamento do agregado): uma coluna por métrica,
  // com o valor cru por registro e o agregado (sum/count/avg) nas linhas de total.
  const metricList = metrics.filter((m) => m.field);
  const metricLabel = (m: Metric) =>
    m.label?.trim() || `${AGG_LABELS[m.agg]} · ${fieldLabel(m.field, available)}`;

  // Lista única de colunas (dimensões + métricas) reordenável em conjunto, igual
  // à tabela agregada: métricas podem ser arrastadas para qualquer posição,
  // inclusive intercaladas às dimensões. Cada métrica recebe uma chave estável
  // (prefixo __metric:) para participar do columnOrder sem colidir com o c.field
  // das dimensões; o índice desambigua métricas idênticas. Métricas ficam fora do
  // columnOrder salvo em configs antigos, então applyManualOrder as anexa após as
  // dimensões — preservando o layout atual sem migração.
  const metricKey = (m: Metric, i: number) => `__metric:${m.field}:${m.agg}:${i}`;
  type MergedCol =
    | { kind: "dim"; key: string; c: RecordListColumn }
    | { kind: "metric"; key: string; m: Metric; mi: number };
  const mergedCols: MergedCol[] = applyManualOrder(
    [
      ...baseCols.map((c) => ({ kind: "dim" as const, key: c.field, c })),
      ...metricList.map((m, mi) => ({
        kind: "metric" as const,
        key: metricKey(m, mi),
        m,
        mi,
      })),
    ],
    t.columnOrder,
    (x) => x.key
  );
  // Rótulo (estético) do cabeçalho de uma coluna: nome exibido > rótulo do campo.
  const colLabel = (c: RecordListColumn) =>
    c.label?.trim() || fieldLabel(c.field, available);
  // Métrica monetária (value/mrr ou campo moeda/calc-moeda).
  const metricIsMoney = (field: string): boolean =>
    available.find((a) => a.field === field)?.isMoney ?? false;
  // Moeda de um valor de métrica num registro.
  const metricCurrency = (field: string, r: RecordRow): string => {
    if (field.startsWith("custom:")) {
      const f = fieldByKey.get(field.slice(7));
      return f ? resolveFieldMoney(f, r.currency).code : resolveCurrencyCode(r.currency);
    }
    return resolveCurrencyCode(r.currency);
  };
  // Ano/trimestre da taxa a usar p/ um registro, respeitando a "Base da taxa" da
  // métrica: "período" usa o ano/trim do filtro do dashboard (igual p/ todos);
  // "registro" usa a data do registro (fechamento → abertura → criação → hoje).
  const recYQ = (r: RecordRow, m: Metric): { year: number; quarter: number } => {
    const isQuarter = m.conversionBasis?.granularity === "quarter";
    if (m.conversionBasis?.source === "period" && conversionPeriod) {
      return {
        year: conversionPeriod.year,
        quarter: isQuarter ? conversionPeriod.quarter : 0,
      };
    }
    const { year, quarter } = yearQuarterOf(
      r.closed_at ?? r.opened_at ?? r.source_created_at
    );
    return { year, quarter: isQuarter ? quarter : 0 };
  };

  const metricCellText = (m: Metric, r: RecordRow): string => {
    if (m.field === "*") return "";
    const n = Number(rawValue(m.field, r));
    if (!Number.isFinite(n)) return "—";
    if (!metricIsMoney(m.field)) return n.toLocaleString("pt-BR");
    const code = metricCurrency(m.field, r);
    const { year, quarter } = recYQ(r, m);
    return formatMoneyDisplay(
      n,
      code,
      m.currencyDisplay ?? "original",
      currencyRates,
      year,
      quarter
    );
  };
  const metricAgg = (m: Metric, rs: RecordRow[]): number => {
    if (m.agg === "count") {
      if (m.field === "*") return rs.length;
      return rs.reduce((c, r) => {
        const v = rawValue(m.field, r);
        return v != null && v !== "" ? c + 1 : c;
      }, 0);
    }
    const nums = rs
      .map((r) => Number(rawValue(m.field, r)))
      .filter((n) => Number.isFinite(n));
    const sum = nums.reduce((s, n) => s + n, 0);
    if (m.agg === "avg") return nums.length ? sum / nums.length : 0;
    return sum;
  };
  // Subtotal/total de uma métrica sobre `rs`, aplicando conversão/modos de moeda
  // quando a métrica é monetária. `isGrand` usa o modo do Total geral.
  const metricAggText = (m: Metric, rs: RecordRow[], isGrand = false): string => {
    if (m.agg === "count" || m.field === "*") {
      return metricAgg(m, rs).toLocaleString("pt-BR");
    }
    if (!metricIsMoney(m.field)) {
      return metricAgg(m, rs).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    }
    // Agregação monetária: acumula por moeda + convertido (R$) + referência (US$),
    // convertendo cada registro pela taxa do seu próprio ano/trimestre. Helper
    // compartilhado com o caminho agregado (engine), garantindo saída idêntica.
    const bd = buildRecordBreakdown(
      rs,
      (r) => rawValue(m.field, r),
      (r) => metricCurrency(m.field, r),
      (r) => recYQ(r, m),
      currencyRates
    );
    return formatMoneyAggregate(bd, m, isGrand);
  };

  // Valor de uma coluna do núcleo como string (para o editor inline do núcleo).
  const coreString = (field: string, r: RecordRow): string => {
    if (field === "closed") return rawValue(field, r) ? "true" : "false";
    const v = rawValue(field, r);
    return v == null ? "" : String(v);
  };

  // Rótulo de uma coluna de data com formato (transform): "Janeiro", "T1/26"…
  const columnDateLabel = (c: RecordListColumn, r: RecordRow): string => {
    const raw = rawValue(c.field, r);
    if (raw == null || raw === "") return "—";
    return bucketRecordDate(raw, c.transform!, c.weekMode).label;
  };

  // Coluna de agrupamento por período: a 1ª coluna de data com agg != individual.
  const groupCol = cols.find(
    (c) => c.transform && c.agg && c.agg !== "individual"
  );

  // Agregação de uma métrica sobre um conjunto de registros, conforme a função
  // escolhida na coluna de data (soma/contagem/média/mediana/moda).
  const aggMetric = (fn: DateAgg, m: Metric, rs: RecordRow[]): number => {
    if (fn === "count" || m.field === "*") return rs.length;
    const nums = rs
      .map((r) => Number(rawValue(m.field, r)))
      .filter((n) => Number.isFinite(n));
    switch (fn) {
      case "sum":
        return nums.reduce((s, n) => s + n, 0);
      case "avg":
        return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
      case "median":
        return median(nums);
      case "mode":
        return mode(nums);
      default:
        return 0;
    }
  };
  const aggMetricText = (fn: DateAgg, m: Metric, rs: RecordRow[]): string => {
    const v = aggMetric(fn, m, rs);
    if (fn === "count" || m.field === "*") return v.toLocaleString("pt-BR");
    return MONEY_FIELDS.has(m.field)
      ? money(v)
      : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  };

  // Descobre se a coluna é de data (núcleo ou custom) e o formato efetivo dela.
  const isDateCol = (field: string): boolean => {
    if (DATE_FIELDS.has(field)) return true;
    if (field.startsWith("custom:"))
      return fieldByKey.get(field.slice(7))?.data_type === "data";
    return false;
  };
  const fmtOf = (field: string): DateFormat =>
    t.dateFormats?.[field] ?? dashFmt;

  // Texto de exibição de uma coluna personalizada (dimensão): moeda/calc-moeda na
  // sua moeda (fixa ou herdada do registro), data formatada, demais como texto.
  const customText = (
    f: FieldDefinition | undefined,
    r: RecordRow,
    colField: string
  ): string => {
    if (!f) return "—";
    const v = r.custom_fields?.[f.field_key];
    if (v == null || v === "") return "—";
    const m = resolveFieldMoney(f, r.currency);
    if (m.isMoney) return formatMoney(v, m.code);
    if (f.data_type === "data") return formatDateValue(v, fmtOf(colField));
    return String(v);
  };

  // Ordenação: sort tem precedência sobre a ordem manual das linhas.
  let rows = records;
  if (t.sort?.column) {
    const { column, dir, colorOrder } = t.sort;
    rows = [...records].sort((a, b) => {
      if (dir === "color") {
        const rank = new Map((colorOrder ?? []).map((c, i) => [c, i]));
        const ra = rank.get(t.rowColors?.[a.id]?.fill ?? "") ?? Number.MAX_SAFE_INTEGER;
        const rb = rank.get(t.rowColors?.[b.id]?.fill ?? "") ?? Number.MAX_SAFE_INTEGER;
        return ra - rb;
      }
      const av = rawValue(column, a);
      const bv = rawValue(column, b);
      const an = Number(av);
      const bn = Number(bv);
      const bothNum = av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn);
      const cmp = bothNum
        ? an - bn
        : String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
      return dir === "desc" ? -cmp : cmp;
    });
  } else {
    rows = applyManualOrder(records, t.rowOrder, (r) => r.id);
  }

  const distinctRowFills = distinctFills(rows.map((r) => t.rowColors?.[r.id]?.fill));

  // --- Agrupar por (modo registros): agrupa as linhas por uma ou mais colunas em
  // seções recolhíveis com subtotais das colunas numéricas. Multinível = hierarquia
  // (1º nível = grupo principal, demais aninhados). Chaveado pelo `c.field`. ---
  const groupLevels = groupByLevels(t.groupBy).filter((f) =>
    cols.some((c) => c.field === f)
  );

  const isNumericCol = (field: string): boolean => {
    if (MONEY_FIELDS.has(field)) return true;
    if (field.startsWith("custom:")) {
      const dt = fieldByKey.get(field.slice(7))?.data_type;
      return dt ? NUMERIC_DATA_TYPES.includes(dt) : false;
    }
    return false;
  };
  const numFmt = (field: string, n: number): string =>
    MONEY_FIELDS.has(field) ? money(n) : n.toLocaleString("pt-BR");
  const sumCol = (field: string, rs: RecordRow[]): number => {
    let s = 0;
    for (const r of rs) {
      const n = Number(rawValue(field, r));
      if (Number.isFinite(n)) s += n;
    }
    return s;
  };
  // Rótulo de exibição de um valor (para o cabeçalho do grupo).
  const displayValue = (field: string, r: RecordRow): string => {
    if (field.startsWith("custom:")) {
      return customText(fieldByKey.get(field.slice(7)), r, field);
    }
    return coreDisplay(field, r, fkLabels, fmtOf(field));
  };

  type Item =
    | { kind: "group"; level: number; key: string; label: string; rows: RecordRow[] }
    | { kind: "data"; row: RecordRow }
    | { kind: "grand" };
  // Achata a hierarquia numa lista de itens, respeitando quais grupos estão
  // expandidos. A chave inclui o caminho (prefixo) para não confundir grupos
  // homônimos em ramos diferentes.
  const buildGroupItems = (
    rs: RecordRow[],
    levels: string[],
    depth: number,
    prefix: string
  ): Item[] => {
    if (levels.length === 0) return rs.map((r) => ({ kind: "data" as const, row: r }));
    const [field, ...rest] = levels;
    const byKey = new Map<string, { label: string; rows: RecordRow[] }>();
    const order: string[] = [];
    for (const r of rs) {
      const gk = String(rawValue(field, r) ?? "");
      let g = byKey.get(gk);
      if (!g) {
        g = { label: displayValue(field, r), rows: [] };
        byKey.set(gk, g);
        order.push(gk);
      }
      g.rows.push(r);
    }
    const items: Item[] = [];
    for (const gk of order) {
      const g = byKey.get(gk)!;
      const key = `${prefix}›${gk}`;
      items.push({ kind: "group", level: depth, key, label: g.label, rows: g.rows });
      if (expanded.has(key))
        items.push(...buildGroupItems(g.rows, rest, depth + 1, key));
    }
    return items;
  };
  let displayItems: Item[];
  if (groupLevels.length > 0) {
    displayItems = buildGroupItems(rows, groupLevels, 0, "");
    displayItems.push({ kind: "grand" });
  } else {
    displayItems = rows.map((r) => ({ kind: "data", row: r }));
  }

  // Paginação no cliente: sem teto de registros, apenas 100 itens por página. A
  // fatia é feita DEPOIS de sort/ordem manual/agrupamento, então a página reflete
  // o conjunto inteiro.
  const PAGE_SIZE = 100;
  const totalPages = Math.max(1, Math.ceil(displayItems.length / PAGE_SIZE));
  const current = Math.min(page, totalPages); // clamp p/ mudanças de filtro/dados
  const pageItems = displayItems.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE
  );

  // Classe do conteúdo interno da célula: cortar (…) ou quebrar linha.
  const cellText = t.cellText ?? "clip";
  const cellSpanClass =
    cellText === "wrap"
      ? "block whitespace-normal break-words"
      : "block truncate";

  const gl = t.gridLines ?? "both";
  const vertical = gl === "vertical" || gl === "both";
  const horizontal = gl === "horizontal" || gl === "both";
  const rowBorder = horizontal ? "" : "border-b-0";
  const cellBorder = (last: boolean) =>
    vertical && !last
      ? { borderRight: `1px solid ${t.borderColor ?? "var(--border)"}` }
      : {};
  // Largura de coluna (px) definida pela edição de layout.
  const widthStyle = (field: string): React.CSSProperties => {
    const w = t.colWidths?.[field];
    return w ? { width: w, minWidth: w, maxWidth: w } : {};
  };

  const setTable = (patch: Partial<NonNullable<AppearanceSettings["table"]>>) =>
    change({ ...ap, table: { ...t, ...patch } });

  function setColor(m: { scope: ColorScope; column: string; rowKey?: string; group?: boolean }, cp: ColorPair) {
    const clear = !cp.fill && !cp.text;
    if (m.scope === "col") {
      // Coluna a partir de uma linha de grupo grava num mapa dedicado, que só as
      // linhas de grupo leem — não pinta as linhas de dados.
      const field = m.group ? "groupColColors" : "colColors";
      const map = { ...(t[field] ?? {}) };
      if (clear) delete map[m.column];
      else map[m.column] = cp;
      setTable({ [field]: map });
    } else if (m.scope === "row" && m.rowKey) {
      const map = { ...(t.rowColors ?? {}) };
      if (clear) delete map[m.rowKey];
      else map[m.rowKey] = cp;
      setTable({ rowColors: map });
    } else if (m.scope === "cell" && m.rowKey) {
      const map = { ...(t.cellColors ?? {}) };
      const k = `${m.rowKey}:${m.column}`;
      if (clear) delete map[k];
      else map[k] = cp;
      setTable({ cellColors: map });
    }
  }
  function colorValue(m: { scope: ColorScope; column: string; rowKey?: string; group?: boolean }): ColorPair {
    if (m.scope === "col")
      return (m.group ? t.groupColColors : t.colColors)?.[m.column] ?? {};
    if (m.scope === "row" && m.rowKey) return t.rowColors?.[m.rowKey] ?? {};
    if (m.scope === "cell" && m.rowKey) return t.cellColors?.[`${m.rowKey}:${m.column}`] ?? {};
    return {};
  }
  function setColDateFormat(column: string, f: DateFormat) {
    setTable({ dateFormats: { ...(t.dateFormats ?? {}), [column]: f } });
  }
  function setColWidth(column: string, w: number) {
    setTable({ colWidths: { ...(t.colWidths ?? {}), [column]: w } });
  }
  function setRowHeight(rowKey: string, h: number) {
    setTable({ rowHeights: { ...(t.rowHeights ?? {}), [rowKey]: h } });
  }
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Linha de cabeçalho de grupo (com subtotais) — espelha a tabela agregada.
  const renderSummaryRow = (
    keyId: string,
    label: string,
    rs: RecordRow[],
    opts?: {
      collapsible?: boolean;
      isCollapsed?: boolean;
      onToggle?: () => void;
      isGrand?: boolean;
      level?: number;
    }
  ) => {
    // Chave estável da linha de grupo (inclui o caminho hierárquico) — usada
    // como rowKey nos mapas de cor, isolada das linhas de dados pelo prefixo.
    const grpKey = `__grp:${keyId}`;
    const rowCp = t.rowColors?.[grpKey];
    // Cor + duplo-clique (abre o menu de aparência) por célula da linha de grupo.
    // `colKey` = chave da coluna mesclada (métrica sintética ou campo da coluna).
    const cellExtra = (colKey: string) => {
      const cellCp = t.cellColors?.[`${grpKey}:${colKey}`];
      const grpColCp = t.groupColColors?.[colKey];
      return {
        style: {
          background: cellCp?.fill ?? grpColCp?.fill,
          color: cellCp?.text ?? rowCp?.text ?? grpColCp?.text ?? t.headerColor,
        } as React.CSSProperties,
        onDoubleClick: editable
          ? (e: React.MouseEvent) =>
              setMenu({
                kind: "ctx",
                x: e.clientX,
                y: e.clientY,
                column: colKey,
                rowKey: grpKey,
                scopes: ["row", "col", "cell"],
                group: true,
                isDate: false,
              })
          : undefined,
      };
    };
    return (
    <TableRow
      key={grpKey}
      className={cn(rowBorder, "font-medium")}
      style={{
        background: rowCp?.fill ?? t.headerBg ?? "var(--muted)",
        color: rowCp?.text ?? t.headerColor,
        ...(t.borderColor ? { borderColor: t.borderColor } : {}),
      }}
    >
      {editable ? <TableCell className="w-6 px-1" /> : null}
      {mergedCols.map((x, ci) => {
        const border = cellBorder(ci === mergedCols.length - 1);
        const colKey = x.kind === "metric" ? x.key : x.c.field;
        const extra = cellExtra(colKey);
        // Primeira coluna (qualquer tipo): rótulo do grupo + chevron de recolher.
        if (ci === 0) {
          return (
            <TableCell
              key={x.key}
              style={{ ...border, ...extra.style }}
              onDoubleClick={extra.onDoubleClick}
            >
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1",
                  opts?.collapsible ? "cursor-pointer" : "cursor-default"
                )}
                style={
                  opts?.level ? { paddingLeft: opts.level * 16 } : undefined
                }
                onClick={opts?.onToggle}
                disabled={!opts?.collapsible}
              >
                {opts?.collapsible ? (
                  opts.isCollapsed ? (
                    <ChevronRight className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0" />
                  )
                ) : null}
                {label}
              </button>
            </TableCell>
          );
        }
        if (x.kind === "metric") {
          return (
            <TableCell
              key={x.key}
              className="text-right tabular-nums"
              onDoubleClick={extra.onDoubleClick}
              style={{
                ...border,
                ...widthStyle(x.key),
                ...(cellText === "clip" ? { overflow: "hidden" } : {}),
                ...extra.style,
              }}
            >
              <span className={cellSpanClass}>
                {metricAggText(x.m, rs, opts?.isGrand)}
              </span>
            </TableCell>
          );
        }
        const numeric = isNumericCol(x.c.field);
        return (
          <TableCell
            key={x.key}
            className={numeric ? "text-right tabular-nums" : undefined}
            onDoubleClick={extra.onDoubleClick}
            style={{ ...border, ...extra.style }}
          >
            {numeric ? numFmt(x.c.field, sumCol(x.c.field, rs)) : null}
          </TableCell>
        );
      })}
    </TableRow>
    );
  };

  const renderDataRow = (r: RecordRow) => {
    const rowCp = t.rowColors?.[r.id];
    const h = t.rowHeights?.[r.id];
    return (
      <TableRow
        key={r.id}
        className={rowBorder}
        style={{
          background: rowCp?.fill ?? t.bodyBg,
          color: rowCp?.text ?? t.bodyColor,
          ...(t.borderColor ? { borderColor: t.borderColor } : {}),
          ...(h ? { height: h } : {}),
        }}
      >
        {editable ? (
          <TableCell
            className="group relative w-6 cursor-move px-1"
            draggable
            onDragStart={() => setDragRow(r.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragRow)
                setTable({
                  rowOrder: reorderKeys(rows.map((x) => x.id), dragRow, r.id),
                  sort: undefined,
                });
              setDragRow(null);
            }}
            title="Arraste para reordenar a linha"
          >
            <GripVertical className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
            <ResizeHandle axis="row" onResize={(hh) => setRowHeight(r.id, hh)} />
          </TableCell>
        ) : null}
        {mergedCols.map((x, ci) => {
          const last = ci === mergedCols.length - 1;
          if (x.kind === "metric") {
            return (
              <TableCell
                key={x.key}
                className="text-right tabular-nums"
                style={{
                  color: rowCp?.text ?? t.bodyColor,
                  ...cellBorder(last),
                  ...widthStyle(x.key),
                  ...(cellText === "clip" ? { overflow: "hidden" } : {}),
                }}
              >
                <span className={cellSpanClass}>{metricCellText(x.m, r)}</span>
              </TableCell>
            );
          }
          const c = x.c;
          const isCustom = c.field.startsWith("custom:");
          const field = isCustom ? fieldByKey.get(c.field.slice(7)) : undefined;
          // Editável quando a coluna foi marcada (c.editable). Compat.: colunas
          // antigas (editable ausente) mantêm o padrão custom não calculado.
          const legacyEditable = Boolean(
            isCustom && field && field.data_type !== "calculado"
          );
          const wantEditable = c.editable ?? legacyEditable;
          const customEditable = Boolean(
            isCustom && field && field.data_type !== "calculado" && wantEditable
          );
          const coreEditable = Boolean(
            !isCustom && c.editable && isEditableCoreColumn(c.field)
          );
          // Relação editável (responsável): SELECT das entidades elegíveis. Só
          // quando há opções carregadas (do contrário cai no texto read-only).
          const relationEditable = Boolean(
            !isCustom &&
              c.editable &&
              isEditableRelation(c.field) &&
              canEditValues &&
              responsibleOptions.length > 0
          );
          const isEditableCell = customEditable || coreEditable || relationEditable;
          const cellCp = t.cellColors?.[`${r.id}:${c.field}`];
          const colCp = t.colColors?.[c.field];
          return (
            <TableCell
              key={x.key}
              className={cn("align-top", !t.colWidths?.[c.field] && "max-w-[200px]")}
              onDoubleClick={
                editable && !isEditableCell
                  ? (e) =>
                      setMenu({
                        kind: "ctx",
                        x: e.clientX,
                        y: e.clientY,
                        column: c.field,
                        rowKey: r.id,
                        scopes: ["row", "col", "cell"],
                        isDate: isDateCol(c.field),
                      })
                  : undefined
              }
              style={{
                background: cellCp?.fill ?? colCp?.fill,
                color: cellCp?.text ?? rowCp?.text ?? colCp?.text ?? t.bodyColor,
                ...cellBorder(last),
                ...widthStyle(c.field),
                ...(cellText === "clip" ? { overflow: "hidden" } : {}),
              }}
            >
              {customEditable && field ? (
                <EditableCell
                  record={r}
                  field={field}
                  userRoles={userRoles}
                  canEditValues={canEditValues}
                  dateFormat={fmtOf(c.field)}
                  onSaved={refresh}
                  writeBack={c.writeBack}
                  forceEditable
                />
              ) : relationEditable ? (
                <RelationEditableCell
                  recordId={r.id}
                  field={c.field}
                  value={String(rawValue(c.field, r) ?? "")}
                  // Gravando no Bitrix (ASSIGNED_BY_ID) → só responsáveis com
                  // vínculo no Bitrix. Local (sem write-back) → todos.
                  options={
                    c.writeBack
                      ? responsibleOptions.filter((o) => o.bitrixLinked)
                      : responsibleOptions
                  }
                  writeBack={c.writeBack}
                  onSaved={refresh}
                />
              ) : coreEditable ? (
                <CoreEditableCell
                  recordId={r.id}
                  field={c.field}
                  dataType={EDITABLE_CORE_COLUMNS[c.field]}
                  value={coreString(c.field, r)}
                  currency={r.currency}
                  writeBack={c.writeBack}
                  dateFormat={fmtOf(c.field)}
                  onSaved={refresh}
                />
              ) : c.transform ? (
                <span className={cellSpanClass}>{columnDateLabel(c, r)}</span>
              ) : isCustom ? (
                <span className={cellSpanClass}>
                  {customText(field, r, c.field)}
                </span>
              ) : (
                <span className={cellSpanClass}>
                  {coreDisplay(c.field, r, fkLabels, fmtOf(c.field))}
                </span>
              )}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };

  if (mergedCols.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Nenhuma coluna configurada. Edite o widget e adicione colunas.
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Nenhum registro para os filtros atuais.
      </div>
    );
  }

  // === Agregação por período: colapsa em 1 linha por período (Janeiro, T1/26…) e
  // mostra só a coluna de período + as métricas, agregadas pela função escolhida.
  if (groupCol) {
    const fn = groupCol.agg as DateAgg;
    const groupMetrics: Metric[] =
      metricList.length > 0 ? metricList : [{ field: "*", agg: "count" }];
    const byKey = new Map<
      string,
      { label: string; sort: number; rows: RecordRow[] }
    >();
    for (const r of records) {
      const b = bucketRecordDate(
        rawValue(groupCol.field, r),
        groupCol.transform!,
        groupCol.weekMode
      );
      let g = byKey.get(b.key);
      if (!g) {
        g = { label: b.label, sort: b.sort, rows: [] };
        byKey.set(b.key, g);
      }
      g.rows.push(r);
    }
    const groups = [...byKey.entries()]
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => a.sort - b.sort);
    const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    const pageGroups = groups.slice(
      (current - 1) * PAGE_SIZE,
      current * PAGE_SIZE
    );
    const periodLabel = colLabel(groupCol);
    const metricHead = (m: Metric) =>
      m.field === "*"
        ? "Contagem de registros"
        : m.label?.trim() || `${DATE_AGG_LABELS[fn]} · ${fieldLabel(m.field, available)}`;

    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow style={{ background: t.headerBg, color: t.headerColor }}>
                <TableHead className="whitespace-nowrap">{periodLabel}</TableHead>
                {groupMetrics.map((m, mi) => (
                  <TableHead
                    key={mi}
                    className="text-right whitespace-nowrap"
                  >
                    {metricHead(m)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageGroups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="font-medium">{g.label}</TableCell>
                  {groupMetrics.map((m, mi) => (
                    <TableCell key={mi} className="text-right tabular-nums">
                      {aggMetricText(fn, m, g.rows)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow
                className="font-medium"
                style={{ background: t.headerBg ?? "var(--muted)" }}
              >
                <TableCell>Total geral</TableCell>
                {groupMetrics.map((m, mi) => (
                  <TableCell key={mi} className="text-right tabular-nums">
                    {aggMetricText(fn, m, records)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
        {totalPages > 1 ? (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t px-2 py-1 text-sm">
            <span className="text-muted-foreground">
              Página {current} de {totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={current <= 1}
                onClick={() => setPage(current - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={current >= totalPages}
                onClick={() => setPage(current + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow
            className={rowBorder}
            style={{
              background: t.headerBg,
              color: t.headerColor,
              ...(t.borderColor ? { borderColor: t.borderColor } : {}),
            }}
          >
            {editable ? <TableHead className="w-6 px-1" /> : null}
            {mergedCols.map((x, ci) => {
              const last = ci === mergedCols.length - 1;
              // Handlers de arraste compartilhados: reordenam dentro da lista
              // única (dimensões + métricas) gravando o columnOrder completo.
              const dragProps = editable
                ? {
                    draggable: true,
                    onDragStart: () => setDragCol(x.key),
                    onDragOver: (e: React.DragEvent) => e.preventDefault(),
                    onDrop: () => {
                      if (dragCol)
                        setTable({
                          columnOrder: reorderKeys(
                            mergedCols.map((mc) => mc.key),
                            dragCol,
                            x.key
                          ),
                        });
                      setDragCol(null);
                    },
                  }
                : {};
              if (x.kind === "metric") {
                return (
                  <TableHead
                    key={x.key}
                    className={cn(
                      "group relative text-right",
                      editable && "cursor-move"
                    )}
                    {...dragProps}
                    style={{
                      color: t.headerColor,
                      ...cellBorder(last),
                      ...widthStyle(x.key),
                      ...(cellText === "clip" ? { overflow: "hidden" } : {}),
                    }}
                  >
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                      {editable ? (
                        <GripVertical className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                      ) : null}
                      <span className={cellSpanClass}>{metricLabel(x.m)}</span>
                    </span>
                    {editable ? (
                      <ResizeHandle axis="col" onResize={(w) => setColWidth(x.key, w)} />
                    ) : null}
                  </TableHead>
                );
              }
              const c = x.c;
              return (
                <TableHead
                  key={x.key}
                  className={cn("group relative whitespace-nowrap", editable && "cursor-move")}
                  {...dragProps}
                  onDoubleClick={
                    editable
                      ? (e) =>
                          setMenu({
                            kind: "ctx",
                            x: e.clientX,
                            y: e.clientY,
                            column: c.field,
                            scopes: ["col"],
                            isDate: isDateCol(c.field),
                          })
                      : undefined
                  }
                  style={{
                    background: t.colColors?.[c.field]?.fill,
                    color: t.colColors?.[c.field]?.text ?? t.headerColor,
                    ...cellBorder(last),
                    ...widthStyle(c.field),
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {editable ? (
                      <GripVertical className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                    ) : null}
                    {colLabel(c)}
                  </span>
                  {editable ? (
                    <ResizeHandle axis="col" onResize={(w) => setColWidth(c.field, w)} />
                  ) : null}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageItems.map((item) =>
            item.kind === "group"
              ? renderSummaryRow(
                  item.key,
                  `${item.label} (${item.rows.length})`,
                  item.rows,
                  {
                    collapsible: true,
                    isCollapsed: !expanded.has(item.key),
                    onToggle: () => toggleExpand(item.key),
                    level: item.level,
                  }
                )
              : item.kind === "grand"
                ? renderSummaryRow("__grand", "Total geral", rows, { isGrand: true })
                : renderDataRow(item.row)
          )}
        </TableBody>
      </Table>
      </div>

      {totalPages > 1 ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-2 py-1 text-sm">
          <span className="text-muted-foreground">
            Página {current} de {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={current >= totalPages}
              onClick={() => setPage(current + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      ) : null}

      {menu?.kind === "ctx" ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          ordering={
            menu.group
              ? undefined
              : {
                  onAsc: () => {
                    setTable({ sort: { column: menu.column, dir: "asc" }, rowOrder: undefined });
                    setMenu(null);
                  },
                  onDesc: () => {
                    setTable({ sort: { column: menu.column, dir: "desc" }, rowOrder: undefined });
                    setMenu(null);
                  },
                  onByColor:
                    distinctRowFills.length >= 2
                      ? () => setMenu({ kind: "colorOrder", x: menu.x, y: menu.y, column: menu.column })
                      : undefined,
                }
          }
          coloring={{
            scopes: menu.scopes,
            onScope: (scope) =>
              setMenu({
                kind: "color",
                x: menu.x,
                y: menu.y,
                scope,
                column: menu.column,
                rowKey: menu.rowKey,
                group: menu.group,
              }),
          }}
          dateFormat={
            menu.isDate
              ? {
                  value: t.dateFormats?.[menu.column],
                  onSelect: (f) => {
                    setColDateFormat(menu.column, f);
                    setMenu(null);
                  },
                }
              : undefined
          }
        />
      ) : null}

      {menu?.kind === "color" ? (
        <ColorPopover
          x={menu.x}
          y={menu.y}
          title={
            menu.scope === "row"
              ? "Cor da linha"
              : menu.scope === "col"
                ? "Cor da coluna"
                : "Cor da célula"
          }
          value={colorValue(menu)}
          onChange={(cp) => setColor(menu, cp)}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {menu?.kind === "colorOrder" ? (
        <ColorOrderDialog
          x={menu.x}
          y={menu.y}
          colors={distinctRowFills}
          value={t.sort?.colorOrder}
          onApply={(order) => {
            setTable({
              sort: { column: menu.column, dir: "color", colorOrder: order },
              rowOrder: undefined,
            });
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
