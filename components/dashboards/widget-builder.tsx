// Versão: 1.17 | Data: 20/07/2026
// v1.17 (20/07/2026): widget "calculado" e variáveis da calculadora usam o
//   FormulaEditor unificado (visual com cursor + paleta de funções + validação
//   viva); as variáveis ganharam o editor completo (antes texto-only).
// v1.16 (20/07/2026): UX de fórmulas — rótulos claros ("Escrever a fórmula
//   neste widget", "ƒ Métrica calculada (fórmula própria)…"), ajuda do campo
//   salvo com o trade-off reutilizável×local e hint "?" dos escopos de fonte
//   junto ao rótulo Fórmula do widget calculado (movido p/ dentro do editor).
// v1.15 (18/07/2026): "Formato do grupo" estendido à tabela AGREGADA (níveis
//   dim_<n> de data sem transform "por nome" — groupFormatEligible) e lista
//   "Fonte do dado" por dimensão unificada no modo registros (hierarquia de
//   fontes com fallback → RecordListColumn.unifiedSources, poda no save).
// v1.14 (18/07/2026): "Formato do grupo" por nível do "Agrupar por" (listas de
//   registros/entidades, colunas de data) — grava appearance.table.
//   groupDateFormats; o grupo funde/rotula pelo formato escolhido sem alterar
//   o formato da dimensão nas linhas expandidas.
// v1.13 (18/07/2026): seletor "Fontes da métrica" (Metric.sources) por linha
//   de métrica — opções do catálogo INTEIRO (ampliar é o ponto; diferente do
//   seletor dos filtros, restrito às fontes do widget) e normalização no save
//   (cleanMetricSources).
// v1.12 (18/07/2026): na EDIÇÃO o painel fecha ao salvar e o processamento é
//   sinalizado no card (prop onPendingChange espelha o pending do save; em
//   erro o painel reabre com o formulário intacto).
// v1.11 (17/07/2026): painel (SheetContent) com bg-muted e linhas de filtro
//   rápido com bg-card — cards brancos destacados sobre o fundo cinza.
// v1.10 (17/07/2026): todas as seções recolhíveis abrem fechadas (sem
//   defaultValue no Accordion) — expandir sob demanda; badges seguem resumindo.
// v1.9 (17/07/2026): modo Posicionar — na criação, o botão vira "Posicionar" e
//   entrega o input ao shell via onRequestPlacement (pré-criação em segundo
//   plano + clique no canvas define a posição). Rabos idênticos dos branches
//   do save() extraídos em commit(); newWidgetPosition parametrizado (w, h por
//   tipo, via DEFAULT_WIDGET_SIZE).
// v1.8 (15/07/2026): widget "Tabela Livre" (tabela_editavel) — branch no
//   save() (estrutura em settings.quickTable; grade padrão 3×3 na criação),
//   hint no formulário e botão "Desenhar no painel" (onRequestDraw fecha o
//   Sheet e arma o desenho no canvas com o título digitado).
// v1.7 (15/07/2026): widgets calculadora/nota/forma — seção de variáveis da
//   calculadora (nome + fórmula agregada), seção da forma (tipo/texto/atalho
//   via WidgetLinkPicker), hint da nota (texto é editado direto no card) e
//   branches próprios no save() (config em settings; sem dimensões/métricas).
// v1.6 (15/07/2026): correção da digitação no "Nome exibido" das métricas —
//   calcRefs memoizado (identidade estável p/ os editores de fórmula) e
//   updates de métrica/dimensão/filtro em forma funcional (sem snapshot
//   obsoleto); "Contagem de registros" também ganha o campo "Nome exibido".
// v1.5 (15/07/2026): filtros segmentados por fonte — cada linha de filtro ganha
//   o seletor "Fontes" (pass-through: só as fontes marcadas são restringidas).
// v1.4 (15/07/2026): formato "Percentual (%)" nas métricas calculadas ad-hoc
//   (resultPercent propagado/limpo na troca de campo).
// v1.3 (14/07/2026): merge com a main — métricas calculadas de agregados
//   (campos "Calculado (totais)" e sentinela 'calc:formula') portadas para o
//   layout em seções (a UI da linha vive em widget-builder-rows.tsx/MetricRow).
// v1.2 (13/07/2026): UX — bloco de dados reorganizado em seções recolhíveis
//   (Accordion) com badge de resumo; linhas de dimensão/métrica/filtro viram
//   cards (widget-builder-rows.tsx). Sem mudança de comportamento/salvamento.
// v1.1 (09/07/2026): Fase 8 — bloco "Fontes" (multi-seleção) + toggle "Quebrar
//   por fonte"; os campos unificados (correspondências) já vêm em `available`.
// Construtor de widget (Sheet): fontes→dimensões→métricas→filtros→visual.
// Monta um WidgetConfig e salva via create/updateWidget.
"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreVertical,
  Pencil,
  Plus,
  SquareDashedMousePointer,
  Trash2,
} from "lucide-react";

import { Accordion } from "@/components/ui/accordion";
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
import type { RefOption } from "@/lib/records/date-operands";
import { FormulaEditor } from "@/components/formula/formula-editor";
import type { FormulaPreviewAdapter } from "@/components/formula/formula-preview";
import { RecipeStrip } from "@/components/formula/recipe-strip";
import { previewAggregateFormula } from "@/app/(app)/dashboards/formula-preview-actions";
import {
  DEFAULT_CUSTOM_COLUMNS,
  type KanbanSettings,
} from "@/lib/kanban/types";
import type { AgendaSettings } from "@/lib/agenda/types";
import { listTaskBoards } from "@/app/(app)/dashboards/kanban-actions";
import { validateFormula, type Formula } from "@/lib/records/formulas";
import { fieldAppliesToSource, toSourceKey, type SourceKey } from "@/lib/sources";
import { useSources } from "@/components/sources-context";
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
  IMAGE_CLICK_LABELS,
  IMAGE_FIT_LABELS,
  SHAPE_KIND_LABELS,
  TRANSFORM_LABELS,
  VISUAL_TYPE_LABELS,
  type Aggregation,
  type CalculatorVariable,
  type DateAgg,
  type Dimension,
  type FieldFilterEntry,
  type FieldFilterSettings,
  type FilterOp,
  type FilterSettings,
  type GridPosition,
  type ImageClickAction,
  type ImageFit,
  type Metric,
  type CardConfig,
  type ComparisonSettings,
  type QuickFilterEntry,
  type GroupDateFormat,
  type RecordListColumn,
  type RowSource,
  type ShapeKind,
  type Transform,
  type VisualType,
  type Widget,
  type WidgetFilter,
  type WidgetLinkTarget,
} from "@/lib/widgets/types";
import { sanitizeHttpsUrl } from "@/lib/widgets/image-url";
import { newVarId } from "@/lib/widgets/calculator";
import { WidgetLinkPicker } from "@/components/dashboards/widget-link-picker";
import {
  cleanFilters as cleanFilterRows,
  decorateRefOptions,
  FILTER_OPS,
  fieldOptionLabel,
  fieldOptionTitle,
  sourceChips,
  toFieldOptions,
} from "@/lib/widgets/filter-ops";
import { useSourceLabels } from "@/components/source-labels-context";
import { filterTargetSources } from "@/lib/widgets/filter-sources";
import {
  cleanMetricSources,
  metricTargetSources,
} from "@/lib/widgets/metric-sources";
import {
  CALC_METRIC_FIELD,
  validateCondAggRefs,
} from "@/lib/widgets/calc-metrics";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import { perRecordCalcOperands } from "@/lib/records/calc-operands";
import {
  BuilderSection,
  DimensionRow,
  FilterRow,
  MetricRow,
} from "@/components/dashboards/widget-builder-rows";
import { ComparisonSection } from "@/components/dashboards/widget-builder-comparison";
import { CardModeSection } from "@/components/dashboards/card-mode-section";
import { groupByLevels } from "@/lib/widgets/appearance";
import { DATE_FORMAT_LABELS, DATE_FORMATS } from "@/lib/widgets/format";
import { isLabelTransform } from "@/lib/widgets/date-buckets";
import {
  createWidget,
  updateWidget,
  type WidgetInput,
} from "@/app/(app)/dashboards/actions";
import { findFreePosition, posOf } from "@/lib/widgets/grid-placement";
import { DEFAULT_WIDGET_SIZE } from "@/lib/widgets/widget-defaults";
import { defaultQuickTable } from "@/lib/widgets/quick-table/model";

const FILTER_OP_OPTIONS: ComboboxOption[] = FILTER_OPS.map((o) => ({
  value: o.op,
  label: o.label,
}));

// Id estável de um filtro rápido (chave do valor persistido em
// dashboard_table_cells). Fora do componente: só roda em handlers.
function newQuickId(): string {
  return `qf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
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
  layoutById,
  canvasCols,
  onRequestDraw,
  onRequestPlacement,
  open: controlledOpen,
  onOpenChange,
  onPendingChange,
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
  // Layout otimista do shell (posições correntes) e largura do canvas — usados
  // só na CRIAÇÃO, para posicionar o widget novo no primeiro espaço livre da
  // aba destino. Opcionais: os pontos que montam o builder para edição não
  // precisam passar.
  layoutById?: Record<string, GridPosition>;
  canvasCols?: number;
  // Tabela Livre: em vez de salvar direto, fecha o painel e arma o modo
  // "desenhar no canvas" (o retângulo dimensiona widget e linhas/colunas). O
  // título digitado viaja no callback. Só oferecido na CRIAÇÃO.
  onRequestDraw?: (title: string | null) => void;
  // Modo Posicionar (só CRIAÇÃO): em vez de salvar direto, fecha o painel e
  // entrega o input pronto (com posição fallback) ao shell, que pré-cria o
  // widget em segundo plano e arma o clique de posicionamento no canvas. O
  // botão "Salvar widget" vira "Posicionar" quando este callback existe.
  onRequestPlacement?: (input: WidgetInput) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Espelha o pending do save para quem monta o builder (o WidgetCard usa para
  // exibir o overlay de processamento no card enquanto o painel está fechado).
  onPendingChange?: (pending: boolean) => void;
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

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

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

  const [title, setTitle] = useState(widget?.title ?? "");
  const [visualType, setVisualType] = useState<VisualType>(
    widget?.visual_type ?? "barra"
  );

  // Widget KANBAN: config própria (lib/kanban/types.ts) em settings.kanban.
  const [kanbanCfg, setKanbanCfg] = useState<KanbanSettings>(
    widget?.settings?.kanban ?? {
      mode: "registros",
      groupField: "stage",
      card: { titleField: "title" },
    }
  );
  const patchKanban = (p: Partial<KanbanSettings>) =>
    setKanbanCfg((k) => ({ ...k, ...p }));

  // Widget AGENDA: config própria (lib/agenda/types.ts) em settings.agenda.
  const [agendaCfg, setAgendaCfg] = useState<AgendaSettings>(
    widget?.settings?.agenda ?? { showTasks: true, defaultView: "month" }
  );
  const patchAgenda = (p: Partial<AgendaSettings>) =>
    setAgendaCfg((a) => ({ ...a, ...p }));
  // Kanbans dedicados de tarefas (destino do widget kanban modo tarefas) —
  // carregados sob demanda ao entrar no tipo/modo.
  const [taskBoards, setTaskBoards] = useState<
    { id: string; name: string }[] | null
  >(null);
  useEffect(() => {
    if (visualType !== "kanban" || kanbanCfg.mode !== "tarefas") return;
    if (taskBoards !== null) return;
    void listTaskBoards().then(setTaskBoards);
  }, [visualType, kanbanCfg.mode, taskBoards]);
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
  // SUB-FONTES (0078): subs a tratar como perna INDEPENDENTE ("conviver") em vez
  // de absorvidas pela pai. Só relevante quando a sub E a pai estão selecionadas.
  const [coexistSubSources, setCoexistSubSources] = useState<SourceKey[]>(
    widget?.settings?.coexistSubSources ?? []
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
  // Transposta: dimensão que vira as colunas do topo ("" = automático, a 1ª).
  const [tableColDim, setTableColDim] = useState<string>(
    widget?.settings?.appearance?.table?.colDim ?? ""
  );
  // "Formato do grupo" por nível do "Agrupar por" (só modo lista, colunas de
  // data). Ausência da chave = "Herdar da dimensão" (comportamento original).
  const [tableGroupFormats, setTableGroupFormats] = useState<
    Record<string, string>
  >(widget?.settings?.appearance?.table?.groupDateFormats ?? {});

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
  // Lista de ENTIDADES (responsáveis/operações): sem orientação transposta. Listas
  // de Registros passam a suportar transposta como a tabela agregada.
  const isEntityList = isRecordList && rowSource !== "records";
  // Barra de busca/filtro embutida nas tabelas (ocultável). Default = visível.
  const [showFilterBar, setShowFilterBar] = useState<boolean>(
    widget?.settings?.showFilterBar !== false
  );

  // Filtros rápidos (dropdowns no card): Responsável, Operação e datas nos
  // formatos das dimensões. Config aqui (settings.quickFilters); os VALORES
  // selecionados persistem em dashboard_table_cells ('__qf__'), compartilhados
  // entre usuários. Ids preservados na edição (chave do valor persistido).
  const [quickFilters, setQuickFilters] = useState<QuickFilterEntry[]>(
    widget?.settings?.quickFilters ?? []
  );
  const cleanQuickFilters = (): QuickFilterEntry[] =>
    quickFilters
      .filter((e) => e.field)
      .map((e) => {
        const af = available.find((a) => a.field === e.field);
        const out: QuickFilterEntry = { id: e.id || newQuickId(), field: e.field };
        if (af?.isDate && e.transform && e.transform !== "none") {
          out.transform = e.transform;
          if (e.transform === "week_month") out.weekMode = e.weekMode;
        }
        if (e.label?.trim()) out.label = e.label.trim();
        return out;
      });
  // Tipos que exibem filtros rápidos: tabelas, gráficos, KPI e calculado.
  const supportsQuickFilters =
    visualType === "tabela" ||
    visualType === "barra" ||
    visualType === "barra_horizontal" ||
    visualType === "linha" ||
    visualType === "pizza" ||
    visualType === "funil" ||
    visualType === "kpi" ||
    visualType === "calculado";

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

  // Comparação com período anterior (settings.comparison): só nos widgets
  // AGREGADOS (tabela agregada, gráficos e Card) — o modo lista de registros
  // não tem valor agregado p/ comparar.
  const [comparison, setComparison] = useState<ComparisonSettings>(
    widget?.settings?.comparison ?? {}
  );
  // (o Card de "Data atual" fica de fora — gate `!kpiToday` nos usos, pois o
  // estado kpiToday é declarado mais abaixo.)
  const supportsComparison =
    (visualType === "tabela" && !isRecordList) ||
    visualType === "barra" ||
    visualType === "barra_horizontal" ||
    visualType === "linha" ||
    visualType === "pizza" ||
    visualType === "funil" ||
    visualType === "kpi";

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
  // Hierarquia de fontes das colunas unificadas (só modo registros): ordem de
  // prioridade com fallback (RecordListColumn.unifiedSources).
  const [columnUnifiedSources, setColumnUnifiedSources] = useState<
    Record<string, SourceKey[]>
  >(() => {
    const m: Record<string, SourceKey[]> = {};
    for (const c of widget?.settings?.columns ?? [])
      if (c.unifiedSources?.length) m[c.field] = c.unifiedSources;
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
  // Widget 'calculado' apontando p/ um campo "Calculado (totais)" salvo em
  // /campos ('custom:<key>'); vazio = fórmula própria (formula acima).
  const [calcField, setCalcField] = useState<string>(
    widget?.settings?.calcField ?? ""
  );
  // Fórmula aplicada por uma RECEITA (o editor lê `initial` só na montagem —
  // o nonce o remonta já preenchido).
  const [calcRecipeFormula, setCalcRecipeFormula] = useState<Formula | null>(
    null
  );
  const [calcRecipeNonce, setCalcRecipeNonce] = useState(0);
  // Prévia AGREGADA (opt-in; custa RPCs como um widget): fórmula avaliada por
  // runCalculatedWidget com as fontes/filtros correntes do builder, sem o
  // período da barra (o builder não o conhece — o selo avisa).
  const aggPreview = (
    previewSources: SourceKey[],
    resultPercent: boolean,
    resultCurrency: string | null
  ): FormulaPreviewAdapter => ({
    title: "Prévia do resultado",
    manualStart: true,
    run: (f) =>
      previewAggregateFormula({
        formulaJson: JSON.stringify(f),
        sources: previewSources,
        filters,
        resultPercent,
        resultCurrency,
      }),
  });

  // Calculadora: variáveis nomeadas (fórmulas agregadas computadas no servidor
  // com filtros+período do widget; inseridas na expressão do card como [Nome]).
  const [calcVariables, setCalcVariables] = useState<CalculatorVariable[]>(
    widget?.settings?.calculator?.variables ?? []
  );
  const updateVariable = (i: number, patch: Partial<CalculatorVariable>) =>
    setCalcVariables((prev) => {
      const next = [...prev];
      next[i] = { ...prev[i], ...patch };
      return next;
    });

  // Forma (figura geométrica): tipo, texto interno e atalho para widget.
  const [shapeKind, setShapeKind] = useState<ShapeKind>(
    widget?.settings?.shape?.kind ?? "retangulo_arredondado"
  );
  const [shapeText, setShapeText] = useState<string>(
    widget?.settings?.shape?.text ?? ""
  );
  const [shapeLink, setShapeLink] = useState<WidgetLinkTarget | undefined>(
    widget?.settings?.shape?.link
  );

  // Imagem: URL https, ajuste (object-fit), alt e ação de clique (nada/
  // lightbox/link personalizado — nunca a URL da própria imagem).
  const [imageUrl, setImageUrl] = useState<string>(
    widget?.settings?.image?.url ?? ""
  );
  const [imageFit, setImageFit] = useState<ImageFit>(
    widget?.settings?.image?.fit ?? "contain"
  );
  const [imageAlt, setImageAlt] = useState<string>(
    widget?.settings?.image?.alt ?? ""
  );
  const [imageClick, setImageClick] = useState<ImageClickAction>(
    widget?.settings?.image?.click?.action ?? "none"
  );
  const [imageHref, setImageHref] = useState<string>(
    widget?.settings?.image?.click?.href ?? ""
  );

  // KPI "Data atual": card que mostra o dia de hoje (Brasília). Não usa
  // métrica/RPC — o valor é resolvido no engine (runKpi) via settings.mode.
  // Modos novos do Card (settings.card): registro (argmax/argmin), ranking,
  // lista e fórmula. `mode` ausente = número agregado (comportamento original).
  const [cardCfg, setCardCfg] = useState<CardConfig>(
    widget?.settings?.card ?? {}
  );
  const [kpiToday, setKpiToday] = useState<boolean>(
    widget?.settings?.mode === "data_atual"
  );
  const [kpiTodayLabel, setKpiTodayLabel] = useState<string>(
    widget?.settings?.label ?? "Data atual"
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

  // Config do widget de filtro de período (visual_type 'filtro'). Exclui campos
  // sintéticos (displayOnly, ex.: "Data atual"): não existem no banco, então não
  // podem ser campo de filtro de período (que vai para o RPC). Exclui também
  // `match:` (subconsulta do registro casado — o RPC não a aceita como coluna
  // do `@period`); `unified:` fica, resolvido por fonte no servidor.
  const dateFields = available.filter(
    (f) => f.isDate && !f.displayOnly && !f.field.startsWith("match:")
  );
  const [filterField, setFilterField] = useState(
    widget?.settings?.field ?? DEFAULT_PERIOD_FIELD
  );
  const [filterTargets, setFilterTargets] = useState<string[]>(
    widget?.settings?.targets ?? []
  );
  const [filterPreset, setFilterPreset] = useState(
    widget?.settings?.defaultPreset ?? ""
  );
  // Widgets que este filtro pode controlar (exclui a si mesmo, os controles e
  // forma/imagem, que não têm dados/período).
  const targetable = siblings.filter(
    (s) =>
      s.id !== widget?.id &&
      s.visual_type !== "filtro" &&
      s.visual_type !== "filtro_campo" &&
      s.visual_type !== "forma" &&
      s.visual_type !== "imagem"
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
      s.visual_type !== "filtro_campo" &&
      s.visual_type !== "forma" &&
      s.visual_type !== "imagem"
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

  // Catálogo de fontes (data_sources) + rótulos de exibição (Configurações →
  // Fontes) + chips de navegação dos dropdowns de campo (Todas · fontes · Geral).
  const catalog = useSources();
  const catalogLabel = (k: string) =>
    catalog.find((s) => s.key === k)?.label ?? k;
  const sourceLabels = useSourceLabels();
  const fieldSourceChips = sourceChips(sourceLabels);

  // Catálogo por-registro do FieldForm inline ("Novo campo"/"Configurar campo"):
  // o MESMO catálogo do /campos (perRecordCalcOperands — números + datas +
  // casados + condicionais no texto), decorado localmente. Antes era
  // numérico-only e degradava fórmulas com datas/casados p/ refs cruas
  // irrecriáveis (ex.: [custom:data_assinatura] - [match:leads:source_created_at]).
  const perRecordOps = useMemo(
    () => perRecordCalcOperands(fields, catalog, editingField?.field_key),
    [fields, catalog, editingField]
  );
  const fieldFormNumericRefs = useMemo(
    () => decorateRefOptions(perRecordOps.numericRefs, available, sourceLabels),
    [perRecordOps, available, sourceLabels]
  );
  const fieldFormAllRefs = useMemo(
    () => decorateRefOptions(perRecordOps.allRefs, available, sourceLabels),
    [perRecordOps, available, sourceLabels]
  );

  // Métrica monetária (value/mrr ou campo moeda/calc-moeda): habilita as opções
  // de moeda/conversão da métrica.
  const isMoneyField = (field: string): boolean =>
    available.find((a) => a.field === field)?.isMoney ?? false;
  // Forma funcional: efeitos dos editores de fórmula também gravam métricas —
  // um snapshot do closure aqui poderia sobrescrever teclas recém-digitadas.
  const updateMetric = (i: number, patch: Partial<Metric>) =>
    setMetrics((prev) => {
      const next = [...prev];
      next[i] = { ...prev[i], ...patch };
      return next;
    });

  // Refs disponíveis para as métricas/widget calculados: catálogo agregado via
  // builder ÚNICO (lib/widgets/agg-catalog.ts) — mesma montagem do servidor e
  // dos demais editores por construção; inclui aninhados ('calculado_agg'
  // salvos) e condições sobre unificados. Decoração só de exibição
  // (fonte/chips/tooltip) — labels seguem limpos (load-bearing).
  // Memoizado: os editores de fórmula derivam a validação da identidade de
  // `refs`; um array novo por render disparava reemissão de onChange em cadeia.
  const calcRefs: RefOption[] = useMemo(
    () =>
      decorateRefOptions(
        buildAggOperandCatalog(
          availableAggCatalogInput(available, fields, catalog, {
            withNested: true,
          })
        ),
        available,
        sourceLabels
      ),
    [available, fields, sourceLabels, catalog]
  );
  // Campos "Calculado (totais)" salvos em /campos: entram SÓ como métrica.
  const aggCalcFields = available.filter((f) => f.aggCalc);
  const isAggCalcField = (field: string): boolean =>
    field === CALC_METRIC_FIELD ||
    (available.find((a) => a.field === field)?.aggCalc ?? false);

  // Os campos calculados de agregados nunca são dimensão/filtro/busca/coluna de
  // registro (não têm valor por registro) — ficam fora dos dois catálogos.
  const availableOptions = toFieldOptions(
    available.filter((f) => !f.aggCalc),
    sourceLabels
  );
  // Campos válidos para o RPC (dimensão agregada, filtro, busca): exclui os
  // sintéticos (displayOnly, ex.: "Data atual") que não existem como coluna no
  // banco. No modo lista as dimensões SÃO colunas do cliente, então lá o campo
  // sintético é permitido (usa availableOptions).
  const rpcFieldOptions = toFieldOptions(
    available.filter((f) => !f.displayOnly && !f.aggCalc),
    sourceLabels
  );
  // Opções de fontes-alvo por linha de filtro: fontes cobertas pelo widget ∪
  // alvos já gravados no filtro. Alvo "órfão" (fonte que saiu do widget) vem
  // marcado como stale — visível e removível, nunca escondido em silêncio; em
  // runtime ele é neutralizado pela interseção (applyFilterSourceTargets).
  const coveredSources =
    sources.length > 0 ? sources : catalog.map((s) => s.key);
  // Fontes candidatas da hierarquia de uma coluna unificada: fontes-membro do
  // campo ∩ fontes cobertas pelo widget. O seletor "Fonte do dado" só aparece
  // com 2+ candidatas — com uma só, fica implícito o membro da própria fonte.
  const unifiedSourceOptionsFor = (field: string): ComboboxOption[] => {
    const members = available.find((a) => a.field === field)?.unifiedMembers;
    if (!members) return [];
    const eff = new Set<string>(coveredSources);
    return Object.keys(members)
      .map((rt) => toSourceKey(rt))
      .filter((s): s is SourceKey => !!s && eff.has(s))
      .map((s) => ({ value: s, label: catalogLabel(s) }));
  };
  const filterSourceOptions = (f: WidgetFilter) => {
    const keys = new Set<SourceKey>([...coveredSources, ...filterTargetSources(f)]);
    return [...keys].map((k) => ({
      key: k,
      label: catalogLabel(k),
      stale: !coveredSources.includes(k),
    }));
  };
  // Opções de fontes POR MÉTRICA (Metric.sources): o catálogo INTEIRO ∪ alvos
  // já gravados — diferente do filtro (restrito às cobertas), pois aqui a
  // métrica pode AMPLIAR o universo (ex.: linhas só de Deals + conversão
  // contando Leads e Deals). Stale = fonte excluída do catálogo (visível e
  // removível; alvo órfão é inofensivo em runtime — nenhum record_type casa).
  const metricSourceOptions = (m: Metric) => {
    const catalogKeys = catalog.map((s) => s.key);
    const keys = new Set<SourceKey>([...catalogKeys, ...metricTargetSources(m)]);
    return [...keys].map((k) => ({
      key: k,
      label: catalogLabel(k),
      stale: !catalogKeys.includes(k),
    }));
  };
  const metricOptions: ComboboxOption[] = [
    // Sentinelas sem fonte (sempre visíveis em qualquer chip): contagem e
    // fórmula ad-hoc. Os campos "Calculado (totais)" entram com prefixo de
    // fonte + ƒ + tooltip da fórmula, como os demais.
    { value: "*", label: "Contagem de registros" },
    ...toFieldOptions(numericFields, sourceLabels),
    ...toFieldOptions(aggCalcFields, sourceLabels),
    { value: CALC_METRIC_FIELD, label: "ƒ Métrica calculada (fórmula própria)…" },
  ];
  // Modos do Card (settings.card): campos ranqueáveis (números e datas) e
  // métricas simples do ranking (sem ƒ ad-hoc — fórmula tem modo próprio).
  const cardRankOptions = toFieldOptions(
    available.filter((f) => (f.isNumeric || f.isDate) && !f.aggCalc),
    sourceLabels
  );
  const cardMetricOptions: ComboboxOption[] = [
    { value: "*", label: "Contagem de registros" },
    ...toFieldOptions(numericFields, sourceLabels),
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
  const dateFieldOptions: ComboboxOption[] = toFieldOptions(
    dateFields,
    sourceLabels
  );

  function isDate(field: string): boolean {
    return available.find((a) => a.field === field)?.isDate ?? false;
  }

  // Campos elegíveis p/ filtros rápidos (por enquanto): Responsável, Operação e
  // datas — inclusive unificadas (↔) e do registro casado (↪ match:).
  const quickFieldOptions: ComboboxOption[] = toFieldOptions(
    available.filter(
      (f) =>
        f.field === "responsible_id" ||
        f.field === "operation_id" ||
        (f.isDate && !f.displayOnly)
    ),
    sourceLabels
  );
  // Formato do dropdown de data: padrão = período (presets/personalizado);
  // demais = multi-seleção de buckets (os mesmos formatos das dimensões).
  const quickFormatOptions: ComboboxOption[] = [
    { value: "none", label: "Padrão (período)" },
    ...DATE_TRANSFORMS.filter((t) => t !== "none").map((t) => ({
      value: t,
      label: TRANSFORM_LABELS[t],
    })),
  ];

  const updateQuickFilter = (i: number, patch: Partial<QuickFilterEntry>) =>
    setQuickFilters((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });

  // Bloco de config dos filtros rápidos (reusado na seção "Filtros" e no
  // widget calculado, que não usa o Accordion).
  const quickFiltersBlock = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Filtros rápidos</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            setQuickFilters((prev) => [...prev, { id: newQuickId(), field: "" }])
          }
        >
          <Plus className="size-4" /> Adicionar
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Dropdowns exibidos no próprio widget. A seleção é compartilhada entre
        todos os usuários (persiste ao recarregar). Datas no formato padrão
        abrem um dropdown de período; nos demais formatos, multi-seleção
        (ex.: vários meses). O filtro de período com o MESMO campo do período
        geral acompanha a barra (sem alterá-la de volta).
      </p>
      {quickFilters.map((e, i) => {
        const eIsDate = isDate(e.field);
        return (
          <div key={e.id || i} className="bg-card flex flex-col gap-1.5 rounded-md border p-2">
            <div className="flex items-center gap-1.5">
              <Combobox
                className="min-w-0 flex-1"
                options={quickFieldOptions}
                chips={fieldSourceChips}
                value={e.field}
                placeholder="— campo —"
                onValueChange={(field) =>
                  updateQuickFilter(i, {
                    field,
                    // Campo não-data não tem formato; data nasce no padrão.
                    transform: undefined,
                    weekMode: undefined,
                  })
                }
                aria-label="Campo do filtro rápido"
              />
              {eIsDate ? (
                <Combobox
                  className="w-44 shrink-0"
                  searchable={false}
                  options={quickFormatOptions}
                  value={e.transform ?? "none"}
                  onValueChange={(t) =>
                    updateQuickFilter(i, {
                      transform: t === "none" ? undefined : (t as Transform),
                      weekMode: t === "week_month" ? (e.weekMode ?? "restricted") : undefined,
                    })
                  }
                  aria-label="Formato do filtro rápido"
                />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  setQuickFilters((prev) => prev.filter((_, j) => j !== i))
                }
                aria-label="Remover filtro rápido"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {eIsDate && e.transform === "week_month" ? (
              <Combobox
                className="w-44"
                searchable={false}
                options={[
                  { value: "restricted", label: "Semana restrita" },
                  { value: "full", label: "Semana cheia" },
                ]}
                value={e.weekMode ?? "restricted"}
                onValueChange={(wm) =>
                  updateQuickFilter(i, { weekMode: wm as "full" | "restricted" })
                }
                aria-label="Modo da semana do mês"
              />
            ) : null}
            <Input
              className="h-8 text-sm"
              value={e.label ?? ""}
              onChange={(ev) => updateQuickFilter(i, { label: ev.target.value })}
              placeholder={`Rótulo (opcional) — ${
                e.field ? fieldLabel(e.field, available) : "campo"
              }`}
              aria-label="Rótulo do filtro rápido"
            />
          </div>
        );
      })}
    </div>
  );

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
  const allGroupByOptions: ComboboxOption[] = [
    ...(!isRecordList && splitBySource
      ? [{ value: "dim_1", label: "Fonte" }]
      : []),
    ...dimensions
      .filter((d) => d.field)
      .map((d, i) => {
        const af = available.find((a) => a.field === d.field);
        return {
          value: isRecordList ? d.field : `dim_${groupByOffset + i + 1}`,
          label: af ? fieldOptionLabel(af, sourceLabels) : d.field,
          title: af ? fieldOptionTitle(af) : undefined,
        };
      }),
  ];
  // Na transposta UMA dimensão é o eixo de colunas (fica no topo) e não pode
  // virar grupo do eixo esquerdo (grupo == coluna seria degenerado). Qual delas
  // é configurável (`colDim`, "Colunas do topo"); ausente/órfã = a 1ª, o
  // comportamento original.
  const transposed = !isEntityList && tableOrientation === "columns";
  const effColDim =
    tableColDim && allGroupByOptions.some((o) => o.value === tableColDim)
      ? tableColDim
      : (allGroupByOptions[0]?.value ?? "");
  const groupByOptions: ComboboxOption[] = transposed
    ? allGroupByOptions.filter((o) => o.value !== effColDim)
    : allGroupByOptions;
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
  // Trocar/remover um nível descarta o "Formato do grupo" do field antigo (o
  // save também poda contra os níveis vigentes — limpeza dupla).
  const dropGroupFormat = (field: string) =>
    setTableGroupFormats((prev) => {
      if (!field || !(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  const setGroupLevel = (idx: number, value: string) => {
    const old = tableGroupBy[idx];
    if (old && old !== value) dropGroupFormat(old);
    setTableGroupBy((prev) => prev.map((v, i) => (i === idx ? value : v)));
  };
  const removeGroupLevel = (idx: number) => {
    dropGroupFormat(tableGroupBy[idx] ?? "");
    setTableGroupBy((prev) => prev.filter((_, i) => i !== idx));
  };
  const setGroupFormat = (field: string, v: string) => {
    if (v === "inherit") dropGroupFormat(field);
    else setTableGroupFormats((prev) => ({ ...prev, [field]: v }));
  };
  // Opções do "Formato do grupo": herdar (padrão) + máscaras + transforms.
  const groupFormatOptions: ComboboxOption[] = [
    { value: "inherit", label: "Herdar da dimensão (padrão)" },
    ...DATE_FORMATS.map((f) => ({ value: f, label: DATE_FORMAT_LABELS[f] })),
    ...DATE_TRANSFORMS.filter((tr) => tr !== "none").map((tr) => ({
      value: tr,
      label: TRANSFORM_LABELS[tr],
    })),
  ];
  // Dimensão por trás de uma key dim_<n> do "Agrupar por" agregado (mesmo
  // índice de allGroupByOptions: dimensões com field, deslocadas por
  // groupByOffset; dim_1 = Fonte no split → undefined).
  const dimOfGroupKey = (key: string): Dimension | undefined => {
    const m = key.match(/^dim_(\d+)$/);
    return m
      ? dimensions.filter((d) => d.field)[Number(m[1]) - 1 - groupByOffset]
      : undefined;
  };
  // Nível elegível ao "Formato do grupo": lista → coluna de data; agregada →
  // dimensão de data SEM transform "por nome" (o engine substitui o valor da
  // linha pelo rótulo e o ISO cru não sobrevive na WidgetRow p/ re-bucketizar).
  const groupFormatEligible = (level: string): boolean => {
    if (!level) return false;
    if (isRecordList) return isDate(level);
    const d = dimOfGroupKey(level);
    return !!d && isDate(d.field) && !isLabelTransform(d.transform);
  };

  // Posição inicial de um widget NOVO: primeiro espaço livre w×h na aba destino
  // (cada aba é uma tela — só os widgets da mesma aba ocupam espaço). Aba
  // destino = seletor do builder (tabId) ou a primeira. Posições correntes vêm
  // do layout otimista do shell (fallback: grid_position persistido). Sem isso,
  // createWidget usava um y fixo lá no fundo da página.
  function newWidgetPosition(w = 6, h = 8): GridPosition {
    const firstTab = tabs[0]?.id ?? "";
    const targetTab = tabId || firstTab;
    const knownTabs = new Set(tabs.map((t) => t.id));
    const occupied: GridPosition[] = [];
    siblings.forEach((s, i) => {
      if (tabs.length > 0) {
        const t = s.settings?.tab;
        const eff = t && knownTabs.has(t) ? t : firstTab;
        if (eff !== targetTab) return;
      }
      occupied.push(layoutById?.[s.id] ?? posOf(s, i));
    });
    return findFreePosition(occupied, canvasCols ?? 12, w, h);
  }

  // Desfecho comum de todos os branches do save(). Na CRIAÇÃO com o modo
  // Posicionar disponível: fecha o painel e entrega o input (com a posição
  // fallback já calculada) ao shell — que pré-cria o widget em segundo plano e
  // deixa o usuário clicar no canvas para posicioná-lo. Edição (ou instância
  // sem onRequestPlacement) segue salvando direto.
  function commit(input: Omit<WidgetInput, "grid_position">) {
    const { w, h } = DEFAULT_WIDGET_SIZE[visualType];
    if (!widget && onRequestPlacement) {
      setOpen(false);
      onRequestPlacement({ ...input, grid_position: newWidgetPosition(w, h) });
      return;
    }
    // EDIÇÃO: fecha o painel imediatamente — o card mostra o overlay de
    // processamento (via onPendingChange) até a revalidação entregar os dados
    // novos. Em erro, reabre com o formulário intacto (o estado do builder
    // sobrevive ao fechamento: só o SheetContent desmonta).
    if (widget) setOpen(false);
    startTransition(async () => {
      try {
        const res = widget
          ? await updateWidget(widget.id, dashboardId, input)
          : await createWidget(dashboardId, {
              ...input,
              grid_position: newWidgetPosition(w, h),
            });
        if (res.ok) {
          if (!widget) setOpen(false);
        } else {
          setError(res.message ?? "Falha ao salvar.");
          if (widget) setOpen(true);
        }
      } catch {
        setError("Falha ao salvar.");
        if (widget) setOpen(true);
      }
    });
  }

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
      commit(input);
      return;
    }

    // Kanban: config própria em settings.kanban (sem dimensões/métricas do
    // engine). `sources` guarda a fonte p/ a resolução de período da page.
    if (visualType === "kanban") {
      const k = kanbanCfg;
      const isCustomCols = k.mode === "registros" && k.columnSource === "custom";
      if (k.mode === "registros") {
        if (!k.source) {
          setError("Escolha a fonte dos registros do kanban.");
          return;
        }
        // "Personalizar": as colunas são do usuário — não exigem campo.
        if (!isCustomCols && (k.dateBucket ? !k.dateField : !k.groupField)) {
          setError("Escolha o campo que define as colunas do kanban.");
          return;
        }
      }
      const clean: KanbanSettings =
        k.mode === "tarefas"
          ? {
              mode: "tarefas",
              ...(k.taskBoardId ? { taskBoardId: k.taskBoardId } : {}),
              ...(k.columns ? { columns: k.columns } : {}),
              ...(k.tasks ? { tasks: k.tasks } : {}),
              ...(k.appearance ? { appearance: k.appearance } : {}),
            }
          : {
              mode: "registros",
              source: k.source,
              ...(isCustomCols
                ? {
                    columnSource: "custom" as const,
                    columns: k.columns?.length
                      ? k.columns
                      : DEFAULT_CUSTOM_COLUMNS,
                  }
                : k.dateBucket
                  ? { dateField: k.dateField, dateBucket: k.dateBucket }
                  : { groupField: k.groupField }),
              ...(k.metric ? { metric: k.metric } : {}),
              card: {
                titleField: k.card?.titleField || "title",
                ...(k.card?.extraFields && k.card.extraFields.filter(Boolean).length > 0
                  ? { extraFields: k.card.extraFields.filter(Boolean).slice(0, 4) }
                  : {}),
                ...(k.card?.colorField ? { colorField: k.card.colorField } : {}),
              },
              ...(!isCustomCols && k.columns ? { columns: k.columns } : {}),
              ...(k.appearance ? { appearance: k.appearance } : {}),
            };
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: clean.source ? [clean.source as SourceKey] : [],
        dimensions: [],
        metrics: [],
        filters: [],
        // Preserva chaves fora do escopo do builder (ex.: appearance do card).
        settings: { ...widget?.settings, kanban: clean, ...tabPatch },
      };
      commit(input);
      return;
    }

    // Agenda: config própria em settings.agenda. Registros exigem fonte +
    // campo de data; sem fonte, o calendário mostra só tarefas.
    if (visualType === "agenda") {
      const a = agendaCfg;
      if (a.source && !a.dateField) {
        setError("Escolha o campo de data que aloca o registro no dia.");
        return;
      }
      const clean: AgendaSettings = {
        ...(a.source ? { source: a.source, dateField: a.dateField } : {}),
        showTasks: a.showTasks !== false,
        defaultView: a.defaultView === "week" ? "week" : "month",
      };
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: clean.source ? [clean.source as SourceKey] : [],
        dimensions: [],
        metrics: [],
        filters: [],
        settings: { agenda: clean, ...tabPatch },
      };
      commit(input);
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
      commit(input);
      return;
    }

    // Calculadora: variáveis nomeadas (fórmulas agregadas) em
    // settings.calculator. Nome obrigatório e único (case-insensitive) — a
    // expressão do card resolve [Nome] pelo rótulo; duplicado fica ambíguo.
    if (visualType === "calculadora") {
      const clean = calcVariables.filter(
        (v) => v.name.trim() || (v.formula?.tokens.length ?? 0) > 0
      );
      const seen = new Set<string>();
      for (const v of clean) {
        const name = v.name.trim();
        if (!name) {
          setError("Toda variável da calculadora precisa de um nome.");
          return;
        }
        const key = name.toLocaleLowerCase("pt-BR");
        if (seen.has(key)) {
          setError(`Variável duplicada: "${name}". Use nomes únicos.`);
          return;
        }
        seen.add(key);
        if (v.formula && v.formula.tokens.length > 0) {
          const val = validateFormula(
            v.formula,
            new Set(calcRefs.map((r) => r.ref))
          );
          if (!val.ok) {
            setError(`Variável "${name}": ${val.error ?? "fórmula inválida."}`);
            return;
          }
          const p = validateCondAggRefs(v.formula, calcRefs);
          if (!p.ok) {
            setError(`Variável "${name}": ${p.error ?? "fórmula inválida."}`);
            return;
          }
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
        settings: {
          ...(widget?.settings ?? {}),
          calculator: {
            variables: clean.map((v) => ({
              id: v.id || newVarId(),
              name: v.name.trim(),
              formula: v.formula,
            })),
          },
          ...tabPatch,
        },
      };
      commit(input);
      return;
    }

    // Nota (post-it): o texto é editado direto no card (settings.note fica
    // intocado aqui — preservado pelo spread); o builder só define título/aba.
    if (visualType === "nota") {
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: [],
        splitBySource: false,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: { ...(widget?.settings ?? {}), ...tabPatch },
      };
      commit(input);
      return;
    }

    // Tabela Livre: a estrutura (colunas/linhas/bloqueios) é editada direto no
    // card (painéis de coluna/linha e botões "+"); o builder só define
    // título/aba. Na criação nasce uma grade padrão 3×3 (ou a desenhada — M2).
    if (visualType === "tabela_editavel") {
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: [],
        splitBySource: false,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: {
          ...(widget?.settings ?? {}),
          quickTable: widget?.settings?.quickTable ?? defaultQuickTable(3, 3),
          ...tabPatch,
        },
      };
      commit(input);
      return;
    }

    // Forma (figura geométrica): tipo, texto e atalho em settings.shape.
    if (visualType === "forma") {
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: [],
        splitBySource: false,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: {
          ...(widget?.settings ?? {}),
          shape: {
            kind: shapeKind,
            text: shapeText.trim() || undefined,
            link: shapeLink,
          },
          ...tabPatch,
        },
      };
      commit(input);
      return;
    }

    // Imagem: valida as URLs aqui (feedback imediato) — as actions re-saneiam
    // na escrita e o image-widget re-valida no render (viewer público).
    if (visualType === "imagem") {
      const url = sanitizeHttpsUrl(imageUrl);
      if (imageUrl.trim() && !url) {
        setError("URL da imagem inválida — use um link https:// direto.");
        return;
      }
      const href = sanitizeHttpsUrl(imageHref);
      if (imageClick === "link" && !href) {
        setError("Link do clique inválido — use um endereço https://.");
        return;
      }
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: [],
        splitBySource: false,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: {
          ...(widget?.settings ?? {}),
          image: {
            url: url ?? undefined,
            fit: imageFit,
            alt: imageAlt.trim() || undefined,
            click:
              imageClick === "none"
                ? undefined
                : {
                    action: imageClick,
                    href: imageClick === "link" ? (href ?? undefined) : undefined,
                  },
          },
          ...tabPatch,
        },
      };
      commit(input);
      return;
    }

    // Métrica calculada: valida a fórmula (refs vêm do próprio seletor, mas
    // conferimos estrutura/parênteses) e grava em settings.formula — ou aponta
    // p/ um campo "Calculado (totais)" salvo (settings.calcField).
    if (visualType === "calculado") {
      if (!calcField && formula.tokens.length > 0) {
        const allowed = new Set(calcRefs.map((r) => r.ref));
        const v = validateFormula(formula, allowed);
        if (!v.ok) {
          setError(v.error ?? "Fórmula inválida.");
          return;
        }
        const p = validateCondAggRefs(formula, calcRefs);
        if (!p.ok) {
          setError(p.error ?? "Fórmula inválida.");
          return;
        }
      }
      const calcSettings = { ...(widget?.settings ?? {}), formula, ...tabPatch };
      if (calcField) calcSettings.calcField = calcField;
      else delete calcSettings.calcField;
      // Filtros rápidos também valem no widget calculado (afetam a fórmula).
      const calcQuick = cleanQuickFilters();
      if (calcQuick.length > 0) calcSettings.quickFilters = calcQuick;
      else delete calcSettings.quickFilters;
      const input = {
        title: title.trim() || null,
        visual_type: visualType,
        sources: [],
        splitBySource: false,
        dimensions: [],
        metrics: [],
        filters: [],
        settings: calcSettings,
      };
      commit(input);
      return;
    }

    // Métricas calculadas ad-hoc ('calc:formula'): fórmula obrigatória e válida.
    for (const m of metrics) {
      if (m.field !== CALC_METRIC_FIELD) continue;
      if (!m.formula || m.formula.tokens.length === 0) {
        setError("Defina a fórmula da métrica calculada.");
        return;
      }
      const v = validateFormula(m.formula, new Set(calcRefs.map((r) => r.ref)));
      if (!v.ok) {
        setError(v.error ?? "Fórmula inválida na métrica calculada.");
        return;
      }
      const p = validateCondAggRefs(m.formula, calcRefs);
      if (!p.ok) {
        setError(p.error ?? "Fórmula inválida na métrica calculada.");
        return;
      }
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
            // Hierarquia de fontes (só colunas unificadas): poda às fontes
            // candidatas vigentes e deduplica; com ≤1 candidata a escolha é
            // implícita (membro da própria fonte) e nada é gravado.
            if (d.field.startsWith("unified:")) {
              const cand = unifiedSourceOptionsFor(d.field).map((o) => o.value);
              const list = (columnUnifiedSources[d.field] ?? []).filter(
                (s, i, arr) => cand.includes(s) && arr.indexOf(s) === i
              );
              if (cand.length > 1 && list.length > 0)
                col.unifiedSources = list;
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

    // Filtros rápidos: grava a config limpa (ids preservados — são a chave dos
    // valores persistidos). Sem entries (ou tipo sem suporte) limpa a chave.
    const quick = cleanQuickFilters();
    if (supportsQuickFilters && quick.length > 0) settings.quickFilters = quick;
    else delete settings.quickFilters;

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
      // Níveis válidos (sem vazios), hierarquia de cima para baixo. Na
      // transposta, a dimensão das colunas não pode ser nível de grupo.
      const groupLevels = tableGroupBy
        .filter(Boolean)
        .filter((k) => !transposed || k !== effColDim);
      // "Formato do grupo": só níveis vigentes elegíveis (poda automática de
      // órfãos: nível removido/trocado, campo/dimensão que deixou de ser data
      // ou dimensão agregada que ganhou transform "por nome").
      const groupFmts: Record<string, GroupDateFormat> = {};
      for (const k of groupLevels) {
        const v = tableGroupFormats[k];
        if (v && v !== "inherit" && groupFormatEligible(k))
          groupFmts[k] = v as GroupDateFormat;
      }
      if (Object.keys(groupFmts).length > 0)
        table.groupDateFormats = groupFmts;
      else delete table.groupDateFormats;
      if (isEntityList) {
        // Listas de entidades: sem orientação transposta.
        delete table.orientation;
        delete table.colDim;
        if (groupLevels.length > 0) table.groupBy = groupLevels;
        else delete table.groupBy;
      } else {
        // Agregada E lista de Registros: orientação + agrupamento nas duas
        // orientações. Na transposta a dimensão de `colDim` (default: a 1ª)
        // vira as colunas e os níveis abaixo agrupam o eixo esquerdo.
        table.orientation = tableOrientation;
        // colDim só faz sentido na transposta; "" = automático (1ª dimensão).
        if (transposed && tableColDim && tableColDim === effColDim) {
          table.colDim = tableColDim;
        } else {
          delete table.colDim;
        }
        if (groupLevels.length > 0) table.groupBy = groupLevels;
        else delete table.groupBy;
      }
      settings = {
        ...settings,
        appearance: { ...(settings.appearance ?? {}), table },
      };
    }

    // KPI "Data atual": grava o modo sintético (resolvido no engine sem RPC) ou
    // limpa quando desmarcado. Não interfere nos KPIs meta/razão (vindos de preset).
    if (visualType === "kpi") {
      if (kpiToday) {
        settings.mode = "data_atual";
        settings.label = kpiTodayLabel.trim() || "Data atual";
      } else if (settings.mode === "data_atual") {
        delete settings.mode;
        delete settings.label;
      }
    }

    // Modos novos do Card (settings.card): valida o mínimo de cada modo e
    // grava; modo "value" (ou Data atual) limpa a chave.
    if (visualType === "kpi") {
      const cm = cardCfg.mode ?? "value";
      if (!kpiToday && cm !== "value") {
        if (cm === "record" && !cardCfg.rankField && !cardCfg.showField) {
          setError("Card (registro): escolha o campo de classificação.");
          return;
        }
        if ((cm === "topn" || cm === "list") && !cardCfg.labelField) {
          setError("Card (ranking/lista): escolha o campo do rótulo.");
          return;
        }
        if (cm === "topn" && !cardCfg.metric?.field) {
          setError("Card (ranking): escolha a métrica do ranking.");
          return;
        }
        if (cm === "formula") {
          if (!cardCfg.formula || cardCfg.formula.tokens.length === 0) {
            setError("Card (fórmula): escreva a fórmula.");
            return;
          }
          const v = validateFormula(
            cardCfg.formula,
            new Set(calcRefs.map((r) => r.ref))
          );
          if (!v.ok) {
            setError(v.error ?? "Fórmula inválida no Card.");
            return;
          }
          const p = validateCondAggRefs(cardCfg.formula, calcRefs);
          if (!p.ok) {
            setError(p.error ?? "Fórmula inválida no Card.");
            return;
          }
        }
        settings.card = cardCfg;
      } else {
        delete settings.card;
      }
    } else {
      delete settings.card;
    }

    // Comparação com período anterior: grava só quando habilitada num tipo
    // suportado (agregados); senão limpa (jsonb limpo).
    if (supportsComparison && !(visualType === "kpi" && kpiToday) && comparison.enabled) {
      settings.comparison = comparison;
    } else {
      delete settings.comparison;
    }

    // SUB-FONTES (0078): só persiste "conviver" para subs efetivamente
    // selecionadas junto da pai (senão o toggle não teria efeito); limpa o resto.
    const coexistClean = coexistSubSources.filter((k) => {
      const parent = catalog.find((s) => s.key === k)?.parentKey;
      return sources.includes(k) && parent != null && sources.includes(parent);
    });
    if (coexistClean.length > 0) settings.coexistSubSources = coexistClean;
    else delete settings.coexistSubSources;

    const input = {
      title: title.trim() || null,
      visual_type: visualType,
      sources,
      splitBySource,
      dimensions: dimensions.filter((d) => d.field),
      metrics: metrics.filter((m) => m.field).map(cleanMetricSources),
      filters: cleanFilters,
      settings: { ...settings, ...tabPatch },
    };
    commit(input);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent
        className="bg-muted overflow-y-auto sm:max-w-none"
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
                  chips={fieldSourceChips}
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
                  cujas fontes se sobrepõem às escolhidas aqui — e neles só
                  restringe os registros das fontes escolhidas; registros de
                  outras fontes dos widgets-alvo não são afetados.
                </p>
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  {catalog.map((s) => (
                    <label key={s.key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={sources.includes(s.key)}
                        onCheckedChange={() => toggleSource(s.key)}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t pt-4">
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
                      options={rpcFieldOptions}
                      chips={fieldSourceChips}
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

              <div className="flex flex-col gap-2 border-t pt-4">
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
                      options={rpcFieldOptions}
                      chips={fieldSourceChips}
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

              <div className="flex flex-col gap-2 border-t pt-4">
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
              {aggCalcFields.length > 0 ? (
                <>
                  <Label>Usar campo salvo</Label>
                  <Combobox
                    searchable={false}
                    options={[
                      { value: "", label: "Escrever a fórmula neste widget" },
                      ...toFieldOptions(aggCalcFields, sourceLabels),
                    ]}
                    value={calcField}
                    onValueChange={setCalcField}
                    className="w-full"
                    aria-label="Usar campo salvo"
                  />
                  <p className="text-muted-foreground text-xs">
                    Campo salvo (&quot;Calculado — totais do recorte&quot;, de
                    Campos) = reutilizável em vários widgets; a fórmula/moeda
                    vêm do campo. Fórmula escrita aqui vale só neste widget.
                  </p>
                </>
              ) : null}
              {!calcField ? (
                <>
                  <Label>Fórmula</Label>
                  <FormulaEditor
                    key={`calcw-${calcRecipeNonce}`}
                    context="aggregate"
                    catalog={calcRefs}
                    chips={fieldSourceChips}
                    sources={catalog}
                    initial={
                      calcRecipeFormula ?? widget?.settings?.formula ?? null
                    }
                    onChange={(f) => setFormula(f)}
                    preview={aggPreview(sources, false, null)}
                    header={
                      <RecipeStrip
                        recipes={["conversion_rate"]}
                        aggCatalog={calcRefs}
                        sources={catalog}
                        onApply={(r) => {
                          setFormula(r.formula);
                          setCalcRecipeFormula(r.formula);
                          setCalcRecipeNonce((n) => n + 1);
                        }}
                      />
                    }
                  />
                </>
              ) : null}
              {/* Filtros rápidos (o calculado não usa o Accordion de dados). */}
              <div className="border-t pt-3">{quickFiltersBlock}</div>
            </div>
          ) : null}

          {/* Config da Calculadora: variáveis de campos (nome + fórmula). */}
          {visualType === "calculadora" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Variáveis de campos</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCalcVariables((prev) => [
                      ...prev,
                      { id: newVarId(), name: "" },
                    ])
                  }
                >
                  <Plus className="size-4" /> Adicionar variável
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Cada variável é um total dos dados (respeita filtros e período)
                e entra na expressão da calculadora como <code>[Nome]</code> —
                digite <code>[</code> no card para buscar.
              </p>
              {calcVariables.map((v, i) => (
                <div key={v.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={v.name}
                      placeholder="Nome da variável (ex.: Vendas)"
                      onChange={(e) => updateVariable(i, { name: e.target.value })}
                      aria-label="Nome da variável"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover variável"
                      onClick={() =>
                        setCalcVariables((prev) => prev.filter((_, j) => j !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {/* Editor completo (visual+texto) — antes as variáveis eram
                      texto-only; ganharam paleta de funções, validação viva e
                      prévia. */}
                  <FormulaEditor
                    context="aggregate"
                    catalog={calcRefs}
                    chips={fieldSourceChips}
                    sources={catalog}
                    initial={v.formula ?? null}
                    onChange={(f) => updateVariable(i, { formula: f })}
                    preview={aggPreview(sources, false, null)}
                  />
                </div>
              ))}
              {calcVariables.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Sem variáveis a calculadora ainda funciona para contas
                  básicas (+ − × ÷ e parênteses).
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Config da Nota: o texto é editado direto no card. */}
          {visualType === "nota" ? (
            <p className="text-muted-foreground rounded-md border p-3 text-sm">
              O texto da nota é editado direto no card (modo{" "}
              <strong>Editar layout</strong> → clique no post-it). Use{" "}
              <code>{"{= … }"}</code> para cálculos com campos e condicionais, e
              o botão <strong>Link…</strong> para transformar palavras em
              atalhos para outros widgets. Cores em <strong>Aparência</strong>.
            </p>
          ) : null}

          {/* Tabela Livre: estrutura editada direto no card. */}
          {visualType === "tabela_editavel" ? (
            <>
              <p className="text-muted-foreground rounded-md border p-3 text-sm">
                A tabela é montada direto no card: com{" "}
                <strong>Editar layout</strong> ativo, use os botões{" "}
                <strong>+</strong> para adicionar linhas/colunas e o cabeçalho
                de cada coluna para definir rótulo, tipo (livre, dimensão ou
                métrica) e quem pode editar. Digite livremente nas células; use{" "}
                <code>=</code> para fórmulas entre células e{" "}
                <code>{"{= … }"}</code> para valores do sistema.
              </p>
              {!widget && onRequestDraw ? (
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onRequestDraw(title.trim() || null);
                    }}
                  >
                    <SquareDashedMousePointer className="size-4" /> Desenhar no
                    painel
                  </Button>
                  <p className="text-muted-foreground text-xs">
                    Arraste um retângulo no dashboard: o tamanho desenhado
                    define a posição do widget e a quantidade inicial de
                    linhas e colunas. Ou salve abaixo para criar uma grade
                    padrão 3×3.
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {/* Config do KANBAN: modo, fonte, colunas (campo ou bucket de data),
              métrica da coluna e conteúdo do card. Colunas (ordem/cor/WIP)
              são configuradas no próprio card depois de criado. */}
          {visualType === "kanban" ? (
            (() => {
              const k = kanbanCfg;
              const src = k.source ?? "";
              const customsOf = (pred: (f: FieldDefinition) => boolean) =>
                fields
                  .filter(
                    (f) =>
                      pred(f) &&
                      (!src || fieldAppliesToSource(f.applies_to, src))
                  )
                  .map((f) => ({
                    value: `custom:${f.field_key}`,
                    label: f.label,
                  }));
              const groupOptions: ComboboxOption[] = [
                { value: "stage", label: "Etapa" },
                { value: "pipeline", label: "Pipeline" },
                { value: "sale_type", label: "Tipo de venda" },
                { value: "channel", label: "Canal" },
                ...customsOf(
                  (f) => f.data_type === "selecao" || f.data_type === "texto"
                ),
              ];
              const dateOptions: ComboboxOption[] = [
                { value: "closed_at", label: "Data de fechamento" },
                { value: "opened_at", label: "Data de abertura" },
                { value: "source_created_at", label: "Data de criação (origem)" },
                ...customsOf((f) => f.data_type === "data"),
              ];
              const metricOptions: ComboboxOption[] = [
                { value: "", label: "— nenhuma —" },
                { value: "value", label: "Valor" },
                { value: "mrr", label: "MRR" },
                ...customsOf(
                  (f) => f.data_type === "numero" || f.data_type === "moeda"
                ),
              ];
              const cardFieldOptions: ComboboxOption[] = [
                { value: "", label: "—" },
                { value: "stage", label: "Etapa" },
                { value: "value", label: "Valor" },
                { value: "responsible_id", label: "Responsável" },
                { value: "closed_at", label: "Data de fechamento" },
                { value: "source_created_at", label: "Data de criação (origem)" },
                ...customsOf(
                  (f) =>
                    f.data_type !== "calculado_agg" && f.data_type !== "calculado"
                ),
              ];
              const extra = (i: number) => k.card?.extraFields?.[i] ?? "";
              const setExtra = (i: number, v: string) => {
                const arr = [...(k.card?.extraFields ?? [])];
                arr[i] = v;
                patchKanban({
                  card: { ...k.card, extraFields: arr },
                });
              };
              return (
                <div className="flex flex-col gap-3 rounded-md border p-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Tipo de quadro</Label>
                    <Combobox
                      searchable={false}
                      options={[
                        { value: "registros", label: "Registros de uma fonte" },
                        { value: "tarefas", label: "Tarefas (fases de execução)" },
                      ]}
                      value={k.mode}
                      onValueChange={(v) =>
                        patchKanban({
                          mode: v === "tarefas" ? "tarefas" : "registros",
                        })
                      }
                      className="w-full"
                      aria-label="Tipo de quadro"
                    />
                  </div>

                  {k.mode === "tarefas" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label>Quadro de tarefas</Label>
                      <Combobox
                        options={[
                          { value: "", label: "Minhas tarefas (todas visíveis)" },
                          ...(taskBoards ?? []).map((b) => ({
                            value: b.id,
                            label: b.name,
                          })),
                        ]}
                        value={k.taskBoardId ?? ""}
                        onValueChange={(v) =>
                          patchKanban({ taskBoardId: v || undefined })
                        }
                        className="w-full"
                        aria-label="Quadro de tarefas"
                      />
                      <p className="text-muted-foreground text-xs">
                        Aponte para um kanban de tarefas existente (fases dele)
                        ou mostre todas as tarefas visíveis por fase padrão.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <Label>Fonte dos registros</Label>
                        <Combobox
                          options={catalog.map((s) => ({
                            value: s.key,
                            label: s.label,
                          }))}
                          value={src}
                          onValueChange={(v) => patchKanban({ source: v })}
                          className="w-full"
                          aria-label="Fonte dos registros"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Colunas do quadro</Label>
                        <Combobox
                          searchable={false}
                          options={[
                            {
                              value: "field",
                              label: "Valores de um campo (ex.: etapa)",
                            },
                            {
                              value: "date",
                              label: "Períodos de um campo de data",
                            },
                            {
                              value: "custom",
                              label: "Personalizar (colunas livres)",
                            },
                          ]}
                          value={
                            k.columnSource === "custom"
                              ? "custom"
                              : k.dateBucket
                                ? "date"
                                : "field"
                          }
                          onValueChange={(v) =>
                            v === "custom"
                              ? patchKanban({
                                  columnSource: "custom",
                                  dateBucket: undefined,
                                  dateField: undefined,
                                  groupField: undefined,
                                  columns: k.columns?.length
                                    ? k.columns
                                    : DEFAULT_CUSTOM_COLUMNS,
                                })
                              : v === "date"
                                ? patchKanban({
                                    columnSource: undefined,
                                    dateBucket: k.dateBucket ?? "weekday",
                                    dateField: k.dateField ?? "source_created_at",
                                    groupField: undefined,
                                  })
                                : patchKanban({
                                    columnSource: undefined,
                                    dateBucket: undefined,
                                    dateField: undefined,
                                    groupField: k.groupField ?? "stage",
                                  })
                          }
                          className="w-full"
                          aria-label="Tipo de agrupamento"
                        />
                      </div>
                      {k.columnSource === "custom" ? (
                        <p className="text-muted-foreground text-xs">
                          As colunas são suas: adicione/renomeie pela engrenagem
                          do quadro ou pelo “+” ao lado das colunas. Mover um
                          card NÃO altera o registro — a posição vale só para
                          este quadro. Novos registros entram na primeira
                          coluna.
                        </p>
                      ) : k.dateBucket ? (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <Label>Campo de data</Label>
                            <Combobox
                              options={dateOptions}
                              value={k.dateField ?? ""}
                              onValueChange={(v) => patchKanban({ dateField: v })}
                              className="w-full"
                              aria-label="Campo de data"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Período de cada coluna</Label>
                            <Combobox
                              searchable={false}
                              options={[
                                { value: "weekday", label: "Dia da semana" },
                                { value: "month_name", label: "Mês do ano" },
                                { value: "month_year", label: "Mês/Ano" },
                              ]}
                              value={k.dateBucket}
                              onValueChange={(v) =>
                                patchKanban({
                                  dateBucket:
                                    v === "month_name" || v === "month_year"
                                      ? v
                                      : "weekday",
                                })
                              }
                              className="w-full"
                              aria-label="Período de cada coluna"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <Label>Campo que define as colunas</Label>
                          <Combobox
                            options={groupOptions}
                            value={k.groupField ?? "stage"}
                            onValueChange={(v) => patchKanban({ groupField: v })}
                            className="w-full"
                            aria-label="Campo que define as colunas"
                          />
                          <p className="text-muted-foreground text-xs">
                            Mover um card entre colunas altera esse valor no
                            registro.
                          </p>
                        </div>
                      )}
                      <div className="flex flex-col gap-1.5">
                        <Label>Métrica no cabeçalho (soma por coluna)</Label>
                        <Combobox
                          options={metricOptions}
                          value={k.metric ?? ""}
                          onValueChange={(v) =>
                            patchKanban({ metric: v || undefined })
                          }
                          className="w-full"
                          aria-label="Métrica no cabeçalho"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label>Campo extra 1 (card)</Label>
                          <Combobox
                            options={cardFieldOptions}
                            value={extra(0)}
                            onValueChange={(v) => setExtra(0, v)}
                            className="w-full"
                            aria-label="Campo extra 1"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Campo extra 2 (card)</Label>
                          <Combobox
                            options={cardFieldOptions}
                            value={extra(1)}
                            onValueChange={(v) => setExtra(1, v)}
                            className="w-full"
                            aria-label="Campo extra 2"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Cor do card por campo</Label>
                        <Combobox
                          options={cardFieldOptions}
                          value={k.card?.colorField ?? ""}
                          onValueChange={(v) =>
                            patchKanban({
                              card: { ...k.card, colorField: v || undefined },
                            })
                          }
                          className="w-full"
                          aria-label="Cor do card por campo"
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })()
          ) : null}

          {/* Config da AGENDA: fonte + campo de data (registros no dia) e
              tarefas por vencimento. */}
          {visualType === "agenda" ? (
            (() => {
              const a = agendaCfg;
              const dateOptions: ComboboxOption[] = [
                { value: "closed_at", label: "Data de fechamento" },
                { value: "opened_at", label: "Data de abertura" },
                { value: "source_created_at", label: "Data de criação (origem)" },
                ...fields
                  .filter(
                    (f) =>
                      f.data_type === "data" &&
                      (!a.source || fieldAppliesToSource(f.applies_to, a.source))
                  )
                  .map((f) => ({
                    value: `custom:${f.field_key}`,
                    label: f.label,
                  })),
              ];
              return (
                <div className="flex flex-col gap-3 rounded-md border p-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Fonte dos registros</Label>
                    <Combobox
                      options={[
                        { value: "", label: "— nenhuma (só tarefas) —" },
                        ...catalog.map((s) => ({ value: s.key, label: s.label })),
                      ]}
                      value={a.source ?? ""}
                      onValueChange={(v) =>
                        patchAgenda({
                          source: v || undefined,
                          dateField: v
                            ? (a.dateField ?? "source_created_at")
                            : undefined,
                        })
                      }
                      className="w-full"
                      aria-label="Fonte dos registros"
                    />
                  </div>
                  {a.source ? (
                    <div className="flex flex-col gap-1.5">
                      <Label>Campo de data (aloca o registro no dia)</Label>
                      <Combobox
                        options={dateOptions}
                        value={a.dateField ?? ""}
                        onValueChange={(v) => patchAgenda({ dateField: v })}
                        className="w-full"
                        aria-label="Campo de data"
                      />
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={a.showTasks !== false}
                      onCheckedChange={(v) =>
                        patchAgenda({ showTasks: v === true })
                      }
                    />
                    Mostrar tarefas (vencimento)
                  </label>
                  <div className="flex flex-col gap-1.5">
                    <Label>Visão inicial</Label>
                    <Combobox
                      searchable={false}
                      options={[
                        { value: "month", label: "Mês" },
                        { value: "week", label: "Semana" },
                      ]}
                      value={a.defaultView ?? "month"}
                      onValueChange={(v) =>
                        patchAgenda({
                          defaultView: v === "week" ? "week" : "month",
                        })
                      }
                      className="w-full"
                      aria-label="Visão inicial"
                    />
                  </div>
                </div>
              );
            })()
          ) : null}

          {/* Config da Forma: tipo, texto interno e atalho para widget. */}
          {visualType === "forma" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Forma</Label>
                <Combobox
                  searchable={false}
                  options={(
                    Object.keys(SHAPE_KIND_LABELS) as ShapeKind[]
                  ).map((k) => ({ value: k, label: SHAPE_KIND_LABELS[k] }))}
                  value={shapeKind}
                  onValueChange={(v) => setShapeKind(v as ShapeKind)}
                  aria-label="Tipo de forma"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Texto na forma</Label>
                <Input
                  value={shapeText}
                  onChange={(e) => setShapeText(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Atalho para widget</Label>
                <p className="text-muted-foreground text-xs">
                  Clicar na forma (fora do modo edição) vai até o widget-alvo —
                  em qualquer aba deste dashboard ou de outro — centralizando-o
                  na tela.
                </p>
                <WidgetLinkPicker
                  currentDashboardId={dashboardId}
                  value={shapeLink}
                  onChange={setShapeLink}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Cores (preenchimento/contorno/texto) em{" "}
                <strong>Aparência</strong>.
              </p>
            </>
          ) : null}

          {/* Config da Imagem: URL https, ajuste, alt e ação de clique. */}
          {visualType === "imagem" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="image-url">URL da imagem</Label>
                <Input
                  id="image-url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://exemplo.com/logo.png"
                  inputMode="url"
                  spellCheck={false}
                />
                <p className="text-muted-foreground text-xs">
                  Link https:// direto para a imagem (png, jpg, webp, gif,
                  svg…). PNG com fundo transparente aparece sem card por trás.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Ajuste no card</Label>
                <Combobox
                  searchable={false}
                  options={(
                    Object.keys(IMAGE_FIT_LABELS) as ImageFit[]
                  ).map((k) => ({ value: k, label: IMAGE_FIT_LABELS[k] }))}
                  value={imageFit}
                  onValueChange={(v) => setImageFit(v as ImageFit)}
                  aria-label="Ajuste da imagem no card"
                />
                <p className="text-muted-foreground text-xs">
                  O tamanho do card é livre — redimensione pelas bordas no modo
                  edição.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Ao clicar (fora do modo edição)</Label>
                <Combobox
                  searchable={false}
                  options={(
                    Object.keys(IMAGE_CLICK_LABELS) as ImageClickAction[]
                  ).map((k) => ({ value: k, label: IMAGE_CLICK_LABELS[k] }))}
                  value={imageClick}
                  onValueChange={(v) => setImageClick(v as ImageClickAction)}
                  aria-label="Ação ao clicar na imagem"
                />
              </div>
              {imageClick === "link" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="image-href">Link do clique</Label>
                  <Input
                    id="image-href"
                    value={imageHref}
                    onChange={(e) => setImageHref(e.target.value)}
                    placeholder="https://exemplo.com/pagina"
                    inputMode="url"
                    spellCheck={false}
                  />
                  <p className="text-muted-foreground text-xs">
                    Abre em nova aba. Endereço próprio (https://) — não é a URL
                    da imagem.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="image-alt">Texto alternativo</Label>
                <Input
                  id="image-alt"
                  value={imageAlt}
                  onChange={(e) => setImageAlt(e.target.value)}
                  placeholder="Opcional — descrição p/ leitores de tela"
                />
              </div>
            </>
          ) : null}

          {/* KPI "Data atual": mostra o dia de hoje (Brasília), sem métrica. */}
          {visualType === "kpi" ? (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={kpiToday}
                  onCheckedChange={(v) => setKpiToday(v === true)}
                />
                Card de Data atual (mostra o dia de hoje, horário de Brasília)
              </label>
              {kpiToday ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="kpi-today-label">Rótulo</Label>
                    <Input
                      id="kpi-today-label"
                      value={kpiTodayLabel}
                      onChange={(e) => setKpiTodayLabel(e.target.value)}
                      placeholder="Data atual"
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Métricas e filtros são ignorados neste modo.
                  </p>
                </>
              ) : null}
            </div>
          ) : null}

          {/* Modos do Card: registro (maior/menor), ranking, lista e fórmula. */}
          {visualType === "kpi" && !kpiToday ? (
            <CardModeSection
              value={cardCfg}
              onChange={setCardCfg}
              fieldOptions={availableOptions}
              rankOptions={cardRankOptions}
              metricFieldOptions={cardMetricOptions}
              fieldChips={fieldSourceChips}
              calcRefs={calcRefs}
            />
          ) : null}

          {/* Bloco de dados em seções recolhíveis. O badge resume o que está
              configurado, visível mesmo com a seção fechada. Todas abrem
              recolhidas; o usuário expande sob demanda. */}
          {visualType !== "filtro" &&
          visualType !== "filtro_campo" &&
          visualType !== "calculado" &&
          visualType !== "calculadora" &&
          visualType !== "nota" &&
          visualType !== "forma" &&
          visualType !== "imagem" &&
          visualType !== "tabela_editavel" &&
          visualType !== "kanban" &&
          visualType !== "agenda" ? (
          <Accordion type="multiple" className="-mt-2">
          {/* Fontes + modo de combinação */}
          <BuilderSection
            value="fontes"
            title="Fontes de dados"
            badge={
              sources.length === 0 ? "Todas" : `${sources.length} selecionada(s)`
            }
          >
            <p className="text-muted-foreground text-xs">
              Sem seleção = todas as fontes. Colunas correspondidas (↔) somam
              entre as fontes escolhidas.
            </p>
            <div className="flex flex-col gap-2 rounded-md border p-3">
              {catalog.map((s) => {
                // SUB-FONTES: quando a sub E a pai estão selecionadas, oferece o
                // toggle "conviver" (perna independente) × absorver (padrão).
                const parentSelected =
                  s.parentKey != null && sources.includes(s.parentKey);
                const coexisting = coexistSubSources.includes(s.key);
                return (
                  <div key={s.key} className="flex flex-col gap-1">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={sources.includes(s.key)}
                        onCheckedChange={() => toggleSource(s.key)}
                      />
                      {s.parentKey ? (
                        <span className="text-muted-foreground">↳ </span>
                      ) : null}
                      {s.label}
                    </label>
                    {sources.includes(s.key) && parentSelected ? (
                      <label className="ml-6 flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={coexisting}
                          onCheckedChange={(v) =>
                            setCoexistSubSources((prev) =>
                              v === true
                                ? [...new Set([...prev, s.key])]
                                : prev.filter((k) => k !== s.key)
                            )
                          }
                        />
                        Conviver com a pai (série própria; você garante que não se
                        sobrepõem). Padrão: somar na pai, sem duplicar.
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <Checkbox
                checked={splitBySource}
                onCheckedChange={(v) => setSplitBySource(v === true)}
              />
              Quebrar por fonte (uma série por fonte)
            </label>
          </BuilderSection>

          {/* Dimensões (no modo lista, definem também as colunas exibidas) */}
          <BuilderSection
            value="dimensoes"
            title={isRecordList ? "Dimensões (colunas da tabela)" : "Dimensões"}
            badge={
              dimensions.filter((d) => d.field).length > 0
                ? String(dimensions.filter((d) => d.field).length)
                : null
            }
          >
            {dimensions.map((d, i) => {
              const af = available.find((a) => a.field === d.field);
              return (
                <DimensionRow
                  key={i}
                  dim={d}
                  // No modo lista as dimensões são colunas do cliente → permite
                  // campos sintéticos (ex.: "Data atual"). Na tabela/gráfico
                  // agregado a dimensão vai ao RPC → só campos reais.
                  fieldOptions={isRecordList ? availableOptions : rpcFieldOptions}
                  fieldChips={fieldSourceChips}
                  transformOptions={transformOptions}
                  dateAggOptions={dateAggOptions}
                  isDateField={isDate(d.field)}
                  defaultLabel={fieldLabel(d.field, available)}
                  isRecordList={isRecordList}
                  columnAggValue={columnAgg[d.field]}
                  unifiedSourceOptions={
                    isRecordList && d.field.startsWith("unified:")
                      ? unifiedSourceOptionsFor(d.field)
                      : undefined
                  }
                  unifiedSourcesValue={columnUnifiedSources[d.field] ?? []}
                  onUnifiedSourcesChange={(list) =>
                    setColumnUnifiedSources((prev) => {
                      const next = { ...prev };
                      if (list.length > 0) next[d.field] = list as SourceKey[];
                      else delete next[d.field];
                      return next;
                    })
                  }
                  editable={effEditable(d.field)}
                  writeBack={columnFlags[d.field]?.writeBack ?? false}
                  editableCapable={af?.editableCapable ?? false}
                  writable={af?.writable ?? false}
                  fieldMenu={renderFieldMenu(d.field)}
                  onChange={(patch) =>
                    setDimensions((prev) => {
                      const next = [...prev];
                      next[i] = { ...prev[i], ...patch };
                      return next;
                    })
                  }
                  onRemove={() =>
                    setDimensions((prev) => prev.filter((_, j) => j !== i))
                  }
                  onColumnAggChange={(a) =>
                    setColumnAgg((prev) => ({ ...prev, [d.field]: a }))
                  }
                  onFlagChange={(patch) => setColumnFlag(d.field, patch)}
                />
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setDimensions((prev) => [
                  ...prev,
                  { field: "", transform: "none" },
                ])
              }
            >
              <Plus className="size-4" /> Adicionar dimensão
            </Button>
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
          </BuilderSection>

          {/* Métricas */}
          <BuilderSection
            value="metricas"
            title="Métricas"
            badge={metrics.length > 0 ? String(metrics.length) : null}
          >
            {metrics.map((m, i) => (
              <MetricRow
                key={i}
                metric={m}
                metricOptions={metricOptions}
                fieldChips={fieldSourceChips}
                aggOptions={aggOptions}
                isMoney={isMoneyField(m.field)}
                isAggCalc={isAggCalcField(m.field)}
                isCalcSentinel={m.field === CALC_METRIC_FIELD}
                calcRefs={calcRefs}
                sourceDefs={catalog}
                previewAdapter={aggPreview(
                  m.sources && m.sources.length > 0 ? m.sources : sources,
                  m.resultPercent === true,
                  m.resultCurrency ?? null
                )}
                resultFormatOptions={[
                  { value: "", label: "Número (sem moeda)" },
                  { value: "percent", label: "Percentual (%) — exibe ×100" },
                  ...(currencyOptions ?? []).map((o) => ({
                    value: o.value,
                    label: `Moeda — ${o.label}`,
                  })),
                ]}
                defaultLabel={
                  isAggCalcField(m.field)
                    ? m.field === CALC_METRIC_FIELD
                      ? "Fórmula"
                      : fieldLabel(m.field, available)
                    : m.field === "*"
                      ? "Contagem de registros"
                      : `${AGG_LABELS[m.agg]} · ${fieldLabel(m.field, available)}`
                }
                fieldMenu={renderFieldMenu(m.field)}
                sourceOptions={metricSourceOptions(m)}
                onFieldChange={(field) => {
                  setMetrics((prev) => {
                    const next = [...prev];
                    const cur = prev[i];
                    if (isAggCalcField(field)) {
                      // Métrica calculada de agregados: a fórmula manda (agg
                      // persiste 'sum' por compat); fórmula/moeda ad-hoc só no
                      // sentinela 'calc:formula'. `sources` sobrevive à troca
                      // de campo (como o label — é config da LINHA da métrica).
                      next[i] = {
                        field,
                        agg: "sum",
                        calc: true,
                        label: cur.label,
                        sources: cur.sources,
                        ...(field === CALC_METRIC_FIELD
                          ? {
                              formula: cur.formula,
                              resultCurrency: cur.resultCurrency,
                              resultPercent: cur.resultPercent,
                            }
                          : {}),
                      };
                    } else {
                      const cleaned: Metric = {
                        ...cur,
                        field,
                        agg: field === "*" ? "count" : cur.agg,
                      };
                      delete cleaned.calc;
                      delete cleaned.formula;
                      delete cleaned.resultCurrency;
                      delete cleaned.resultPercent;
                      next[i] = cleaned;
                    }
                    return next;
                  });
                }}
                onChange={(patch) => updateMetric(i, patch)}
                onRemove={() =>
                  setMetrics((prev) => prev.filter((_, j) => j !== i))
                }
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setMetrics((prev) => [...prev, { field: "*", agg: "count" }])
              }
            >
              <Plus className="size-4" /> Adicionar métrica
            </Button>
          </BuilderSection>

          {/* Filtros (fixos do widget + barra de busca + filtros rápidos) */}
          <BuilderSection
            value="filtros"
            title="Filtros"
            badge={
              filters.length + quickFilters.filter((e) => e.field).length > 0
                ? String(
                    filters.length + quickFilters.filter((e) => e.field).length
                  )
                : null
            }
          >
            {filters.map((f, i) => (
              <FilterRow
                key={i}
                filter={f}
                fieldOptions={rpcFieldOptions}
                fieldChips={fieldSourceChips}
                opOptions={FILTER_OP_OPTIONS}
                sourceOptions={filterSourceOptions(f)}
                onChange={(patch) =>
                  setFilters((prev) => {
                    const next = [...prev];
                    next[i] = { ...prev[i], ...patch };
                    return next;
                  })
                }
                onRemove={() =>
                  setFilters((prev) => prev.filter((_, j) => j !== i))
                }
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setFilters((prev) => [
                  ...prev,
                  { field: "", op: "eq", value: "" },
                ])
              }
            >
              <Plus className="size-4" /> Adicionar filtro
            </Button>

            {/* Controles de filtro na VISUALIZAÇÃO, agrupados aqui: a barra de
                busca embutida (tabelas) e os filtros rápidos (dropdowns). */}
            {visualType === "tabela" ? (
              <label className="flex items-center gap-2 border-t pt-3 text-sm">
                <Checkbox
                  checked={showFilterBar}
                  onCheckedChange={(v) => setShowFilterBar(v === true)}
                />
                Mostrar barra de busca/filtro na tabela
              </label>
            ) : null}
            {supportsQuickFilters ? (
              <div className={visualType === "tabela" ? "" : "border-t pt-3"}>
                {quickFiltersBlock}
              </div>
            ) : null}
          </BuilderSection>

          {/* Opções da tabela: modo lista, orientação e agrupamento */}
          {visualType === "tabela" ? (
            <BuilderSection
              value="tabela"
              title="Opções da tabela"
              badge={recordsMode ? "Registros individuais" : "Agregada"}
            >
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
                    As colunas são as Dimensões acima (na ordem). Campos
                    personalizados não calculados ficam editáveis (se o papel
                    permitir) e gravam na entidade listada.
                  </p>
                </div>
              ) : null}
              {/* A barra de busca/filtro é configurada na seção "Filtros"
                  (agrupada com os filtros rápidos). */}
              {/* Orientação (agregada + lista de Registros) + Agrupar por (todos) */}
              <div className="flex flex-col gap-3 border-t pt-3">
                {!isEntityList ? (
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
                {transposed ? (
                  <div className="flex flex-col gap-1.5">
                    <Label>Colunas do topo</Label>
                    <Combobox
                      searchable={false}
                      options={allGroupByOptions}
                      value={effColDim}
                      onValueChange={(v) => {
                        setTableColDim(v);
                        // A dimensão das colunas não pode seguir como nível de
                        // grupo (grupo == coluna seria degenerado).
                        setTableGroupBy((prev) => prev.filter((k) => k !== v));
                      }}
                      aria-label="Dimensão das colunas do topo"
                    />
                    <p className="text-muted-foreground text-xs">
                      Os valores desta dimensão viram as colunas do topo; as
                      demais dimensões ficam disponíveis no &quot;Agrupar
                      por&quot; para agrupar o eixo esquerdo.
                    </p>
                  </div>
                ) : null}
                {(() => {
                  return (
                    <div className="flex flex-col gap-1.5">
                      <Label>Agrupar por</Label>
                      {tableGroupBy.map((level, idx) => (
                        <div key={idx} className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                              {idx + 1}.
                            </span>
                            <div className="flex-1">
                              <Combobox
                                searchable={false}
                                options={levelOptions(idx)}
                                value={level}
                                placeholder="— selecione —"
                                onValueChange={(v) => setGroupLevel(idx, v)}
                                aria-label={`Agrupar por — nível ${idx + 1}`}
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                              onClick={() => removeGroupLevel(idx)}
                              title="Remover nível"
                              aria-label={`Remover nível ${idx + 1}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                          {/* Formato do GRUPO (níveis de data): funde/rotula o
                              cabeçalho sem alterar o formato da dimensão nas
                              linhas expandidas. Na agregada, só dims SEM
                              transform "por nome" (ver groupFormatEligible). */}
                          {groupFormatEligible(level) ? (
                            <div className="flex items-center gap-1.5 pl-6 pr-9">
                              <Label className="text-muted-foreground shrink-0 text-xs font-normal">
                                Formato do grupo
                              </Label>
                              <div className="flex-1">
                                <Combobox
                                  searchable={false}
                                  options={groupFormatOptions}
                                  value={tableGroupFormats[level] ?? "inherit"}
                                  onValueChange={(v) => setGroupFormat(level, v)}
                                  aria-label={`Formato do grupo — nível ${idx + 1}`}
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        disabled={!canAddGroupLevel}
                        onClick={addGroupLevel}
                      >
                        <Plus className="size-4" />
                        {tableGroupBy.length === 0
                          ? "Agrupar por…"
                          : "Adicionar nível"}
                      </Button>
                      <p className="text-muted-foreground text-xs">
                        {transposed ? (
                          <>
                            Na orientação transposta, a 1ª dimensão fica nas colunas
                            do topo e as dimensões escolhidas aqui viram grupos
                            recolhíveis dentro de cada métrica. Recolhido mostra o
                            total; expandido detalha cada grupo. Vários níveis criam
                            uma hierarquia (o 1º aninha os demais dentro).
                          </>
                        ) : (
                          <>
                            Agrupa as linhas por uma ou mais{" "}
                            {isRecordList ? "colunas" : "dimensões"} em seções
                            recolhíveis com subtotais. Vários níveis criam uma
                            hierarquia (o 1º é o grupo principal, os demais aninham
                            dentro). Os grupos abrem recolhidos por padrão. Em
                            níveis de data, o &quot;Formato do grupo&quot; funde
                            as linhas por esse período no cabeçalho (ex.:
                            Mês/ano) — as linhas expandidas mantêm o formato da
                            dimensão.
                          </>
                        )}
                      </p>
                    </div>
                  );
                })()}
              </div>
            </BuilderSection>
          ) : null}

          {/* Comparação com período anterior (variação) */}
          {supportsComparison && !(visualType === "kpi" && kpiToday) ? (
            <ComparisonSection
              value={comparison}
              onChange={setComparison}
              visualType={visualType}
            />
          ) : null}

          {/* Dimensões dinâmicas: cresce p/ caber o conteúdo (por eixo) */}
          {supportsAutoSize ? (
            <BuilderSection
              value="avancado"
              title="Opções avançadas"
              badge={autoWidth || autoHeight ? "Tamanho dinâmico" : null}
            >
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
            </BuilderSection>
          ) : null}
          </Accordion>
          ) : null}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <Button onClick={save} disabled={pending}>
            {pending
              ? "Salvando..."
              : !widget && onRequestPlacement
                ? "Posicionar"
                : "Salvar widget"}
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
                allRefs={fieldFormAllRefs}
                excludeKeys={perRecordOps.excludeKeys}
                fieldChips={fieldSourceChips}
                aggRefs={calcRefs}
                sources={catalog}
                currencyOptions={currencyOptions}
                onDone={(created) => {
                  const wasEditing = Boolean(editingField);
                  setFieldSheetOpen(false);
                  setEditingField(null);
                  // Só na CRIAÇÃO o campo recém-criado entra na config: campo
                  // comum vira dimensão; "Calculado (totais)" vira métrica.
                  if (!wasEditing && created?.field_key) {
                    const ref = `custom:${created.field_key}`;
                    if (created.data_type === "calculado_agg") {
                      setMetrics((prev) =>
                        prev.some((m) => m.field === ref)
                          ? prev
                          : [...prev, { field: ref, agg: "sum", calc: true }]
                      );
                    } else {
                      setDimensions((prev) =>
                        prev.some((d) => d.field === ref)
                          ? prev
                          : [...prev, { field: ref, transform: "none" }]
                      );
                    }
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
