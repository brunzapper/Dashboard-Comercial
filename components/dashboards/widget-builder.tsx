// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — bloco "Fontes" (multi-seleção) + toggle "Quebrar
//   por fonte"; os campos unificados (correspondências) já vêm em `available`.
// Construtor de widget (Sheet): fontes→dimensões→métricas→filtros→visual.
// Monta um WidgetConfig e salva via create/updateWidget.
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldForm } from "@/components/campos/field-form";
import type { FieldDefinition } from "@/lib/records/types";
import {
  FormulaBuilder,
  type RefOption,
} from "@/components/campos/formula-builder";
import { validateFormula, type Formula } from "@/lib/records/formulas";
import { SOURCE_KEYS, SOURCE_LABELS, type SourceKey } from "@/lib/sources";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DATE_TRANSFORMS,
  fieldLabel,
  type AvailableField,
} from "@/lib/widgets/fields";
import {
  DEFAULT_PERIOD_FIELD,
  PERIOD_PRESETS,
  type PeriodPresetKey,
} from "@/lib/widgets/period";
import {
  AGG_LABELS,
  DATE_AGG_LABELS,
  TRANSFORM_LABELS,
  VISUAL_TYPE_LABELS,
  type Aggregation,
  type DateAgg,
  type Dimension,
  type FieldFilterEntry,
  type FieldFilterSettings,
  type FilterOp,
  type FilterSettings,
  type Metric,
  type RecordListColumn,
  type RowSource,
  type Transform,
  type VisualType,
  type Widget,
  type WidgetFilter,
} from "@/lib/widgets/types";
import {
  cleanFilters as cleanFilterRows,
  FILTER_OPS,
  toFieldOptions,
} from "@/lib/widgets/filter-ops";
import type {
  ConversionBasis,
  CurrencyDisplay,
  CurrencyMultiMode,
  GrandTotalMode,
} from "@/lib/widgets/currency";
import { groupByLevels } from "@/lib/widgets/appearance";
import {
  createWidget,
  updateWidget,
} from "@/app/(app)/dashboards/actions";

const FILTER_OP_OPTIONS: ComboboxOption[] = FILTER_OPS.map((o) => ({
  value: o.op,
  label: o.label,
}));

// --- Opções de moeda das métricas monetárias (Parte C) ---
const CONVERSION_BASIS_OPTIONS: ComboboxOption[] = [
  { value: "record_year", label: "Ano do registro" },
  { value: "record_quarter", label: "Trimestre do registro" },
  { value: "period_year", label: "Ano do período" },
  { value: "period_quarter", label: "Trimestre do período" },
];
const CURRENCY_DISPLAY_OPTIONS: ComboboxOption[] = [
  { value: "original", label: "Só a moeda original" },
  { value: "converted", label: "Só convertido (R$)" },
  { value: "reference", label: "US$ original → R$ convertido" },
];
const CURRENCY_MULTI_OPTIONS: ComboboxOption[] = [
  { value: "convert", label: "Converter tudo (R$)" },
  { value: "separate", label: "Totais por moeda (separados)" },
  { value: "reference", label: "US$ total → R$ convertido" },
];
const GRAND_TOTAL_OPTIONS: ComboboxOption[] = [
  { value: "converted", label: "Total convertido (R$)" },
  { value: "dollar", label: "Total em US$" },
];

function basisValue(b?: ConversionBasis): string {
  return b ? `${b.source}_${b.granularity}` : "record_year";
}
function parseBasis(v: string): ConversionBasis {
  const [source, granularity] = v.split("_");
  return {
    source: source === "period" ? "period" : "record",
    granularity: granularity === "quarter" ? "quarter" : "year",
  };
}

export function WidgetBuilder({
  dashboardId,
  available,
  widget,
  siblings = [],
  trigger,
  canManageFields = false,
  fields = [],
  currencyOptions,
  tabs = [],
  activeTabId,
  open: controlledOpen,
  onOpenChange,
}: {
  dashboardId: string;
  available: AvailableField[];
  widget?: Widget;
  siblings?: Widget[];
  trigger?: React.ReactNode;
  canManageFields?: boolean;
  // Definições completas dos campos personalizados (p/ o ⋮ "Configurar campo").
  fields?: FieldDefinition[];
  // Moedas habilitadas (repassadas ao FieldForm embutido).
  currencyOptions?: ComboboxOption[];
  tabs?: { id: string; name: string; color?: string }[];
  activeTabId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [fieldSheetOpen, setFieldSheetOpen] = useState(false);
  // Campo em edição pelo ⋮ "Configurar campo" (null = criação de novo campo).
  const [editingField, setEditingField] = useState<FieldDefinition | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Definição personalizada por trás de um `custom:<key>` (p/ o ⋮).
  const fieldDefOf = (fieldStr: string): FieldDefinition | undefined =>
    fieldStr.startsWith("custom:")
      ? fields.find((f) => f.field_key === fieldStr.slice("custom:".length))
      : undefined;

  // Menu ⋮ ao lado de uma dimensão/métrica: abre a config do campo. Só p/ admins
  // (canManageFields); item desabilitado em campos do núcleo/unificados (sem def).
  const renderFieldMenu = (fieldStr: string) => {
    if (!canManageFields) return null;
    const def = fieldDefOf(fieldStr);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Configurar campo"
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!def}
            onSelect={(e) => {
              e.preventDefault();
              if (!def) return;
              setEditingField(def);
              setFieldSheetOpen(true);
            }}
          >
            <Pencil className="size-4" /> Configurar campo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Largura do painel de config, redimensionável arrastando a borda esquerda
  // (como as colunas/linhas das tabelas). Persistida no localStorage (chrome do
  // painel, não dado do widget). Default ~ sm:max-w-lg (512px).
  const PANEL_KEY = "widget-builder-width";
  const [panelWidth, setPanelWidth] = useState(512);
  useEffect(() => {
    const saved = Number(
      typeof window !== "undefined" ? window.localStorage.getItem(PANEL_KEY) : ""
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(saved) && saved >= 360) setPanelWidth(saved);
  }, []);
  const resizeRef = useRef<{ x: number; w: number } | null>(null);
  function onPanelResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    resizeRef.current = { x: e.clientX, w: panelWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPanelResizeMove(e: React.PointerEvent) {
    const d = resizeRef.current;
    if (!d) return;
    // Painel abre à direita: arrastar para a ESQUERDA (delta negativo) aumenta.
    const next = Math.min(
      typeof window !== "undefined" ? window.innerWidth * 0.95 : 1200,
      Math.max(360, Math.round(d.w - (e.clientX - d.x)))
    );
    setPanelWidth(next);
  }
  function onPanelResizeUp(e: React.PointerEvent) {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (typeof window !== "undefined")
      window.localStorage.setItem(PANEL_KEY, String(panelWidth));
  }

  // Operandos numéricos para fórmula ao criar um campo aqui: colunas numéricas
  // do catálogo, exceto as unificadas (não são operandos válidos).
  const fieldFormNumericRefs = available
    .filter((f) => f.isNumeric && !f.field.startsWith("unified:"))
    .map((f) => ({ ref: f.field, label: f.label }));

  const [title, setTitle] = useState(widget?.title ?? "");
  const [visualType, setVisualType] = useState<VisualType>(
    widget?.visual_type ?? "barra"
  );
  // No modo lista, as colunas exibidas são as Dimensões. Para widgets de lista
  // já existentes (que guardavam settings.columns), semeia as Dimensões a partir
  // delas para não "perder" as colunas ao abrir o editor.
  const initialDimensions: Dimension[] =
    widget?.settings?.rowMode === "records" &&
    (widget?.settings?.columns?.length ?? 0) > 0
      ? widget!.settings!.columns!.map((c) => ({
          field: c.field,
          label: c.label,
          transform: c.transform ?? "none",
          weekMode: c.weekMode,
        }))
      : (widget?.dimensions ?? []);
  const [dimensions, setDimensions] = useState<Dimension[]>(initialDimensions);
  const [metrics, setMetrics] = useState<Metric[]>(
    widget?.metrics ?? [{ field: "*", agg: "count" }]
  );
  const [filters, setFilters] = useState<WidgetFilter[]>(widget?.filters ?? []);
  const [sources, setSources] = useState<SourceKey[]>(widget?.sources ?? []);
  const [splitBySource, setSplitBySource] = useState<boolean>(
    widget?.split_by_source ?? false
  );

  // Aparência de tabela editada já no builder (Parte 2/3): orientação (normal x
  // transposta) e "Agrupar por" (dimensão que vira seções recolhíveis c/ subtotais).
  const [tableOrientation, setTableOrientation] = useState<"rows" | "columns">(
    widget?.settings?.appearance?.table?.orientation ?? "rows"
  );
  // Níveis de "Agrupar por" (hierarquia; 1º = grupo principal, demais aninhados).
  const [tableGroupBy, setTableGroupBy] = useState<string[]>(
    groupByLevels(widget?.settings?.appearance?.table?.groupBy)
  );

  // Modo "registros individuais" (Fase 1): tabela lista 1 linha por entidade.
  // As colunas vêm das Dimensões (painel unificado); campos personalizados não
  // calculados ficam editáveis por padrão (respeitando editable_by_roles) e
  // gravam de volta na entidade listada (registro/responsável/operação).
  const [recordsMode, setRecordsMode] = useState<boolean>(
    widget?.settings?.rowMode === "records"
  );
  const [rowSource, setRowSource] = useState<RowSource>(
    widget?.settings?.rowSource ?? "records"
  );
  const isRecordList = visualType === "tabela" && recordsMode;
  // Barra de busca/filtro embutida nas tabelas (ocultável). Default = visível.
  const [showFilterBar, setShowFilterBar] = useState<boolean>(
    widget?.settings?.showFilterBar !== false
  );

  // Dimensões dinâmicas (por eixo): o widget cresce p/ caber o conteúdo, sem
  // encolher abaixo do tamanho configurado. Só p/ tabela + gráficos.
  const [autoWidth, setAutoWidth] = useState<boolean>(
    widget?.settings?.autoSize?.width ?? false
  );
  const [autoHeight, setAutoHeight] = useState<boolean>(
    widget?.settings?.autoSize?.height ?? false
  );
  // Tipos que suportam dimensão dinâmica: tabela e gráficos (não kpi/calc/filtro).
  const supportsAutoSize =
    visualType === "tabela" ||
    visualType === "barra" ||
    visualType === "barra_horizontal" ||
    visualType === "linha" ||
    visualType === "pizza" ||
    visualType === "funil";

  // Flags por coluna no modo lista: editável + gravar no Bitrix. Semeadas das
  // colunas existentes (RecordListColumn.editable/writeBack).
  const [columnFlags, setColumnFlags] = useState<
    Record<string, { editable?: boolean; writeBack?: boolean }>
  >(() => {
    const m: Record<string, { editable?: boolean; writeBack?: boolean }> = {};
    for (const c of widget?.settings?.columns ?? [])
      m[c.field] = { editable: c.editable, writeBack: c.writeBack };
    return m;
  });
  const setColumnFlag = (
    field: string,
    patch: { editable?: boolean; writeBack?: boolean }
  ) =>
    setColumnFlags((prev) => ({ ...prev, [field]: { ...prev[field], ...patch } }));
  // Agregação por período (só p/ colunas de data no modo registros).
  const [columnAgg, setColumnAgg] = useState<Record<string, DateAgg>>(() => {
    const m: Record<string, DateAgg> = {};
    for (const c of widget?.settings?.columns ?? []) if (c.agg) m[c.field] = c.agg;
    return m;
  });
  // Editabilidade "legada": widgets antigos deixavam custom não calculado editável.
  const legacyEditable = (field: string) =>
    field.startsWith("custom:") &&
    (available.find((a) => a.field === field)?.editableCapable ?? false);
  const effEditable = (field: string): boolean =>
    columnFlags[field]?.editable ?? legacyEditable(field);

  // Fórmula da "Métrica calculada" (visual_type 'calculado').
  const [formula, setFormula] = useState<Formula>(
    widget?.settings?.formula ?? { tokens: [] }
  );

  // Aba (id) a que o widget pertence. Novo widget nasce na aba ativa; ao editar,
  // mantém a sua. Só relevante quando o dashboard tem abas configuradas.
  const [tabId, setTabId] = useState<string>(
    widget?.settings?.tab ?? activeTabId ?? ""
  );

  function toggleSource(key: SourceKey) {
    setSources((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }

  // Config do widget de filtro de período (visual_type 'filtro').
  const dateFields = available.filter((f) => f.isDate);
  const [filterField, setFilterField] = useState(
    widget?.settings?.field ?? DEFAULT_PERIOD_FIELD
  );
  const [filterTargets, setFilterTargets] = useState<string[]>(
    widget?.settings?.targets ?? []
  );
  const [filterPreset, setFilterPreset] = useState(
    widget?.settings?.defaultPreset ?? ""
  );
  // Widgets que este filtro pode controlar (exclui a si mesmo e os controles).
  const targetable = siblings.filter(
    (s) =>
      s.id !== widget?.id &&
      s.visual_type !== "filtro" &&
      s.visual_type !== "filtro_campo"
  );

  function toggleTarget(id: string) {
    setFilterTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  // Config do widget de "Filtro por campo" (visual_type 'filtro_campo').
  const [filterFields, setFilterFields] = useState<FieldFilterEntry[]>(
    widget?.settings?.fields ?? []
  );
  const [searchFieldRows, setSearchFieldRows] = useState<string[]>(
    widget?.settings?.searchFields ?? ["title"]
  );
  const [excludedTargets, setExcludedTargets] = useState<string[]>(
    widget?.settings?.excludedTargets ?? []
  );
  // Widgets de dados que este filtro pode atingir (mesmas fontes; vazio = todas).
  const dataSiblings = siblings.filter(
    (s) =>
      s.id !== widget?.id &&
      s.visual_type !== "filtro" &&
      s.visual_type !== "filtro_campo"
  );
  const affectedSiblings = dataSiblings.filter((s) => {
    const b = s.sources ?? [];
    if (sources.length === 0 || b.length === 0) return true;
    return sources.some((x) => b.includes(x));
  });
  function toggleExcluded(id: string) {
    setExcludedTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  const numericFields = available.filter((f) => f.isNumeric);

  // Métrica monetária (value/mrr ou campo moeda/calc-moeda): habilita as opções
  // de moeda/conversão da métrica.
  const isMoneyField = (field: string): boolean =>
    available.find((a) => a.field === field)?.isMoney ?? false;
  const updateMetric = (i: number, patch: Partial<Metric>) => {
    const next = [...metrics];
    next[i] = { ...metrics[i], ...patch };
    setMetrics(next);
  };

  // Refs disponíveis para a Métrica calculada: agregações de registros.
  const calcRefs: RefOption[] = [
    { ref: "agg:count:*", label: "Contagem de registros", group: "Registros" },
    ...numericFields.flatMap((f) => [
      { ref: `agg:sum:${f.field}`, label: `Σ ${f.label}`, group: "Registros" },
      { ref: `agg:avg:${f.field}`, label: `Média ${f.label}`, group: "Registros" },
    ]),
  ];

  const availableOptions = toFieldOptions(available);
  const metricOptions: ComboboxOption[] = [
    { value: "*", label: "Contagem de registros" },
    ...toFieldOptions(numericFields),
  ];
  const visualOptions: ComboboxOption[] = (
    Object.keys(VISUAL_TYPE_LABELS) as VisualType[]
  ).map((v) => ({ value: v, label: VISUAL_TYPE_LABELS[v] }));
  // Só os formatos de data curados aparecem (day/week/month legados ficam fora).
  const transformOptions: ComboboxOption[] = DATE_TRANSFORMS.map((t) => ({
    value: t,
    label: TRANSFORM_LABELS[t],
  }));
  const dateAggOptions: ComboboxOption[] = (
    Object.keys(DATE_AGG_LABELS) as DateAgg[]
  ).map((a) => ({ value: a, label: DATE_AGG_LABELS[a] }));
  const aggOptions: ComboboxOption[] = (
    Object.keys(AGG_LABELS) as Aggregation[]
  ).map((a) => ({ value: a, label: AGG_LABELS[a] }));
  const presetOptions: ComboboxOption[] = [
    { value: "", label: "Todo o período" },
    ...(Object.keys(PERIOD_PRESETS) as PeriodPresetKey[]).map((k) => ({
      value: k,
      label: PERIOD_PRESETS[k],
    })),
  ];
  const dateFieldOptions: ComboboxOption[] = dateFields.map((f) => ({
    value: f.field,
    label: f.label,
  }));

  function isDate(field: string): boolean {
    return available.find((a) => a.field === field)?.isDate ?? false;
  }

  // Opções de orientação e "Agrupar por" da tabela agregada (Parte 2/3). As keys
  // do groupBy espelham as que o engine gera em runtime (`dim_<n>`), respeitando
  // o deslocamento quando "Quebrar por fonte" injeta record_type como dim_1.
  const orientationOptions: ComboboxOption[] = [
    { value: "rows", label: "Cabeçalho acima (resultados em linhas)" },
    { value: "columns", label: "Cabeçalho à esquerda (transposta)" },
  ];
  const groupByOffset = splitBySource ? 1 : 0;
  // No modo registros as dimensões SÃO as colunas da tabela, então o "Agrupar por"
  // é chaveado pelo próprio campo (`d.field`). No modo agregado, espelha as keys de
  // runtime do engine (`dim_<n>`), com deslocamento quando "Quebrar por fonte".
  const groupByOptions: ComboboxOption[] = [
    ...(!isRecordList && splitBySource
      ? [{ value: "dim_1", label: "Fonte" }]
      : []),
    ...dimensions
      .filter((d) => d.field)
      .map((d, i) => ({
        value: isRecordList ? d.field : `dim_${groupByOffset + i + 1}`,
        label: available.find((a) => a.field === d.field)?.label ?? d.field,
      })),
  ];
  // Opções disponíveis para um nível: exclui as keys já usadas nos OUTROS níveis
  // (evita agrupar duas vezes pela mesma dimensão), preservando a do próprio nível.
  const levelOptions = (idx: number): ComboboxOption[] => {
    const used = new Set(tableGroupBy.filter((_, i) => i !== idx));
    return groupByOptions.filter(
      (o) => o.value === tableGroupBy[idx] || !used.has(o.value)
    );
  };
  // Só permite adicionar mais um nível se ainda há dimensões livres.
  const canAddGroupLevel =
    tableGroupBy.filter(Boolean).length < groupByOptions.length;
  const addGroupLevel = () => setTableGroupBy((prev) => [...prev, ""]);
  const setGroupLevel = (idx: number, value: string) =>
    setTableGroupBy((prev) => prev.map((v, i) => (i === idx ? value : v)));
  const removeGroupLevel = (idx: number) =>
    setTableGroupBy((prev) => prev.filter((_, i) => i !== idx));

  function save() {
    setError(null);

    // Aba do widget (dashboards com abas): mesclada em settings de todos os tipos.
    const tabPatch = tabId ? { tab: tabId } : {};

    // Widget de filtro: sem dimensões/métricas/filtros; config vai em settings.
    if (visualType === "filtro") {
      const settings: FilterSettings = {
        kind: "period",
        field: filterField,
        targets: filterTargets,
        defaultPreset: filterPreset,
      };
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: { ...settings, ...tabPatch },
      };
      startTransition(async () => {
        const res = widget
          ? await updateWidget(widget.id, dashboardId, input)
          : await createWidget(dashboardId, input);
        if (res.ok) setOpen(false);
        else setError(res.message ?? "Falha ao salvar.");
      });
      return;
    }

    // Filtro por campo: filtra widgets-alvo por campo/valor e/ou busca. Guarda
    // `sources` (escopo), os campos expostos, os campos de busca e os alvos
    // desmarcados. Sem dimensões/métricas/filtros próprios.
    if (visualType === "filtro_campo") {
      const settings: FieldFilterSettings = {
        fields: filterFields.filter((f) => f.field),
        searchFields: searchFieldRows.filter(Boolean),
        excludedTargets,
      };
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: { ...settings, ...tabPatch },
      };
      startTransition(async () => {
        const res = widget
          ? await updateWidget(widget.id, dashboardId, input)
          : await createWidget(dashboardId, input);
        if (res.ok) setOpen(false);
        else setError(res.message ?? "Falha ao salvar.");
      });
      return;
    }

    // Métrica calculada: valida a fórmula (refs vêm do próprio seletor, mas
    // conferimos estrutura/parênteses) e grava em settings.formula.
    if (visualType === "calculado") {
      if (formula.tokens.length > 0) {
        const allowed = new Set(calcRefs.map((r) => r.ref));
        const v = validateFormula(formula, allowed);
        if (!v.ok) {
          setError(v.error ?? "Fórmula inválida.");
          return;
        }
      }
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: [],
        splitBySource: false,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: { ...(widget?.settings ?? {}), formula, ...tabPatch },
      };
      startTransition(async () => {
        const res = widget
          ? await updateWidget(widget.id, dashboardId, input)
          : await createWidget(dashboardId, input);
        if (res.ok) setOpen(false);
        else setError(res.message ?? "Falha ao salvar.");
      });
      return;
    }

    const cleanFilters = cleanFilterRows(filters);
    // Preserva settings existentes (ex.: KPI meta/razão) e liga/desliga o modo
    // lista de registros (Fase 1) conforme o toggle. No modo lista, as colunas
    // exibidas são as próprias Dimensões (painel unificado), na ordem escolhida.
    let settings = { ...(widget?.settings ?? {}) };
    if (isRecordList) {
      settings = {
        ...settings,
        rowMode: "records",
        rowSource,
        columns: dimensions
          .filter((d) => d.field)
          .map((d) => {
            const af = available.find((a) => a.field === d.field);
            const canEditCol = af?.editableCapable ?? false;
            const editable = canEditCol ? effEditable(d.field) : false;
            const col: RecordListColumn = { field: d.field, editable };
            if (d.label?.trim()) col.label = d.label.trim();
            if (editable && af?.writable && columnFlags[d.field]?.writeBack)
              col.writeBack = true;
            // Formato/agrupamento por período (só colunas de data).
            if (af?.isDate && d.transform && d.transform !== "none") {
              col.transform = d.transform;
              if (d.transform === "week_month") col.weekMode = d.weekMode;
              const agg = columnAgg[d.field] ?? "individual";
              if (agg !== "individual") col.agg = agg;
            }
            return col;
          }),
      };
    } else {
      delete settings.rowMode;
      delete settings.rowSource;
      delete settings.columns;
    }

    // Barra de busca/filtro embutida: só nas tabelas; guarda quando oculta.
    if (visualType === "tabela") {
      if (showFilterBar) delete settings.showFilterBar;
      else settings.showFilterBar = false;
    }

    // Dimensões dinâmicas: grava só quando algum eixo está ligado (jsonb limpo).
    if (supportsAutoSize && (autoWidth || autoHeight)) {
      settings.autoSize = { width: autoWidth, height: autoHeight };
    } else {
      delete settings.autoSize;
    }

    // Orientação/agrupamento da tabela: grava em appearance.table preservando as
    // demais chaves de aparência. Orientação só existe na Tabela agregada; o
    // agrupamento vale nos dois modos (agregada por dimensão `dim_<n>`, registros
    // por coluna `c.field`). Nos outros tipos, limpa para não deixar lixo.
    if (visualType === "tabela") {
      const table = { ...(settings.appearance?.table ?? {}) };
      // Níveis válidos (sem vazios), hierarquia de cima para baixo.
      const groupLevels = tableGroupBy.filter(Boolean);
      if (isRecordList) {
        // Modo registros: sem orientação transposta.
        delete table.orientation;
        if (groupLevels.length > 0) table.groupBy = groupLevels;
        else delete table.groupBy;
      } else {
        table.orientation = tableOrientation;
        // Transposta não combina com agrupamento nesta entrega.
        if (groupLevels.length > 0 && tableOrientation !== "columns")
          table.groupBy = groupLevels;
        else delete table.groupBy;
      }
      settings = {
        ...settings,
        appearance: { ...(settings.appearance ?? {}), table },
      };
    }

    const input = {
      title: title.trim() || null,
      visual_type: visualType,
      sources,
      splitBySource,
      dimensions: dimensions.filter((d) => d.field),
      metrics: metrics.filter((m) => m.field),
      filters: cleanFilters,
      settings: { ...settings, ...tabPatch },
    };
    startTransition(async () => {
      const res = widget
        ? await updateWidget(widget.id, dashboardId, input)
        : await createWidget(dashboardId, input);
      if (res.ok) {
        setOpen(false);
      } else {
        setError(res.message ?? "Falha ao salvar.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent
        className="overflow-y-auto sm:max-w-none"
        style={{ width: panelWidth, maxWidth: "95vw" }}
      >
        {/* Alça de redimensionamento (borda esquerda do painel). */}
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar painel"
          title="Arraste para redimensionar o painel"
          onPointerDown={onPanelResizeDown}
          onPointerMove={onPanelResizeMove}
          onPointerUp={onPanelResizeUp}
          onPointerCancel={onPanelResizeUp}
          className="hover:bg-primary/40 absolute top-0 left-0 z-20 h-full w-1.5 cursor-col-resize"
        />
        <SheetHeader>
          <SheetTitle>{widget ? "Editar widget" : "Novo widget"}</SheetTitle>
          <SheetDescription>
            Escolha as fontes, dimensões, métricas, filtros e o visual.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          <div className="flex flex-col gap-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          {tabs.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>Aba</Label>
              <Combobox
                searchable={false}
                options={tabs.map((t) => ({ value: t.id, label: t.name }))}
                value={tabId || tabs[0].id}
                onValueChange={setTabId}
                aria-label="Aba do widget"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label>Visual</Label>
            <Combobox
              options={visualOptions}
              value={visualType}
              onValueChange={(v) => setVisualType(v as VisualType)}
              aria-label="Visual"
            />
          </div>

          {/* Config do widget de filtro de período */}
          {visualType === "filtro" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Campo de data</Label>
                <Combobox
                  options={dateFieldOptions}
                  value={filterField}
                  onValueChange={setFilterField}
                  aria-label="Campo de data"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Período padrão</Label>
                <Combobox
                  options={presetOptions}
                  value={filterPreset}
                  onValueChange={setFilterPreset}
                  aria-label="Período padrão"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Vincular a</Label>
                <p className="text-muted-foreground text-xs">
                  Escolha quais widgets este filtro controla. Sem seleção, ele
                  controla o dashboard inteiro.
                </p>
                {targetable.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Nenhum outro widget para vincular ainda.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    {targetable.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={filterTargets.includes(s.id)}
                          onCheckedChange={() => toggleTarget(s.id)}
                        />
                        {s.title ?? "Sem título"}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}

          {/* Config do widget de "Filtro por campo" */}
          {visualType === "filtro_campo" ? (
            <>
              <div className="flex flex-col gap-2">
                <Label>Fontes</Label>
                <p className="text-muted-foreground text-xs">
                  Sem seleção = todas as fontes. Este filtro atinge os widgets
                  cujas fontes se sobrepõem às escolhidas aqui.
                </p>
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  {SOURCE_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={sources.includes(key)}
                        onCheckedChange={() => toggleSource(key)}
                      />
                      {SOURCE_LABELS[key]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>Campos de busca (texto)</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearchFieldRows([...searchFieldRows, ""])}
                  >
                    <Plus className="size-4" /> Adicionar
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Colunas varridas pela caixa de busca (OR entre elas).
                </p>
                {searchFieldRows.map((sf, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Combobox
                      className="flex-1"
                      options={availableOptions}
                      value={sf}
                      placeholder="— campo —"
                      onValueChange={(field) => {
                        const next = [...searchFieldRows];
                        next[i] = field;
                        setSearchFieldRows(next);
                      }}
                      aria-label="Campo de busca"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setSearchFieldRows(
                          searchFieldRows.filter((_, j) => j !== i)
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>Campos filtráveis</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setFilterFields([...filterFields, { field: "", op: "eq" }])
                    }
                  >
                    <Plus className="size-4" /> Adicionar
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Cada campo vira um controle no widget; o valor é digitado na
                  visualização.
                </p>
                {filterFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Combobox
                      className="flex-1"
                      options={availableOptions}
                      value={f.field}
                      placeholder="— campo —"
                      onValueChange={(field) => {
                        const next = [...filterFields];
                        next[i] = { ...f, field };
                        setFilterFields(next);
                      }}
                      aria-label="Campo filtrável"
                    />
                    <Combobox
                      className="w-28 shrink-0"
                      searchable={false}
                      options={FILTER_OP_OPTIONS}
                      value={f.op ?? "eq"}
                      onValueChange={(op) => {
                        const next = [...filterFields];
                        next[i] = { ...f, op: op as FilterOp };
                        setFilterFields(next);
                      }}
                      aria-label="Operador"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setFilterFields(filterFields.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <Label>Aplicar a</Label>
                <p className="text-muted-foreground text-xs">
                  Por padrão atinge todos os widgets com fonte sobreposta.
                  Desmarque os que não devem reagir.
                </p>
                {affectedSiblings.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Nenhum widget de dados compatível ainda.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    {affectedSiblings.map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={!excludedTargets.includes(s.id)}
                          onCheckedChange={() => toggleExcluded(s.id)}
                        />
                        {s.title ?? "Sem título"}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}

          {/* Métrica calculada: fórmula sobre agregações dos registros */}
          {visualType === "calculado" ? (
            <div className="flex flex-col gap-1.5">
              <Label>Fórmula</Label>
              <FormulaBuilder
                refs={calcRefs}
                initial={widget?.settings?.formula ?? null}
                onChange={setFormula}
              />
              <p className="text-muted-foreground text-xs">
                Combine agregações dos registros (+ − × ÷ e constantes).
              </p>
            </div>
          ) : null}

          {/* Fontes + modo de combinação */}
          {visualType !== "filtro" &&
          visualType !== "filtro_campo" &&
          visualType !== "calculado" ? (
          <>
          <div className="flex flex-col gap-2">
            <Label>Fontes</Label>
            <p className="text-muted-foreground text-xs">
              Sem seleção = todas as fontes. Colunas correspondidas (↔) somam
              entre as fontes escolhidas.
            </p>
            <div className="flex flex-col gap-2 rounded-md border p-3">
              {SOURCE_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sources.includes(key)}
                    onCheckedChange={() => toggleSource(key)}
                  />
                  {SOURCE_LABELS[key]}
                </label>
              ))}
            </div>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <Checkbox
                checked={splitBySource}
                onCheckedChange={(v) => setSplitBySource(v === true)}
              />
              Quebrar por fonte (uma série por fonte)
            </label>
          </div>

          {/* Modo lista de registros (só para Tabela) */}
          {visualType === "tabela" ? (
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={recordsMode}
                  onCheckedChange={(v) => setRecordsMode(v === true)}
                />
                Linhas = registros individuais (permite editar valores)
              </label>
              {isRecordList ? (
                <div className="flex flex-col gap-1.5">
                  <Label>Fonte das linhas</Label>
                  <Combobox
                    searchable={false}
                    options={[
                      { value: "records", label: "Registros" },
                      { value: "responsibles", label: "Responsáveis" },
                      { value: "operations", label: "Operações" },
                    ]}
                    value={rowSource}
                    onValueChange={(v) => setRowSource(v as RowSource)}
                    aria-label="Fonte das linhas"
                  />
                  <p className="text-muted-foreground text-xs">
                    As colunas são as Dimensões abaixo (na ordem). Campos
                    personalizados não calculados ficam editáveis (se o papel
                    permitir) e gravam na entidade listada.
                  </p>
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={showFilterBar}
                  onCheckedChange={(v) => setShowFilterBar(v === true)}
                />
                Mostrar barra de busca/filtro na tabela
              </label>
            </div>
          ) : null}

          {/* Dimensões dinâmicas: cresce p/ caber o conteúdo (por eixo) */}
          {supportsAutoSize ? (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <Label>Tamanho dinâmico</Label>
              <p className="text-muted-foreground text-xs">
                O widget cresce para caber o conteúdo e nunca encolhe abaixo do
                tamanho atual (o mínimo). Redimensione pela alça para definir esse
                mínimo.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={autoWidth}
                  onCheckedChange={(v) => setAutoWidth(v === true)}
                />
                Largura dinâmica (cresce com o conteúdo)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={autoHeight}
                  onCheckedChange={(v) => setAutoHeight(v === true)}
                />
                Altura dinâmica (cresce com o conteúdo)
              </label>
            </div>
          ) : null}

          {/* Criar coluna direto no editor (admins) */}
          {canManageFields ? (
            <div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2">
              <span className="text-muted-foreground text-xs">
                Falta uma coluna? Crie sem sair do editor.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingField(null);
                  setFieldSheetOpen(true);
                }}
              >
                <Plus className="size-4" /> Novo campo
              </Button>
            </div>
          ) : null}

          {/* Dimensões (no modo lista, definem também as colunas exibidas) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>
                {isRecordList ? "Dimensões (colunas da tabela)" : "Dimensões"}
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDimensions([...dimensions, { field: "", transform: "none" }])}
              >
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
            {dimensions.map((d, i) => {
              const af = available.find((a) => a.field === d.field);
              const editable = effEditable(d.field);
              return (
              <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Combobox
                  className="flex-1"
                  options={availableOptions}
                  value={d.field}
                  placeholder="— campo —"
                  onValueChange={(field) => {
                    const next = [...dimensions];
                    next[i] = { ...d, field };
                    setDimensions(next);
                  }}
                  aria-label="Campo da dimensão"
                />
                {isDate(d.field) ? (
                  <Combobox
                    className="w-32 shrink-0"
                    searchable={false}
                    options={transformOptions}
                    value={d.transform ?? "none"}
                    onValueChange={(t) => {
                      const next = [...dimensions];
                      next[i] = { ...d, transform: t as Transform };
                      setDimensions(next);
                    }}
                    aria-label="Transformação de data"
                  />
                ) : null}
                {isDate(d.field) && d.transform === "week_month" ? (
                  <Combobox
                    className="w-28 shrink-0"
                    searchable={false}
                    options={[
                      { value: "restricted", label: "Restrita" },
                      { value: "full", label: "Cheia" },
                    ]}
                    value={d.weekMode ?? "restricted"}
                    onValueChange={(wm) => {
                      const next = [...dimensions];
                      next[i] = { ...d, weekMode: wm as "full" | "restricted" };
                      setDimensions(next);
                    }}
                    aria-label="Modo da semana do mês"
                  />
                ) : null}
                {d.field ? renderFieldMenu(d.field) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setDimensions(dimensions.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {d.field ? (
                <Input
                  className="h-8 text-sm"
                  placeholder={`Nome exibido (padrão: ${fieldLabel(d.field, available)})`}
                  value={d.label ?? ""}
                  onChange={(e) => {
                    const next = [...dimensions];
                    next[i] = { ...d, label: e.target.value };
                    setDimensions(next);
                  }}
                  aria-label="Nome exibido da dimensão"
                />
              ) : null}
              {isDate(d.field) && d.transform && d.transform !== "none" ? (
                <div className="flex items-center gap-2 pl-1">
                  <Label className="text-muted-foreground w-28 shrink-0 text-xs">
                    Agrupar período
                  </Label>
                  <Combobox
                    className="h-8 flex-1 text-sm"
                    searchable={false}
                    options={
                      isRecordList
                        ? dateAggOptions
                        : [
                            { value: "", label: "Padrão (agregado)" },
                            ...dateAggOptions,
                          ]
                    }
                    value={
                      isRecordList
                        ? columnAgg[d.field] ?? "individual"
                        : d.dateAgg ?? ""
                    }
                    onValueChange={(a) => {
                      if (isRecordList) {
                        setColumnAgg((prev) => ({
                          ...prev,
                          [d.field]: a as DateAgg,
                        }));
                      } else {
                        const next = [...dimensions];
                        next[i] = {
                          ...d,
                          dateAgg: a ? (a as DateAgg) : undefined,
                        };
                        setDimensions(next);
                      }
                    }}
                    aria-label="Agregação por período"
                  />
                </div>
              ) : null}
              {isRecordList && d.field && af?.editableCapable ? (
                <div className="text-muted-foreground flex items-center gap-4 pl-1 text-xs">
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={editable}
                      onCheckedChange={(c) =>
                        setColumnFlag(d.field, { editable: c === true })
                      }
                    />
                    Editável
                  </label>
                  {editable && af?.writable ? (
                    <label className="flex items-center gap-1.5">
                      <Checkbox
                        checked={columnFlags[d.field]?.writeBack ?? false}
                        onCheckedChange={(c) =>
                          setColumnFlag(d.field, { writeBack: c === true })
                        }
                      />
                      Gravar no Bitrix
                    </label>
                  ) : null}
                </div>
              ) : null}
              </div>
            );
            })}
          </div>

          {/* Orientação (só Tabela agregada) + Agrupar por (ambos os modos) */}
          {visualType === "tabela" ? (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              {!isRecordList ? (
                <div className="flex flex-col gap-1.5">
                  <Label>Orientação</Label>
                  <Combobox
                    searchable={false}
                    options={orientationOptions}
                    value={tableOrientation}
                    onValueChange={(v) =>
                      setTableOrientation(v as "rows" | "columns")
                    }
                    aria-label="Orientação da tabela"
                  />
                </div>
              ) : null}
              {(() => {
                const groupDisabled =
                  !isRecordList && tableOrientation === "columns";
                return (
                  <div className="flex flex-col gap-1.5">
                    <Label>Agrupar por</Label>
                    {tableGroupBy.map((level, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                          {idx + 1}.
                        </span>
                        <div className="flex-1">
                          <Combobox
                            searchable={false}
                            options={levelOptions(idx)}
                            value={level}
                            placeholder="— selecione —"
                            disabled={groupDisabled}
                            onValueChange={(v) => setGroupLevel(idx, v)}
                            aria-label={`Agrupar por — nível ${idx + 1}`}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                          disabled={groupDisabled}
                          onClick={() => removeGroupLevel(idx)}
                          title="Remover nível"
                          aria-label={`Remover nível ${idx + 1}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      disabled={groupDisabled || !canAddGroupLevel}
                      onClick={addGroupLevel}
                    >
                      <Plus className="size-4" />
                      {tableGroupBy.length === 0
                        ? "Agrupar por…"
                        : "Adicionar nível"}
                    </Button>
                    <p className="text-muted-foreground text-xs">
                      Agrupa as linhas por uma ou mais{" "}
                      {isRecordList ? "colunas" : "dimensões"} em seções
                      recolhíveis com subtotais. Vários níveis criam uma
                      hierarquia (o 1º é o grupo principal, os demais aninham
                      dentro). Os grupos abrem recolhidos por padrão.
                      {!isRecordList
                        ? " Indisponível na orientação transposta."
                        : ""}
                    </p>
                  </div>
                );
              })()}
            </div>
          ) : null}

          {/* Métricas */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Métricas</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMetrics([...metrics, { field: "*", agg: "count" }])}
              >
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
            {metrics.map((m, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                <Combobox
                  className="flex-1"
                  options={metricOptions}
                  value={m.field}
                  onValueChange={(field) => {
                    const next = [...metrics];
                    next[i] = { ...m, field, agg: field === "*" ? "count" : m.agg };
                    setMetrics(next);
                  }}
                  aria-label="Campo da métrica"
                />
                <Combobox
                  className="w-28 shrink-0"
                  searchable={false}
                  options={aggOptions}
                  value={m.agg}
                  disabled={m.field === "*"}
                  onValueChange={(a) => {
                    const next = [...metrics];
                    next[i] = { ...m, agg: a as Aggregation };
                    setMetrics(next);
                  }}
                  aria-label="Agregação"
                />
                {m.field && m.field !== "*" ? renderFieldMenu(m.field) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setMetrics(metrics.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
                </div>
                {m.field && m.field !== "*" ? (
                  <Input
                    className="h-8 text-sm"
                    placeholder={`Nome exibido (padrão: ${AGG_LABELS[m.agg]} · ${fieldLabel(m.field, available)})`}
                    value={m.label ?? ""}
                    onChange={(e) => {
                      const next = [...metrics];
                      next[i] = { ...m, label: e.target.value };
                      setMetrics(next);
                    }}
                    aria-label="Nome exibido da métrica"
                  />
                ) : null}
                {isMoneyField(m.field) ? (
                  <div className="grid grid-cols-2 gap-2 rounded-md border p-2">
                    <div className="flex flex-col gap-1">
                      <Label className="text-muted-foreground text-xs">
                        Base da taxa
                      </Label>
                      <Combobox
                        className="h-8 text-sm"
                        searchable={false}
                        options={CONVERSION_BASIS_OPTIONS}
                        value={basisValue(m.conversionBasis)}
                        onValueChange={(v) =>
                          updateMetric(i, { conversionBasis: parseBasis(v) })
                        }
                        aria-label="Base da taxa de conversão"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-muted-foreground text-xs">
                        Exibição (1 moeda)
                      </Label>
                      <Combobox
                        className="h-8 text-sm"
                        searchable={false}
                        options={CURRENCY_DISPLAY_OPTIONS}
                        value={m.currencyDisplay ?? "original"}
                        onValueChange={(v) =>
                          updateMetric(i, { currencyDisplay: v as CurrencyDisplay })
                        }
                        aria-label="Exibição para moeda única"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-muted-foreground text-xs">
                        Exibição (várias)
                      </Label>
                      <Combobox
                        className="h-8 text-sm"
                        searchable={false}
                        options={CURRENCY_MULTI_OPTIONS}
                        value={m.currencyMultiMode ?? "convert"}
                        onValueChange={(v) =>
                          updateMetric(i, {
                            currencyMultiMode: v as CurrencyMultiMode,
                          })
                        }
                        aria-label="Exibição para várias moedas"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-muted-foreground text-xs">
                        Total geral
                      </Label>
                      <Combobox
                        className="h-8 text-sm"
                        searchable={false}
                        options={GRAND_TOTAL_OPTIONS}
                        value={m.grandTotalMode ?? "converted"}
                        onValueChange={(v) =>
                          updateMetric(i, { grandTotalMode: v as GrandTotalMode })
                        }
                        aria-label="Total geral"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* Filtros */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Filtros</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFilters([...filters, { field: "", op: "eq", value: "" }])}
              >
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
            {filters.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <Combobox
                  className="flex-1"
                  options={availableOptions}
                  value={f.field}
                  placeholder="— campo —"
                  onValueChange={(field) => {
                    const next = [...filters];
                    next[i] = { ...f, field };
                    setFilters(next);
                  }}
                  aria-label="Campo do filtro"
                />
                <Combobox
                  className="w-28 shrink-0"
                  searchable={false}
                  options={FILTER_OP_OPTIONS}
                  value={f.op}
                  onValueChange={(op) => {
                    const next = [...filters];
                    next[i] = { ...f, op: op as FilterOp };
                    setFilters(next);
                  }}
                  aria-label="Operador do filtro"
                />
                {f.op !== "is_null" && f.op !== "not_null" ? (
                  <Input
                    value={String(f.value ?? "")}
                    onChange={(e) => {
                      const next = [...filters];
                      next[i] = { ...f, value: e.target.value };
                      setFilters(next);
                    }}
                    placeholder="valor"
                  />
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          </>
          ) : null}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <Button onClick={save} disabled={pending}>
            {pending ? "Salvando..." : "Salvar widget"}
          </Button>
        </div>
      </SheetContent>

      {/* Criar/CONFIGURAR campo sem sair do editor: reusa o FieldForm de /campos;
          ao salvar, router.refresh() recomputa `available`/`fields`. Em modo edição
          (⋮ "Configurar campo") só fecha e atualiza; em criação, já insere o campo. */}
      {canManageFields ? (
        <Sheet
          open={fieldSheetOpen}
          onOpenChange={(o) => {
            setFieldSheetOpen(o);
            if (!o) setEditingField(null);
          }}
        >
          <SheetContent className="overflow-y-auto">
            <SheetHeader>
              <SheetTitle>
                {editingField ? "Configurar campo" : "Novo campo"}
              </SheetTitle>
              <SheetDescription>
                {editingField
                  ? "Edite este campo sem sair do construtor. As mudanças refletem no widget ao salvar."
                  : "A coluna nasce disponível nos seletores (Exibir ligado). Atualizamos a lista automaticamente ao salvar."}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              <FieldForm
                key={editingField?.id ?? (fieldSheetOpen ? "open" : "closed")}
                field={editingField ?? undefined}
                numericRefs={fieldFormNumericRefs}
                currencyOptions={currencyOptions}
                onDone={(created) => {
                  const wasEditing = Boolean(editingField);
                  setFieldSheetOpen(false);
                  setEditingField(null);
                  // Só na CRIAÇÃO o campo recém-criado entra como dimensão.
                  if (!wasEditing && created?.field_key) {
                    const ref = `custom:${created.field_key}`;
                    setDimensions((prev) =>
                      prev.some((d) => d.field === ref)
                        ? prev
                        : [...prev, { field: ref, transform: "none" }]
                    );
                  }
                  router.refresh();
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </Sheet>
  );
}
