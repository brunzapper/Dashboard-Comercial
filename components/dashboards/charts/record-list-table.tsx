// Versão: 3.7 | Data: 19/07/2026
// v3.7 (19/07/2026): performance — resolução das colunas unificadas
//   pré-computada por render (mapas membros/hierarquia); antes cada rawValue
//   refazia available.find + cols.find POR CÉLULA (render, sort, grupos,
//   condicional, basis de calculadas), fator constante caro em listas grandes.
// v3.6 (18/07/2026): colunas unificadas — célula de dados resolve o membro via
//   displayValue (o fallback coreDisplay mostrava "—") e hierarquia de fontes
//   com fallback (RecordListColumn.unifiedSources): por registro, 1ª fonte da
//   lista com valor não-vazio (própria ou registro casado via ref match:);
//   moeda/máscara seguem o membro resolvido (matchText/metricCurrency).
// v3.5 (18/07/2026): "Formato do grupo" (appearance.table.groupDateFormats) —
//   nível de data do "Agrupar por" pode fundir/rotular por formato próprio
//   (bucketGroupDate) sem alterar o formato da dimensão nas linhas expandidas.
// v3.4 (18/07/2026): fontes por métrica — prop extraRecords (registros das
//   fontes de Metric.sources que o widget não exibe) entra SÓ na basis dos
//   subtotais/Total geral (comum e transposta), casada ao grupo pela mesma
//   construção de chave da árvore; célula por registro fora das fontes da
//   métrica exibe "—". Linhas/contagens de grupo seguem intactas.
// v3.3 (18/07/2026): refresh pós-edição de célula debounced e fora da transition
//   (useDebouncedRefresh) — edição inline não recomputa mais o dashboard inteiro
//   a cada célula nem trava o input até o re-render.
// v3.2 (17/07/2026): busca textual client-side — props searchQ/searchFields;
//   filtra em memória (recordSearchMatcher) ANTES de sort/grupo/paginação,
//   com reset p/ página 1 ao mudar o termo. Ausentes = comportamento antigo.
// v3.1 (15/07/2026): exibição percentual — campo percentual (×100) em colunas/
//   grupos/subtotais e toggle "%" (sufixo) nas métricas; contagem nunca converte.
// Widget de Tabela em modo "registros individuais" (Fonte das linhas = Registros).
// Uma linha por registro; colunas do núcleo read-only, colunas personalizadas
// NÃO calculadas editáveis por padrão (respeitando editable_by_roles do campo).
// v3.0 (11/07/2026): datas formatadas (dd/mm/aaaa | dd/mm/aa | mm/aa) com padrão
//   global do dashboard + override por coluna; edição de custom por padrão (sem a
//   antiga caixa "editável"); duplo-clique numa data abre calendário; largura de
//   coluna e altura de linha redimensionáveis na edição de layout.
"use client";

import { memo, useMemo, useState } from "react";
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
import { useDebouncedRefresh } from "@/lib/use-debounced-refresh";
import { Button } from "@/components/ui/button";
import { EditableCell } from "@/components/registros/editable-cell";
import { CoreEditableCell } from "@/components/registros/core-editable-cell";
import { RelationEditableCell } from "@/components/registros/relation-editable-cell";
import { LeadEditableCell } from "@/components/registros/lead-editable-cell";
import {
  NUMERIC_DATA_TYPES,
  isPercentField,
  isPercentFieldRef,
  type FieldDefinition,
  type RecordRow,
} from "@/lib/records/types";
import type { Formula } from "@/lib/records/formulas";
import {
  basisKeysFor,
  basisMetric,
  evalCalcMoney,
  isCalcMetric,
  isMoneyOperandField,
  parseCondBasisKey,
  recordMatchesConds,
  resolveCalcMetric,
  type BasisValues,
  type ResolvedCalcMetric,
} from "@/lib/widgets/calc-metrics";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import { metricTargetSources } from "@/lib/widgets/metric-sources";
import { toRecordType } from "@/lib/sources";
import { recordSearchMatcher } from "@/lib/widgets/record-search";
import {
  buildRecordBreakdown,
  calcCurrencyKey,
  formatMoney,
  formatMoneyAggregate,
  formatMoneyDisplay,
  resolveCurrencyCode,
  resolveFieldMoney,
  resolveFieldMoneyFromRecord,
  resolveRate,
  yearQuarterOf,
  type CurrencyRates,
} from "@/lib/widgets/currency";
import {
  EDITABLE_CORE_COLUMNS,
  isEditableCoreColumn,
  isEditableRelation,
} from "@/lib/config/core-writeback";
import { AGG_LABELS } from "@/lib/widgets/types";
import {
  bucketGroupDate,
  bucketRecordDate,
  isGroupDateFormat,
} from "@/lib/widgets/date-buckets";
import {
  alignClass,
  applyManualOrder,
  distinctFills,
  fracDigits,
  groupByLevels,
  recordListMetricKey,
  reorderKeys,
  resolveAlign,
  resolveDecimals,
} from "@/lib/widgets/appearance";
import {
  buildGroupItems,
  buildTransposedItems,
  columnAxis,
  dedupeFields,
  type GroupNode,
  type GroupOpts,
  type TItem,
} from "@/lib/widgets/grouping";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  formatPercent,
  type DateFormat,
} from "@/lib/widgets/format";
import { todayBrasiliaIso } from "@/lib/date/today";
import { unifiedMemberRef } from "@/lib/correspondences";
import {
  evalConditional,
  evalScopedConditional,
  hasConditional,
  scaleDomains,
} from "@/lib/widgets/conditional";
import type {
  AppearanceSettings,
  ColorPair,
  GroupDateFormat,
  Metric,
  RecordListColumn,
  TableAlign,
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
// "today" é sintético (Data atual, Brasília): não vem do registro, é resolvido
// em rawValue/coreDisplay. Fica no conjunto de datas p/ formatar e permitir
// override de máscara por coluna.
const DATE_FIELDS = new Set(["closed_at", "opened_at", "source_created_at", "today"]);

// Valor monetário na moeda do registro (quando informada); sem moeda cai em BRL.
// Usado tanto para células por registro (com r.currency) quanto para subtotais
// agregados (sem moeda — podem misturar registros de moedas diferentes).
function money(v: unknown, currency?: string | null, decimals?: number): string {
  return formatMoney(v, currency, decimals);
}

function coreDisplay(
  field: string,
  record: RecordRow,
  fkLabels: Record<string, string>,
  dateFmt: DateFormat,
  decimals?: number
): string {
  const v =
    field === "today"
      ? todayBrasiliaIso()
      : (record as unknown as Record<string, unknown>)[field];
  // Traço só para vazio/nulo — nunca por truthiness (zero deve exibir "0").
  if (FK_FIELDS.has(field))
    return v == null || v === "" ? "—" : (fkLabels[String(v)] ?? "—");
  if (MONEY_FIELDS.has(field)) return money(v, record.currency, decimals);
  if (field === "closed") return v ? "Sim" : "Não";
  if (DATE_FIELDS.has(field))
    return v == null || v === "" ? "—" : formatDateValue(v, dateFmt);
  return v == null || v === "" ? "—" : String(v);
}

// Ref de campo do registro casado: match:<fonte>:<ref> (ref pode conter ':').
function parseMatchField(field: string): { src: string; ref: string } | null {
  if (!field.startsWith("match:")) return null;
  const rest = field.slice(6);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  return { src: rest.slice(0, i), ref: rest.slice(i + 1) };
}

// Valor cru de um ref CONCRETO (today/match:/custom:/núcleo). Campos unificados
// são resolvidos antes, no `rawValue` do componente (precisa do catálogo
// `available` p/ achar o membro da fonte do registro).
function rawRefValue(field: string, record: RecordRow): unknown {
  if (field === "today") return todayBrasiliaIso();
  const mm = parseMatchField(field);
  if (mm) {
    const mrec = record.__match?.[mm.src as keyof NonNullable<RecordRow["__match"]>];
    if (!mrec) return undefined;
    return mm.ref.startsWith("custom:")
      ? mrec.custom_fields?.[mm.ref.slice(7)]
      : (mrec as unknown as Record<string, unknown>)[mm.ref];
  }
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

// React.memo: sob o WidgetCard memoizado, a tabela só re-renderiza quando os
// registros/aparência/props realmente mudam — não a cada churn do grid.
export const RecordListTable = memo(function RecordListTable({
  records,
  extraRecords = [],
  serverPage,
  searchQ,
  searchFields,
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
  // Registros EXTRAS das fontes das métricas com fontes próprias
  // (Metric.sources) que o widget não exibe: entram SÓ na basis dos
  // subtotais/Total geral (e nunca como linha). Ver runRecordListWithExtras.
  extraRecords?: RecordRow[];
  // Paginação SERVER-SIDE (widgets elegíveis — serverPaginatedList): `records`
  // é só a página corrente, já filtrada/ordenada pelo servidor; o pager usa
  // `total` e delega a troca de página ao WidgetCard (onPageChange). Ausente =
  // full fetch com sort/paginação client-side (comportamento original).
  serverPage?: {
    page: number;
    total: number;
    pageSize: number;
    loading?: boolean;
    onPageChange: (page: number) => void;
  };
  // Busca textual client-side (WidgetCard, quando searchHandledOnClient):
  // termo digitado na TableFilterBar + campos de busca do widget. Ausentes =
  // sem filtro local (a busca, se houver, veio aplicada do servidor).
  searchQ?: string;
  searchFields?: string[];
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
  // Reconcile pós-edição de célula: debounced e fora da transition da célula —
  // o input libera quando a action retorna e uma rajada de edições recomputa o
  // dashboard uma vez só (a action inline não revalida mais no servidor).
  const refresh = useDebouncedRefresh();
  const ap = appearance ?? {};
  const t = ap.table ?? {};
  const editable = canEdit && Boolean(onAppearanceChange);
  const change = onAppearanceChange ?? (() => {});
  const dashFmt = dateFormat ?? DEFAULT_DATE_FORMAT;

  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [page, setPage] = useState(1);
  // Termo de busca mudou → volta pra página 1 (ajuste de estado em render).
  const [prevSearchQ, setPrevSearchQ] = useState(searchQ);
  if (prevSearchQ !== searchQ) {
    setPrevSearchQ(searchQ);
    setPage(1);
  }
  // Grupos EXPANDIDOS no "Agrupar por" (efêmero). Vazio = tudo colapsado, então a
  // visualização padrão de uma tabela agrupada abre sempre recolhida.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const baseCols = columns.filter((c) => c.field);
  const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));
  const cols = applyManualOrder(baseCols, t.columnOrder, (c) => c.field);

  // Campo unificado: por padrão resolve o MEMBRO da fonte de cada registro
  // (espelha o coalesce do RPC); fonte sem membro → undefined (célula "—").
  // Com hierarquia de fontes configurada (RecordListColumn.unifiedSources),
  // resolve POR REGISTRO na 1ª fonte da lista com valor não-vazio: valor
  // próprio quando o registro é da fonte, senão o registro casado dela
  // (ref match:<fonte>:<membro> → __match). Sem valor em nenhuma → 1º ref
  // válido (célula "—"). Os demais campos delegam ao resolvedor concreto.
  // Obs.: o pós-filtro de quick-filters (quick-filters.ts) segue resolvendo
  // pela fonte do registro — config independente da coluna.
  // Pré-resolução por render (mesmo padrão do fieldByKey acima): membros do
  // catálogo de TODO campo unificado + hierarquia de fontes das colunas do
  // widget. rawValue é chamado por célula (render, sort, grupos, condicional,
  // basis de calculadas) — find() por chamada não escala em listas grandes.
  const unifiedMembersByField = new Map<
    string,
    AvailableField["unifiedMembers"]
  >();
  for (const a of available) {
    // 1ª ocorrência vence — mesma semântica do available.find() anterior.
    if (a.field.startsWith("unified:") && !unifiedMembersByField.has(a.field))
      unifiedMembersByField.set(a.field, a.unifiedMembers);
  }
  const unifiedOrderByField = new Map<
    string,
    RecordListColumn["unifiedSources"]
  >();
  for (const c of cols) {
    if (c.field.startsWith("unified:") && !unifiedOrderByField.has(c.field))
      unifiedOrderByField.set(c.field, c.unifiedSources);
  }
  const resolveUnifiedRef = (field: string, r: RecordRow): string | null => {
    if (!field.startsWith("unified:")) return field;
    const members = unifiedMembersByField.get(field);
    const order = unifiedOrderByField.get(field);
    if (order?.length) {
      let first: string | null = null;
      for (const src of order) {
        const mref = unifiedMemberRef(members, toRecordType(src));
        if (!mref) continue; // fonte sem membro (setting órfão)
        const ref =
          toRecordType(src) === r.record_type ? mref : `match:${src}:${mref}`;
        first ??= ref;
        const v = rawRefValue(ref, r);
        if (v != null && v !== "") return ref;
      }
      if (first) return first; // hierarquia toda vazia p/ este registro
    }
    return unifiedMemberRef(members, r.record_type);
  };
  const rawValue = (field: string, record: RecordRow): unknown => {
    const ref = resolveUnifiedRef(field, record);
    return ref ? rawRefValue(ref, record) : undefined;
  };

  // Formatação condicional: definida mais abaixo (depois de `rows` e dos
  // helpers de métrica — condValueOf resolve alvos __metric: e o pré-passe de
  // escopo varre as linhas visíveis).

  // Métricas do widget (mesmo comportamento do agregado): uma coluna por métrica,
  // com o valor cru por registro e o agregado (sum/count/avg) nas linhas de total.
  const metricList = metrics.filter((m) => m.field);

  // Métricas calculadas de agregados: fórmula reavaliada sobre os registros do
  // escopo (célula = 1 registro; subtotal/Total geral = registros do grupo) —
  // nunca a soma da coluna. Moeda: automática preserva a moeda dos operandos
  // (recorte de UMA moeda) e converte p/ Real ao misturar; fixa converte de
  // verdade (resultado BRL→fixa pela taxa do período do dashboard).
  const calcCache = new Map<Metric, ResolvedCalcMetric | null>();
  const calcOf = (m: Metric): ResolvedCalcMetric | null => {
    if (!calcCache.has(m)) {
      calcCache.set(
        m,
        isCalcMetric(m, fieldByKey) ? resolveCalcMetric(m, fieldByKey) : null
      );
    }
    return calcCache.get(m)!;
  };
  const calcBasisFor = (formula: Formula, rs: RecordRow[]): BasisValues => {
    const out: BasisValues = {};
    for (const key of basisKeysFor(formula)) {
      // Chave condicional (SOMASE/CONT.SE/MÉDIASE): restringe os registros do
      // escopo às condições e reusa a mesma lógica de contagem/soma/moeda.
      const cond = parseCondBasisKey(key);
      const recs = cond
        ? rs.filter((r) => recordMatchesConds((ref) => rawValue(ref, r), cond.conds))
        : rs;
      const bm = cond ? cond.metric : basisMetric(key);
      if (bm.agg === "count") {
        out[key] =
          bm.field === "*"
            ? recs.length
            : recs.filter((r) => {
                const v = rawValue(bm.field, r);
                return v != null && v !== "";
              }).length;
      } else if (isMoneyOperandField(bm.field, fieldByKey)) {
        // Operando monetário: detalhamento por moeda (+ convertido pela taxa do
        // período de cada registro) p/ preservar a moeda única do recorte ou
        // operar em Real quando misturar.
        out[key] = buildRecordBreakdown(
          recs,
          (r) => rawValue(bm.field, r),
          (r) => metricCurrency(bm.field, r),
          (r) => ({
            year: yearQuarterOf(
              r.closed_at ?? r.opened_at ?? r.source_created_at
            ).year,
            quarter: 0,
          }),
          currencyRates
        );
      } else {
        const nums = recs
          .map((r) => Number(rawValue(bm.field, r)))
          .filter((n) => Number.isFinite(n));
        out[key] = nums.length ? nums.reduce((s, n) => s + n, 0) : null;
      }
    }
    return out;
  };
  // Resultado numérico da calculada sobre um escopo (valor + moeda), compartilhado
  // entre o texto da célula/subtotal e o valor CRU da formatação condicional.
  const calcResult = (
    m: Metric,
    rs: RecordRow[]
  ): { value: number | null; currency: string | null } | null => {
    const rc = calcOf(m);
    if (!rc || !rc.formula) return null;
    const cp = conversionPeriod ?? yearQuarterOf(null);
    return evalCalcMoney(rc.formula, calcBasisFor(rc.formula, rs), {
      mode: rc.mode,
      code: rc.code,
      fixedRate:
        rc.mode === "fixed" && rc.code
          ? resolveRate(currencyRates, rc.code, cp.year, cp.quarter)
          : null,
      allowNegative: rc.allowNegative,
    });
  };
  const calcText = (m: Metric, rs: RecordRow[], decimals?: number): string => {
    const rc = calcOf(m);
    const res = calcResult(m, rs);
    if (!rc || !res || res.value == null) return "—";
    if (res.currency) return formatMoney(res.value, res.currency, decimals);
    // Percentual: calc percentual converte ×100; toggle "%" da métrica só sufixa.
    if (rc.percent) return formatPercent(res.value, true, decimals);
    if (m.percent) return formatPercent(res.value, false, decimals);
    return res.value.toLocaleString("pt-BR", fracDigits(decimals));
  };

  const metricLabel = (m: Metric) =>
    calcOf(m)
      ? m.label?.trim() ||
        (m.field.startsWith("custom:")
          ? fieldLabel(m.field, available)
          : "Fórmula")
      : m.label?.trim() ||
        `${AGG_LABELS[m.agg]} · ${fieldLabel(m.field, available)}`;

  // Lista única de colunas (dimensões + métricas) reordenável em conjunto, igual
  // à tabela agregada: métricas podem ser arrastadas para qualquer posição,
  // inclusive intercaladas às dimensões. Cada métrica recebe uma chave estável
  // (prefixo __metric:) para participar do columnOrder sem colidir com o c.field
  // das dimensões; o índice desambigua métricas idênticas. Métricas ficam fora do
  // columnOrder salvo em configs antigos, então applyManualOrder as anexa após as
  // dimensões — preservando o layout atual sem migração.
  const metricKey = recordListMetricKey; // compartilhada c/ o sheet de aparência
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
  // Moeda de um valor de métrica num registro (calc-automático lê o carimbo por
  // valor "<key>__cur" com fallback p/ a moeda do registro).
  const metricCurrency = (field: string, r: RecordRow): string => {
    // Unificado de moeda: a moeda segue o membro resolvido — da fonte do
    // registro ou, com hierarquia de fontes, do registro CASADO (ref match:).
    const ref = resolveUnifiedRef(field, r) ?? field;
    const mm = parseMatchField(ref);
    if (mm) {
      const mrec = r.__match?.[mm.src as keyof NonNullable<RecordRow["__match"]>];
      if (mm.ref.startsWith("custom:")) {
        const f = fieldByKey.get(mm.ref.slice(7));
        if (f)
          return resolveFieldMoney(
            f,
            mrec?.currency ?? null,
            mrec?.custom_fields?.[calcCurrencyKey(f.field_key)]
          ).code;
      }
      return resolveCurrencyCode(mrec?.currency);
    }
    if (ref.startsWith("custom:")) {
      const f = fieldByKey.get(ref.slice(7));
      return f
        ? resolveFieldMoneyFromRecord(f, r).code
        : resolveCurrencyCode(r.currency);
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

  // Registro fora das fontes próprias da métrica (Metric.sources): o valor por
  // registro não faz parte do universo dela — célula "—" e condicional null.
  const outsideMetricSources = (m: Metric, r: RecordRow): boolean => {
    const srcs = metricTargetSources(m);
    return (
      srcs.length > 0 && !srcs.some((s) => toRecordType(s) === r.record_type)
    );
  };
  const metricCellText = (m: Metric, r: RecordRow, decimals?: number): string => {
    if (outsideMetricSources(m, r)) return "—";
    // Calculada de agregados por registro: basis do próprio registro (ticket
    // médio de 1 venda = mrr/1 — coerente com o "individual" do agregado).
    if (calcOf(m)) return calcText(m, [r], decimals);
    if (m.field === "*") return "";
    const n = Number(rawValue(m.field, r));
    if (!Number.isFinite(n)) return "—";
    if (!metricIsMoney(m.field)) {
      // Percentual: campo percentual converte ×100 (vence o toggle "%").
      if (percentOf(m.field)) return formatPercent(n, true, decimals);
      if (m.percent) return formatPercent(n, false, decimals);
      return decimals != null
        ? n.toLocaleString("pt-BR", fracDigits(decimals))
        : n.toLocaleString("pt-BR");
    }
    const code = metricCurrency(m.field, r);
    const { year, quarter } = recYQ(r, m);
    return formatMoneyDisplay(
      n,
      code,
      m.currencyDisplay ?? "original",
      currencyRates,
      year,
      quarter,
      decimals
    );
  };
  // Valor numérico CRU de uma métrica num registro — alvo da formatação
  // condicional (regras/escala). null = "—" (fora das fontes próprias, não
  // numérico, calculada sem resultado): nunca casa regra numérica.
  const metricRawValue = (m: Metric, r: RecordRow): number | null => {
    if (outsideMetricSources(m, r)) return null;
    if (calcOf(m)) return calcResult(m, [r])?.value ?? null;
    if (m.field === "*") return null;
    const n = Number(rawValue(m.field, r));
    return Number.isFinite(n) ? n : null;
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
  // Calculada de agregados: fórmula reavaliada sobre os registros do escopo.
  const metricAggText = (
    m: Metric,
    rs: RecordRow[],
    isGrand = false,
    decimals?: number
  ): string => {
    if (calcOf(m)) return calcText(m, rs, decimals);
    if (m.agg === "count" || m.field === "*") {
      // Contagem NUNCA converte ×100 (mesmo de campo percentual); o toggle "%"
      // da métrica ainda pode sufixar (número já em magnitude percentual).
      const n = metricAgg(m, rs);
      if (m.percent) return formatPercent(n, false, decimals);
      return decimals != null
        ? n.toLocaleString("pt-BR", fracDigits(decimals))
        : n.toLocaleString("pt-BR");
    }
    if (!metricIsMoney(m.field)) {
      const n = metricAgg(m, rs);
      if (percentOf(m.field)) return formatPercent(n, true, decimals);
      if (m.percent) return formatPercent(n, false, decimals);
      return n.toLocaleString("pt-BR", fracDigits(decimals));
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
    return formatMoneyAggregate(bd, m, isGrand, decimals);
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

  // Colunas de data com "Agrupar período": promovidas a NÍVEIS de grupo — a data
  // vira cabeçalho no formato (com subtotal da métrica) e os registros ficam
  // editáveis embaixo, combinando com o "Agrupar por" explícito. `col.agg` só
  // marca a coluna como nível; o subtotal usa o agg da própria métrica.
  const periodAggCols = cols.filter(
    (c) => c.transform && c.agg && c.agg !== "individual"
  );

  // Descobre se a coluna é de data (núcleo, custom ou unificada) e o formato
  // efetivo dela.
  const isDateCol = (field: string): boolean => {
    if (DATE_FIELDS.has(field)) return true;
    if (field.startsWith("unified:"))
      return available.find((a) => a.field === field)?.isDate ?? false;
    if (field.startsWith("custom:"))
      return fieldByKey.get(field.slice(7))?.data_type === "data";
    const mm = parseMatchField(field);
    if (mm) {
      if (DATE_FIELDS.has(mm.ref)) return true;
      if (mm.ref.startsWith("custom:"))
        return fieldByKey.get(mm.ref.slice(7))?.data_type === "data";
    }
    return false;
  };

  // Campo percentual de uma ref custom:/match: (núcleo nunca é; 'unified:' fora
  // do v1 — ver isPercentFieldRef). Mesmo parser do carimbo do engine.
  const percentOf = (field: string): boolean =>
    isPercentFieldRef(field, fieldByKey);

  // Texto de exibição de um campo do registro casado (match:<fonte>:<ref>):
  // formata data/moeda/texto conforme o tipo do ref subjacente. `decimals` =
  // casas decimais da coluna (aparência); `fmtField` = coluna dona da máscara
  // de data (difere de `field` quando uma coluna unificada resolve num ref
  // match: — a máscara segue keada pela coluna).
  const matchText = (
    field: string,
    r: RecordRow,
    decimals?: number,
    fmtField = field
  ): string => {
    const mm = parseMatchField(field);
    if (!mm) return "—";
    const raw = rawValue(field, r);
    if (raw == null || raw === "") return "—";
    const mrec = r.__match?.[mm.src as keyof NonNullable<RecordRow["__match"]>];
    if (mm.ref.startsWith("custom:")) {
      const f = fieldByKey.get(mm.ref.slice(7));
      if (f?.data_type === "data") return formatDateValue(raw, fmtOf(fmtField));
      if (f) {
        const cur = resolveFieldMoney(
          f,
          mrec?.currency ?? null,
          mrec?.custom_fields?.[calcCurrencyKey(f.field_key)]
        );
        if (cur.isMoney) return formatMoney(raw, cur.code, decimals);
        if (isPercentField(f)) return formatPercent(raw, true, decimals);
      }
      return String(raw);
    }
    if (DATE_FIELDS.has(mm.ref)) return formatDateValue(raw, fmtOf(fmtField));
    if (MONEY_FIELDS.has(mm.ref))
      return formatMoney(raw, mrec?.currency ?? null, decimals);
    return String(raw);
  };
  const fmtOf = (field: string): DateFormat =>
    t.dateFormats?.[field] ?? dashFmt;

  // Texto de exibição de uma coluna personalizada (dimensão): moeda/calc-moeda na
  // sua moeda (fixa ou automática — carimbo por valor com fallback p/ a moeda do
  // registro), data formatada, demais como texto.
  const customText = (
    f: FieldDefinition | undefined,
    r: RecordRow,
    colField: string,
    decimals?: number
  ): string => {
    if (!f) return "—";
    const v = r.custom_fields?.[f.field_key];
    if (v == null || v === "") return "—";
    const m = resolveFieldMoneyFromRecord(f, r);
    if (m.isMoney) return formatMoney(v, m.code, decimals);
    if (f.data_type === "data") return formatDateValue(v, fmtOf(colField));
    if (isPercentField(f)) return formatPercent(v, true, decimals);
    // Numérico puro com casas configuradas: formata; senão texto cru (original).
    if (decimals != null && Number.isFinite(Number(v)))
      return Number(v).toLocaleString("pt-BR", fracDigits(decimals));
    return String(v);
  };

  // Busca textual client-side: filtra ANTES de sort/grupo/paginação — grupos,
  // subtotais, total geral e contagens passam a refletir só o que casa.
  const searchMatcher = useMemo(
    () => recordSearchMatcher(searchQ ?? "", searchFields, available),
    [searchQ, searchFields, available]
  );
  const filtered = useMemo(
    () => (searchMatcher ? records.filter(searchMatcher) : records),
    [records, searchMatcher]
  );
  // Extras sob a MESMA busca textual: subtotais/Total refletem o que casa.
  const filteredExtra = useMemo(
    () => (searchMatcher ? extraRecords.filter(searchMatcher) : extraRecords),
    [extraRecords, searchMatcher]
  );

  // Ordenação: sort tem precedência sobre a ordem manual das linhas.
  // useMemo: o sort percorre o conjunto INTEIRO e rodava a cada re-render
  // (expandir grupo, trocar página, digitar) — só recomputa quando os dados/
  // config de ordenação mudam. rawValue lê via cols/fkLabels (nas deps).
  const rows = useMemo(() => {
    // Página server-side: linhas já chegam filtradas/ordenadas do servidor —
    // re-ordenar aqui só a página seria errado (a ordem vale sobre o conjunto).
    if (serverPage) return filtered;
    if (t.sort?.column) {
      const { column, dir, colorOrder } = t.sort;
      return [...filtered].sort((a, b) => {
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
    }
    return applyManualOrder(filtered, t.rowOrder, (r) => r.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, serverPage != null, t.sort, t.rowOrder, t.rowColors, cols, fkLabels]);

  const distinctRowFills = useMemo(
    () => distinctFills(rows.map((r) => t.rowColors?.[r.id]?.fill)),
    [rows, t.rowColors]
  );

  // --- Formatação condicional (appearance.conditional) ---
  // Alvo = field da coluna OU chave sintética de métrica (__metric:), avaliada
  // sobre o valor CRU. Precedência: célula manual > regra de célula > escala >
  // regra de linha > regra de coluna > linha/coluna manual (ver conditional.ts).
  const cond = ap.conditional;
  const condActive = hasConditional(cond);
  const metricByColKey = useMemo(
    () => new Map(metricList.map((m, mi) => [metricKey(m, mi), m])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metricList]
  );
  const condValueOf = (target: string, r: RecordRow): unknown => {
    const m = metricByColKey.get(target);
    return m ? metricRawValue(m, r) : rawValue(target, r);
  };
  const condDomains = useMemo(
    () =>
      condActive
        ? scaleDomains(
            records as unknown as Record<string, unknown>[],
            cond?.scales,
            (row, target) => condValueOf(target, row as unknown as RecordRow)
          )
        : {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [condActive, cond, records]
  );
  const condStyleOf = (colKey: string, record: RecordRow) =>
    condActive
      ? evalConditional(cond, colKey, condValueOf(colKey, record), {
          domain: condDomains[colKey],
        })
      : null;
  // Regras com escopo linha/coluna: pré-passe sobre as linhas visíveis.
  const scopedCond = useMemo(
    () =>
      condActive
        ? evalScopedConditional(
            cond,
            rows as unknown as Record<string, unknown>[],
            (r) => (r as unknown as RecordRow).id,
            (r, target) => condValueOf(target, r as unknown as RecordRow)
          )
        : { row: {}, col: {} },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [condActive, cond, rows]
  );

  // --- Agrupar por (modo registros): agrupa as linhas por uma ou mais colunas em
  // seções recolhíveis com subtotais das colunas numéricas. Multinível = hierarquia
  // (1º nível = grupo principal, demais aninhados). Chaveado pelo `c.field`.
  // Colunas de data com "Agrupar período" entram como níveis MAIS EXTERNOS (o
  // subtotal do período é a manchete), com o "Agrupar por" explícito aninhado. ---
  const groupLevels = dedupeFields([
    ...periodAggCols.map((c) => c.field),
    ...groupByLevels(t.groupBy),
  ]).filter((f) => cols.some((c) => c.field === f));

  const isNumericCol = (field: string): boolean => {
    if (MONEY_FIELDS.has(field)) return true;
    if (field.startsWith("custom:")) {
      const dt = fieldByKey.get(field.slice(7))?.data_type;
      return dt ? NUMERIC_DATA_TYPES.includes(dt) : false;
    }
    return false;
  };
  const numFmt = (field: string, n: number, decimals?: number): string =>
    MONEY_FIELDS.has(field)
      ? money(n, null, decimals)
      : percentOf(field)
        ? formatPercent(n, true, decimals)
        : decimals != null
          ? n.toLocaleString("pt-BR", fracDigits(decimals))
          : n.toLocaleString("pt-BR");
  const sumCol = (field: string, rs: RecordRow[]): number => {
    let s = 0;
    for (const r of rs) {
      const n = Number(rawValue(field, r));
      if (Number.isFinite(n)) s += n;
    }
    return s;
  };
  // Rótulo de exibição de um valor (cabeçalho do grupo — sem decimals — e
  // célula unificada, que encaminha as casas decimais da coluna).
  const displayValue = (field: string, r: RecordRow, decimals?: number): string => {
    // Unificado: exibe como o MEMBRO resolvido (data/moeda/texto), honrando a
    // máscara de data configurada na própria coluna unificada. Com hierarquia
    // de fontes o ref pode ser do registro casado (match:) → formata pelo
    // parceiro (matchText), mantendo a máscara keada pela coluna.
    if (field.startsWith("unified:")) {
      const ref = resolveUnifiedRef(field, r);
      if (!ref) return "—";
      if (ref.startsWith("match:")) return matchText(ref, r, decimals, field);
      return ref.startsWith("custom:")
        ? customText(fieldByKey.get(ref.slice(7)), r, field, decimals)
        : coreDisplay(ref, r, fkLabels, fmtOf(field), decimals);
    }
    if (field.startsWith("custom:")) {
      return customText(fieldByKey.get(field.slice(7)), r, field, decimals);
    }
    return coreDisplay(field, r, fkLabels, fmtOf(field), decimals);
  };

  // Exibição de uma coluna de data para agrupamento — idêntica à célula: honra o
  // transform (mês/tri/ano…) quando definido, senão a máscara. Usada como chave e
  // rótulo do grupo p/ o cabeçalho bater com a célula e registros de mesmo formato
  // (ex.: transform "mês" → "Janeiro", ou máscara `mm/aa`) caírem no mesmo grupo.
  const groupCellDisplay = (field: string, r: RecordRow): string => {
    const c = cols.find((col) => col.field === field);
    if (c?.transform) return columnDateLabel(c, r);
    return displayValue(field, r);
  };

  // Sort cronológico dos níveis de data (transform → semântico via bucketRecordDate;
  // máscara → AAAAMMDD). Demais colunas: 0 (ordem de inserção preservada).
  const dateSortKey = (field: string, r: RecordRow): number => {
    const c = cols.find((col) => col.field === field);
    const raw = rawValue(field, r);
    if (c?.transform) return bucketRecordDate(raw, c.transform, c.weekMode).sort;
    const m = String(raw ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
  };
  // "Formato do grupo" (appearance.table.groupDateFormats): override por nível
  // do "Agrupar por" explícito que seja coluna de data — funde/rotula/ordena o
  // grupo por formato próprio, sem alterar as células expandidas. periodAggCols
  // e entradas órfãs (nível removido/campo trocado ou não-data) ficam inertes.
  // Efeito colateral ao LIGAR um formato: a chave do nó muda (display → key do
  // bucket) e cores/alturas persistidas de grupo (`__grp:<caminho>`) se
  // desprendem — mesmo precedente de trocar o transform da dimensão.
  const groupBySet = new Set(groupByLevels(t.groupBy));
  const groupFmtOf = (field: string): GroupDateFormat | undefined => {
    const v = t.groupDateFormats?.[field];
    return v && groupBySet.has(field) && isDateCol(field) && isGroupDateFormat(v)
      ? v
      : undefined;
  };
  const groupBucketOf = (field: string, r: RecordRow, gf: GroupDateFormat) =>
    bucketGroupDate(rawValue(field, r), gf, cols.find((c) => c.field === field)?.weekMode);
  // Acessores de agrupamento: data funde/rotula pelo valor FORMATADO (transform ou
  // máscara); demais colunas chaveiam por valor bruto (evita fundir valores
  // distintos que só coincidem no rótulo, ex.: FKs homônimas).
  const groupOpts: GroupOpts<RecordRow> = {
    keyOf: (r, field) => {
      const gf = groupFmtOf(field);
      if (gf) return groupBucketOf(field, r, gf).key;
      return isDateCol(field) ? groupCellDisplay(field, r) : String(rawValue(field, r) ?? "");
    },
    labelOf: (r, field) => {
      const gf = groupFmtOf(field);
      if (gf) return groupBucketOf(field, r, gf).label;
      return isDateCol(field) ? groupCellDisplay(field, r) : displayValue(field, r);
    },
    sortKeyOf: (r, field) => {
      const gf = groupFmtOf(field);
      return gf ? groupBucketOf(field, r, gf).sort : dateSortKey(field, r);
    },
    isExpanded: (k) => expanded.has(k),
  };

  // --- Fontes por métrica (Metric.sources): escopo da basis dos subtotais ---
  // record_types de uma métrica com fontes próprias (null = herda o widget).
  const metricRts = (m: Metric): Set<string> | null => {
    const srcs = metricTargetSources(m);
    return srcs.length > 0 ? new Set(srcs.map((s) => toRecordType(s))) : null;
  };
  // Escopo de uma métrica sobre um recorte: sem fontes próprias → o recorte
  // intacto (byte a byte igual a antes); com → recorte + extras do MESMO
  // grupo, filtrados pelas fontes da métrica.
  const scopeRecordsFor = (
    m: Metric,
    rs: RecordRow[],
    extras: RecordRow[]
  ): RecordRow[] => {
    const rts = metricRts(m);
    if (!rts) return rs;
    return [...rs, ...extras].filter((r) => rts.has(r.record_type));
  };
  // Índice dos extras por caminho de grupo — MESMA construção de chave da
  // árvore (prefixo + "›" + keyOf por nível; ver buildGroupItems), um mapa por
  // nível. Nunca parseia a chave dos nós: reconstrói pelo mesmo algoritmo.
  const extrasPathIndex = (levels: string[]): Map<string, RecordRow[]>[] => {
    const maps: Map<string, RecordRow[]>[] = levels.map(() => new Map());
    if (filteredExtra.length === 0) return maps;
    for (const r of filteredExtra) {
      let path = "";
      levels.forEach((field, li) => {
        path = `${path}›${groupOpts.keyOf(r, field)}`;
        const list = maps[li].get(path) ?? [];
        list.push(r);
        maps[li].set(path, list);
      });
    }
    return maps;
  };
  // Índice dos extras pelos níveis do "Agrupar por" comum (a transposta monta
  // o próprio índice com os níveis dela).
  const extrasGroupMaps = extrasPathIndex(groupLevels);

  type Item = GroupNode<RecordRow> | { kind: "grand" };
  let displayItems: Item[];
  if (groupLevels.length > 0) {
    displayItems = [...buildGroupItems(rows, groupLevels, groupOpts)];
    displayItems.push({ kind: "grand" });
  } else {
    displayItems = rows.map((r) => ({ kind: "data", row: r }));
  }

  // Paginação: no modo server-side, `records` já É a página corrente (o pager
  // usa o total do servidor e delega a troca ao WidgetCard). No modo cliente:
  // sem teto de registros, 100 itens por página, com a fatia DEPOIS de
  // sort/ordem manual/agrupamento — a página reflete o conjunto inteiro.
  const PAGE_SIZE = 100;
  const totalPages = serverPage
    ? Math.max(1, Math.ceil(serverPage.total / serverPage.pageSize))
    : Math.max(1, Math.ceil(displayItems.length / PAGE_SIZE));
  const current = serverPage
    ? Math.min(serverPage.page, totalPages)
    : Math.min(page, totalPages); // clamp p/ mudanças de filtro/dados
  const pageItems = serverPage
    ? displayItems
    : displayItems.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

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
  // Alinhamento por escopo (linha/coluna/célula), espelhando setColor/colorValue.
  // Colunas de linhas de grupo compartilham o colAlign das linhas de dados.
  function setAlign(
    m: { scope: ColorScope; column: string; rowKey?: string },
    a: TableAlign | undefined
  ) {
    if (m.scope === "col") {
      const map = { ...(t.colAlign ?? {}) };
      if (!a) delete map[m.column];
      else map[m.column] = a;
      setTable({ colAlign: map });
    } else if (m.scope === "row" && m.rowKey) {
      const map = { ...(t.rowAlign ?? {}) };
      if (!a) delete map[m.rowKey];
      else map[m.rowKey] = a;
      setTable({ rowAlign: map });
    } else if (m.scope === "cell" && m.rowKey) {
      const map = { ...(t.cellAlign ?? {}) };
      const k = `${m.rowKey}:${m.column}`;
      if (!a) delete map[k];
      else map[k] = a;
      setTable({ cellAlign: map });
    }
  }
  function alignValue(m: { scope: ColorScope; column: string; rowKey?: string }): TableAlign | undefined {
    if (m.scope === "col") return t.colAlign?.[m.column];
    if (m.scope === "row" && m.rowKey) return t.rowAlign?.[m.rowKey];
    if (m.scope === "cell" && m.rowKey) return t.cellAlign?.[`${m.rowKey}:${m.column}`];
    return undefined;
  }
  // Casas decimais por escopo (linha/coluna/célula), espelhando setAlign.
  function setDecimals(
    m: { scope: ColorScope; column: string; rowKey?: string },
    d: number | undefined
  ) {
    if (m.scope === "col") {
      const map = { ...(t.colDecimals ?? {}) };
      if (d == null) delete map[m.column];
      else map[m.column] = d;
      setTable({ colDecimals: map });
    } else if (m.scope === "row" && m.rowKey) {
      const map = { ...(t.rowDecimals ?? {}) };
      if (d == null) delete map[m.rowKey];
      else map[m.rowKey] = d;
      setTable({ rowDecimals: map });
    } else if (m.scope === "cell" && m.rowKey) {
      const map = { ...(t.cellDecimals ?? {}) };
      const k = `${m.rowKey}:${m.column}`;
      if (d == null) delete map[k];
      else map[k] = d;
      setTable({ cellDecimals: map });
    }
  }
  function decimalsValue(m: {
    scope: ColorScope;
    column: string;
    rowKey?: string;
  }): number | undefined {
    if (m.scope === "col") return t.colDecimals?.[m.column];
    if (m.scope === "row" && m.rowKey) return t.rowDecimals?.[m.rowKey];
    if (m.scope === "cell" && m.rowKey)
      return t.cellDecimals?.[`${m.rowKey}:${m.column}`];
    return undefined;
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
    // Extras deste recorte p/ métricas com fontes próprias: Total geral = todos;
    // grupo = os do mesmo caminho (keyId é a chave do nó da árvore).
    const extrasFor = (m: Metric): RecordRow[] => {
      if (!metricRts(m)) return [];
      if (opts?.isGrand) return filteredExtra;
      return extrasGroupMaps[opts?.level ?? 0]?.get(keyId) ?? [];
    };
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
              className={alignClass(resolveAlign(t, { column: colKey, rowKey: grpKey }))}
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
              className={cn(
                alignClass(resolveAlign(t, { column: x.key, rowKey: grpKey, numeric: true })),
                "tabular-nums"
              )}
              onDoubleClick={extra.onDoubleClick}
              style={{
                ...border,
                ...widthStyle(x.key),
                ...(cellText === "clip" ? { overflow: "hidden" } : {}),
                ...extra.style,
              }}
            >
              <span className={cellSpanClass}>
                {metricAggText(
                  x.m,
                  scopeRecordsFor(x.m, rs, extrasFor(x.m)),
                  opts?.isGrand,
                  resolveDecimals(ap, { column: x.key, rowKey: grpKey })
                )}
              </span>
            </TableCell>
          );
        }
        const numeric = isNumericCol(x.c.field);
        return (
          <TableCell
            key={x.key}
            className={cn(
              alignClass(resolveAlign(t, { column: x.c.field, rowKey: grpKey, numeric })),
              numeric && "tabular-nums"
            )}
            onDoubleClick={extra.onDoubleClick}
            style={{ ...border, ...extra.style }}
          >
            {numeric
              ? numFmt(
                  x.c.field,
                  sumCol(x.c.field, rs),
                  resolveDecimals(ap, { column: x.c.field, rowKey: grpKey })
                )
              : null}
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
          const scRow = scopedCond.row[r.id];
          if (x.kind === "metric") {
            // Paridade com o branch de campo: menu de aparência por duplo-clique
            // e cadeia completa de cores (célula > condicional > coluna > linha).
            const cellCp = t.cellColors?.[`${r.id}:${x.key}`];
            const colCp = t.colColors?.[x.key];
            const cs = condStyleOf(x.key, r);
            const scCol = scopedCond.col[x.key];
            return (
              <TableCell
                key={x.key}
                className={cn(
                  alignClass(resolveAlign(t, { column: x.key, rowKey: r.id, numeric: true })),
                  "tabular-nums"
                )}
                onDoubleClick={
                  editable
                    ? (e) =>
                        setMenu({
                          kind: "ctx",
                          x: e.clientX,
                          y: e.clientY,
                          column: x.key,
                          rowKey: r.id,
                          scopes: ["row", "col", "cell"],
                          isDate: false,
                        })
                    : undefined
                }
                style={{
                  background:
                    cellCp?.fill ??
                    cs?.fill ??
                    scRow?.fill ??
                    scCol?.fill ??
                    colCp?.fill,
                  color:
                    cellCp?.text ??
                    cs?.text ??
                    scRow?.text ??
                    scCol?.text ??
                    rowCp?.text ??
                    colCp?.text ??
                    t.bodyColor,
                  ...(cs?.bold || scRow?.bold || scCol?.bold
                    ? { fontWeight: 600 }
                    : {}),
                  ...cellBorder(last),
                  ...widthStyle(x.key),
                  ...(cellText === "clip" ? { overflow: "hidden" } : {}),
                }}
              >
                <span className={cellSpanClass}>
                  {metricCellText(
                    x.m,
                    r,
                    resolveDecimals(ap, { column: x.key, rowKey: r.id })
                  )}
                </span>
              </TableCell>
            );
          }
          const c = x.c;
          const isCustom = c.field.startsWith("custom:");
          const isMatch = c.field.startsWith("match:");
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
              c.field === "responsible_id" &&
              isEditableRelation(c.field) &&
              canEditValues &&
              responsibleOptions.length > 0
          );
          // Lead relacionado editável: combobox PESQUISÁVEL (searchLeads), sem lista
          // pré-carregada. Grava local (sem write-back).
          const leadEditable = Boolean(
            !isCustom &&
              c.editable &&
              c.field === "related_lead_id" &&
              isEditableRelation(c.field) &&
              canEditValues
          );
          const isEditableCell =
            customEditable || coreEditable || relationEditable || leadEditable;
          const cellCp = t.cellColors?.[`${r.id}:${c.field}`];
          const colCp = t.colColors?.[c.field];
          const cs = condStyleOf(c.field, r);
          const scCol = scopedCond.col[c.field];
          const dec = resolveDecimals(ap, { column: c.field, rowKey: r.id });
          return (
            <TableCell
              key={x.key}
              className={cn(
                "align-top",
                !t.colWidths?.[c.field] && "max-w-[200px]",
                alignClass(
                  resolveAlign(t, {
                    column: c.field,
                    rowKey: r.id,
                    numeric: isNumericCol(c.field),
                  })
                )
              )}
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
                background:
                  cellCp?.fill ??
                  cs?.fill ??
                  scRow?.fill ??
                  scCol?.fill ??
                  colCp?.fill,
                color:
                  cellCp?.text ??
                  cs?.text ??
                  scRow?.text ??
                  scCol?.text ??
                  rowCp?.text ??
                  colCp?.text ??
                  t.bodyColor,
                ...(cs?.bold || scRow?.bold || scCol?.bold
                  ? { fontWeight: 600 }
                  : {}),
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
              ) : leadEditable ? (
                <LeadEditableCell
                  recordId={r.id}
                  value={String(rawValue(c.field, r) ?? "")}
                  label={fkLabels[String(rawValue(c.field, r) ?? "")] ?? null}
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
              ) : isMatch ? (
                <span className={cellSpanClass}>
                  {matchText(c.field, r, dec)}
                </span>
              ) : isCustom ? (
                <span className={cellSpanClass}>
                  {customText(field, r, c.field, dec)}
                </span>
              ) : c.field.startsWith("unified:") ? (
                // Unificada: resolve o membro/fonte antes de formatar — o
                // fallback coreDisplay leria record["unified:…"] (inexistente).
                <span className={cellSpanClass}>
                  {displayValue(c.field, r, dec)}
                </span>
              ) : (
                <span className={cellSpanClass}>
                  {coreDisplay(c.field, r, fkLabels, fmtOf(c.field), dec)}
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
  if (filtered.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Nenhum registro para os filtros atuais.
      </div>
    );
  }

  // === Orientação transposta: visão AGREGADA (read-only). Colunas = valores
  // distintos da coluna de `colDim` (default: a 1ª); eixo esquerdo = métricas
  // com os grupos aninhados; células = subtotais (moeda ciente). Para EDITAR
  // registros, use a comum. ===
  const orientation = t.orientation === "columns" ? "columns" : "rows";
  if (orientation === "columns") {
    const colDimCol =
      (t.colDim && cols.find((c) => c.field === t.colDim)) || cols[0];
    const colDimKey = colDimCol.field;
    const tMetrics: Metric[] =
      metricList.length > 0 ? metricList : [{ field: "*", agg: "count" }];
    const tMetricLabel = (m: Metric) =>
      m.field === "*" ? "Contagem de registros" : metricLabel(m);
    const tGroupLevels = dedupeFields([
      ...periodAggCols.map((c) => c.field),
      ...groupByLevels(t.groupBy),
    ]).filter((f) => f !== colDimKey && cols.some((c) => c.field === f));
    const { colVals, rowsForCol, colGroupKey } = columnAxis(
      rows,
      colDimKey,
      groupOpts.keyOf
    );
    const colHeader = (rep: RecordRow) =>
      groupOpts.labelOf ? groupOpts.labelOf(rep, colDimKey) : groupOpts.keyOf(rep, colDimKey);
    // Extras por caminho de grupo da transposta (níveis próprios; o prefixo
    // `__m:<i>` das chaves dos TItems é removido antes do lookup) + filtro
    // pela coluna (mesma chave de coluna do rep).
    const tExtrasMaps = extrasPathIndex(tGroupLevels);
    const tExtrasFor = (
      item: TItem<RecordRow>,
      m: Metric,
      rep: RecordRow
    ): RecordRow[] => {
      if (!metricRts(m)) return [];
      const path = item.key.slice(item.metricKey.length);
      const base =
        path === ""
          ? filteredExtra
          : tExtrasMaps[item.level - 1]?.get(path) ?? [];
      const rk = colGroupKey(rep);
      return base.filter((r) => colGroupKey(r) === rk);
    };

    const metricByKey = new Map(tMetrics.map((m, mi) => [`__m:${mi}`, m]));
    const tItems: TItem<RecordRow>[] = [];
    tMetrics.forEach((m, mi) => {
      const mKey = `__m:${mi}`;
      tItems.push({
        metricKey: mKey,
        level: 0,
        label: tMetricLabel(m),
        key: mKey,
        rows,
        collapsible: tGroupLevels.length > 0,
      });
      if (expanded.has(mKey) && tGroupLevels.length > 0)
        tItems.push(
          ...buildTransposedItems(rows, tGroupLevels, { ...groupOpts, metricKey: mKey }, 1, mKey)
        );
    });

    return (
      <div className="h-full overflow-auto [scrollbar-gutter:stable]">
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
              <TableHead style={cellBorder(colVals.length === 0)}>
                {colLabel(colDimCol)}
              </TableHead>
              {colVals.map((rep, ci) => (
                <TableHead
                  key={groupOpts.keyOf(rep, colDimKey)}
                  className={cn(
                    alignClass(
                      resolveAlign(t, {
                        column: groupOpts.keyOf(rep, colDimKey),
                        numeric: true,
                      })
                    ),
                    "whitespace-nowrap"
                  )}
                  style={cellBorder(ci === colVals.length - 1)}
                >
                  {colHeader(rep)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tItems.map((item) => {
              const isMetric = item.level === 0;
              const isCollapsed = !expanded.has(item.key);
              const m = metricByKey.get(item.metricKey)!;
              return (
                <TableRow
                  key={item.key}
                  className={cn(rowBorder, isMetric && "font-medium")}
                  style={{
                    background: isMetric ? t.headerBg ?? "var(--muted)" : t.bodyBg,
                    color: isMetric ? t.headerColor : t.bodyColor,
                    ...(t.borderColor ? { borderColor: t.borderColor } : {}),
                  }}
                >
                  <TableHead
                    className="font-medium"
                    style={cellBorder(colVals.length === 0)}
                  >
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1",
                        item.collapsible ? "cursor-pointer" : "cursor-default"
                      )}
                      style={item.level ? { paddingLeft: item.level * 16 } : undefined}
                      onClick={item.collapsible ? () => toggleExpand(item.key) : undefined}
                      disabled={!item.collapsible}
                    >
                      {item.collapsible ? (
                        isCollapsed ? (
                          <ChevronRight className="size-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0" />
                        )
                      ) : null}
                      {item.label}
                    </button>
                  </TableHead>
                  {colVals.map((rep, ci) => (
                    <TableCell
                      key={groupOpts.keyOf(rep, colDimKey)}
                      className={cn(
                        alignClass(
                          resolveAlign(t, {
                            column: groupOpts.keyOf(rep, colDimKey),
                            rowKey: item.key,
                            numeric: true,
                          })
                        ),
                        "tabular-nums"
                      )}
                      style={cellBorder(ci === colVals.length - 1)}
                    >
                      {/* Transposta: chaves de linha/coluna invertidas — só o
                          decimal global do widget se aplica. */}
                      {metricAggText(
                        m,
                        scopeRecordsFor(
                          m,
                          rowsForCol(item.rows, rep),
                          tExtrasFor(item, m, rep)
                        ),
                        false,
                        ap.decimals
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
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
                      "group relative",
                      alignClass(resolveAlign(t, { column: x.key, numeric: true })),
                      editable && "cursor-move"
                    )}
                    {...dragProps}
                    onDoubleClick={
                      editable
                        ? (e) =>
                            setMenu({
                              kind: "ctx",
                              x: e.clientX,
                              y: e.clientY,
                              column: x.key,
                              scopes: ["col"],
                              isDate: false,
                            })
                        : undefined
                    }
                    style={{
                      background: t.colColors?.[x.key]?.fill,
                      color: t.colColors?.[x.key]?.text ?? t.headerColor,
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
                  className={cn(
                    "group relative whitespace-nowrap",
                    alignClass(
                      resolveAlign(t, { column: c.field, numeric: isNumericCol(c.field) })
                    ),
                    editable && "cursor-move"
                  )}
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
            {serverPage?.loading ? " — carregando…" : ""}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={current <= 1 || serverPage?.loading}
              onClick={() =>
                serverPage
                  ? serverPage.onPageChange(current - 1)
                  : setPage(current - 1)
              }
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={current >= totalPages || serverPage?.loading}
              onClick={() =>
                serverPage
                  ? serverPage.onPageChange(current + 1)
                  : setPage(current + 1)
              }
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
              ? "Aparência da linha"
              : menu.scope === "col"
                ? "Aparência da coluna"
                : "Aparência da célula"
          }
          value={colorValue(menu)}
          onChange={(cp) => setColor(menu, cp)}
          align={{
            value: alignValue(menu),
            onSelect: (a) => setAlign(menu, a),
          }}
          decimals={
            // Só onde afeta algo numérico: métricas, colunas numéricas/percentuais
            // ou o escopo linha (que atinge as células numéricas da linha).
            menu.scope === "row" ||
            menu.column.startsWith("__metric:") ||
            isNumericCol(menu.column) ||
            percentOf(menu.column)
              ? {
                  value: decimalsValue(menu),
                  onSelect: (d) => setDecimals(menu, d),
                }
              : undefined
          }
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
});
