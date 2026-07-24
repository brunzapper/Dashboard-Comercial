// Versão: 2.11 | Data: 23/07/2026
// v2.11 (23/07/2026): FieldFilterControls ganha shared (settings.valueScope
//   'all' — valor do filtro compartilhado entre usuários via célula __ff__).
// v2.10 (21/07/2026): prop deferredScopeKey (fingerprint de escopo da page)
//   repassada a QuickTableWidget/KanbanWidget — re-fetch quando os filtros
//   efetivos mudam (inclusive __qf__, sem URL); guarda de resposta obsoleta
//   no pager server-side (pageReqRef — só a última resposta aterrissa).
// v2.9 (21/07/2026): badge "Nº dia útil" (WidgetData.businessDayRef) — via
// PeriodWindowControl ou standalone no mesmo slot (snapshot/align sem janela).
// v2.8 (20/07/2026): catálogo do editor da Nota via builder ÚNICO
//   (lib/widgets/agg-catalog.availableAggCatalogInput) — montagem idêntica.
// Card de um widget no grid: cabeçalho (título + menu "⋮" + alça de arraste no
// modo edição) e o chart.
// v2.7 (18/07/2026): fontes por métrica — prop recordListExtra repassada à
//   RecordListTable (extraRecords: basis dos subtotais das métricas com
//   Metric.sources).
// v2.6 (18/07/2026): overlay de processamento no card — enquanto o save do
//   builder (que agora fecha o painel na hora; pending espelhado via
//   onPendingChange) ou a exclusão correm, o card exibe spinner + backdrop.
//   "Editar dados" deixa de segurar o dropdown aberto (sem preventDefault):
//   com o painel fechando no salvar, o menu ficaria pairando sobre o card.
// v2.5 (17/07/2026): autoOpenEditor — card recém-criado pelo "Inserir ▸" (tipo
//   que exige configuração) monta com o editor de dados já aberto; consumo
//   one-shot via onAutoEditConsumed.
// v2.4 (17/07/2026): busca client-side na lista de registros — estado clientQ
//   elevado entre TableFilterBar (onSearchChange) e RecordListTable (searchQ),
//   ligado quando searchHandledOnClient(settings); semeado do tf_ da URL
//   (deep-link chega filtrado, já que o servidor pula o q nesses widgets).
// v2.3 (16/07/2026): calculadora ganha "X" no canto superior direito — fecha
//   (exclui) sem confirmação, sumindo na hora (estado `closing`); exclusões
//   avisam o shell via onWidgetDeleted (limpa o otimista da criação rápida).
// v2.2 (15/07/2026): widget "Tabela Livre" (tabela_editavel) — branch novo
//   renderizando QuickTableWidget com as células iniciais (tableCells).
// v2.1 (15/07/2026): widgets calculadora/nota/forma — branches novos no
//   conteúdo, layout SEM CROMO (frameless: forma sempre; nota opcional) com
//   grip de arraste flutuante (o .widget-drag é o único jeito de mover o item)
//   e menu "⋮" em hover, fundo do card da nota/calculadora, e catálogo de
//   operandos p/ o editor in-place da nota (mesma montagem do builder).
// v2.0 (Fase 10): botões lápis/lixeira viram um menu
// "⋮" (Editar dados / Aparência / Excluir com confirmação); a aparência do
// widget (cores, grade, legenda, etc.) é aplicada aos charts/tabelas e ao card
// KPI (fundo/borda/abinha de destaque).
"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Copy,
  Download,
  GripVertical,
  Loader2,
  MoreVertical,
  Palette,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type {
  CalcWidgetResult,
  FieldFilterOptions,
  RecordListColumn,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import { buildCsv, csvFilename, downloadCsv } from "@/lib/export/csv";
import { widgetDataToCsv } from "@/lib/export/widget-data";
import {
  recordColumnValue,
  recordRefLabel,
} from "@/lib/export/record-cells";
import { exportWidgetRecordsCsv } from "@/app/(app)/dashboards/export-actions";
import type { WidgetQuickFilters } from "@/lib/widgets/quick-filters";
import {
  RECORD_LIST_PAGE_SIZE,
  parseViewFilter,
  searchHandledOnClient,
  serverPaginatedList,
} from "@/lib/widgets/view-filters";
import { fetchWidgetRecordsPage } from "@/app/(app)/dashboards/record-list-actions";
import { recordSearchMatcher } from "@/lib/widgets/record-search";
import type { DateFormat } from "@/lib/widgets/format";
import { formatMoney, type CurrencyRates } from "@/lib/widgets/currency";
import { fracDigits } from "@/lib/widgets/appearance";
import { FONT_DEFAULTS, fontStyle } from "@/lib/widgets/fonts";
import { isChronoDim } from "@/lib/widgets/comparison";
import { evalConditional } from "@/lib/widgets/conditional";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import { useSources } from "@/components/sources-context";
import type { OperandRef } from "@/lib/records/date-operands";
import { deleteWidget } from "@/app/(app)/dashboards/actions";
import { copyWidget } from "@/lib/widgets/clipboard";
import type { QTCellValue } from "@/lib/widgets/quick-table/model";
import { useFontScale } from "./font-scale-context";
import { ImageWidget } from "./image-widget";
import { NoteWidget } from "./note-widget";
import { ShapeWidget } from "./shape-widget";
import {
  RecordListTable,
  type ResponsibleOption,
} from "./charts/record-list-table";
import { EntityListTable } from "./charts/entity-list-table";
import { PeriodControls } from "./period-controls";
import { TableFilterBar } from "./table-filter-bar";
import { QuickFiltersBar } from "./quick-filters-bar";
import {
  PeriodWindowControl,
  type WidgetPeriodWindowState,
} from "./period-window-control";
import { BusinessDayBadge } from "./business-day-badge";
import { FieldFilterControls } from "./field-filter-controls";
import { WidgetBuilder } from "./widget-builder";
import { WidgetAppearanceSheet } from "./widget-appearance-sheet";
import { useWidgetAppearance } from "./appearance-editing";

// Chunks deferidos (next/dynamic): o chart (recharts inteiro) e os widgets de
// tipo pesado saem do JS inicial do dashboard e carregam sob demanda no
// cliente. ssr: false — o conteúdo real deles só existe no browser (recharts
// mede o contêiner; kanban/agenda/tabela-livre buscam dados pós-mount); o
// fallback pulsante ocupa o espaço já reservado pelo card (sem layout shift).
// Constantes de MÓDULO: identidade estável entre renders (não recriar dentro
// do componente — remontaria o chunk a cada render).
const chunkFallback = (
  <div className="bg-muted h-full min-h-24 w-full animate-pulse rounded-md" />
);
const WidgetChart = dynamic(
  () => import("./charts/widget-chart").then((m) => m.WidgetChart),
  { ssr: false, loading: () => chunkFallback }
);
const QuickTableWidget = dynamic(
  () =>
    import("./quick-table/quick-table-widget").then((m) => m.QuickTableWidget),
  { ssr: false, loading: () => chunkFallback }
);
const KanbanWidget = dynamic(
  () => import("@/components/kanban/kanban-widget").then((m) => m.KanbanWidget),
  { ssr: false, loading: () => chunkFallback }
);
const AgendaWidget = dynamic(
  () => import("@/components/agenda/agenda-widget").then((m) => m.AgendaWidget),
  { ssr: false, loading: () => chunkFallback }
);
const CalculatorWidget = dynamic(
  () => import("./calculator-widget").then((m) => m.CalculatorWidget),
  { ssr: false, loading: () => chunkFallback }
);

// React.memo: o grid re-renderiza em toda medição/drag/hover — sem memo, TODOS
// os cards (e seus charts/tabelas) re-renderizavam juntos. As props vêm com
// referência estável do grid/página (fallbacks módulo-level, callbacks em
// useCallback), então o shallow-compare segura os cards não afetados.
export const WidgetCard = memo(function WidgetCard({
  widget,
  data,
  recordList,
  recordListExtra,
  recordListTotal,
  entityList,
  calcValue,
  calcVars,
  noteValues,
  calcExpr,
  tableCells,
  fields,
  fkLabels,
  responsibleOptions,
  userRoles,
  canEditValues,
  available,
  availableForBuilder,
  dashboardId,
  dateFormat,
  siblings,
  tabs,
  canEdit,
  canExport = false,
  canManageFields = false,
  currencyOptions,
  currencyRates = {},
  conversionPeriod,
  editMode,
  filterOptions,
  fieldFilterSeed,
  quickFilters,
  periodWindow,
  deferredScopeKey,
  autoSize,
  cellW = 0,
  rowH = 0,
  mx = 0,
  my = 0,
  onMeasure,
  onWidgetDeleted,
  autoOpenEditor = false,
  onAutoEditConsumed,
}: {
  widget: Widget;
  data: WidgetData;
  recordList: RecordRow[];
  // Registros das fontes de Metric.sources fora das do widget: só basis dos
  // subtotais da RecordListTable (nunca linhas). Ver runRecordListWithExtras.
  recordListExtra?: RecordRow[];
  // Total de registros quando a lista é PAGINADA no servidor (recordList é só
  // a página 1). Ausente = full fetch (paginação client-side, como antes).
  recordListTotal?: number;
  entityList: EntityListRow[];
  calcValue: CalcWidgetResult | null;
  // Calculadora: valores das variáveis (por id) e expressão compartilhada.
  calcVars?: Record<string, CalcWidgetResult>;
  calcExpr?: string;
  // Nota: resultados das expressões {=…}, na ordem do texto.
  noteValues?: CalcWidgetResult[];
  // Tabela Livre: células digitadas (dashboard_table_cells, rows não reservadas).
  tableCells?: QTCellValue[];
  fields: FieldDefinition[];
  currencyOptions?: { value: string; label: string }[];
  currencyRates?: CurrencyRates;
  conversionPeriod?: { year: number; quarter: number };
  fkLabels: Record<string, string>;
  responsibleOptions?: ResponsibleOption[];
  userRoles: string[];
  canEditValues: boolean;
  available: AvailableField[];
  // Lista COMPLETA para renderizar/filtrar (rótulos corretos p/ qualquer papel);
  // `availableForBuilder` é filtrada pelo ACL por papel e alimenta só os seletores
  // de edição (construtor do widget / aparência).
  availableForBuilder: AvailableField[];
  dashboardId: string;
  dateFormat?: DateFormat;
  siblings: Widget[];
  tabs?: { id: string; name: string; color?: string }[];
  canEdit: boolean;
  // Itens "Exportar CSV" do menu ⋮. Desligado por padrão — o viewer público de
  // snapshots nunca o liga.
  canExport?: boolean;
  canManageFields?: boolean;
  editMode: boolean;
  filterOptions?: FieldFilterOptions;
  // Seed do "Filtro por campo" quando a URL não traz o ff_: valor salvo do
  // usuário (lastFieldFilters). URL sempre vence.
  fieldFilterSeed?: string;
  // Filtros rápidos do widget (config + valores efetivos + opções), montados no
  // servidor (page.tsx). Presente só quando o widget configura quickFilters.
  quickFilters?: WidgetQuickFilters;
  // Janela de períodos (settings.periodWindow): estado efetivo do dropdown do
  // card, resolvido no servidor (__pw__ ?? default). Presente só quando o
  // widget configura periodWindow com options.
  periodWindow?: WidgetPeriodWindowState;
  // Fingerprint do escopo efetivo (período + filtros de visualização + __pw__)
  // dos widgets DEFERIDOS (Tabela Livre/kanban), computado na page: o effect
  // de fetch re-dispara quando muda — inclusive filtros persistidos no banco
  // (__qf__), que não passam pela URL. Ausente no snapshot (precomputado).
  deferredScopeKey?: string;
  // Dimensões dinâmicas (ligadas por eixo): mede o tamanho natural do conteúdo e
  // reporta ao grid, que usa max(mínimo, medido). `cellW`/`rowH`/`mx`/`my` são as
  // métricas de célula do grid (p/ converter px → unidades).
  autoSize?: { width?: boolean; height?: boolean };
  cellW?: number;
  rowH?: number;
  mx?: number;
  my?: number;
  onMeasure?: (id: string, wUnits: number, hUnits: number) => void;
  // Avisa o shell da exclusão (limpa o widget otimista da criação rápida).
  onWidgetDeleted?: (id: string) => void;
  // Inserir ▸ tipo que exige configuração: o card recém-criado monta com o
  // editor já aberto (one-shot — o consumo avisa o shell, para o editor não
  // reabrir num remount).
  autoOpenEditor?: boolean;
  onAutoEditConsumed?: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [builderOpen, setBuilderOpen] = useState(!!autoOpenEditor);
  // Nonce que re-monta o editor a cada ABERTURA: os sheets semeiam o estado
  // interno da prop `widget` uma única vez, e o widget pode ter mudado por fora
  // (Editar com IA, edição in-loco) desde o último open — sem o remount, o
  // editor reabriria com a config antiga até um F5. Reabrir sempre parte do
  // estado SALVO (rascunho não sobrevive ao fechar). Nonces separados: abrir
  // um editor não pode remontar o outro.
  const [builderNonce, setBuilderNonce] = useState(0);
  // Catálogo de fontes (contexto) p/ os operandos com escopo de fonte da nota.
  const sourcesCatalog = useSources();
  // Save do builder em andamento (painel já fechado): exibe o overlay de
  // processamento sobre o card até a revalidação entregar os dados novos.
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (autoOpenEditor) onAutoEditConsumed?.(widget.id);
    // Só no mount — o prop já foi consumido no estado inicial de builderOpen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceNonce, setAppearanceNonce] = useState(0);
  const openBuilder = () => {
    setBuilderNonce((n) => n + 1);
    setBuilderOpen(true);
  };
  const openAppearance = () => {
    setAppearanceNonce((n) => n + 1);
    setAppearanceOpen(true);
  };
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // X da calculadora: some na hora (otimista); o refresh remove de vez.
  const [closing, setClosing] = useState(false);
  const { ap: appearance, save: saveAppearance } = useWidgetAppearance(
    widget,
    dashboardId
  );
  const fontScale = useFontScale();
  const fonts = appearance?.fonts;

  // Refs p/ medir o tamanho natural do conteúdo (dimensões dinâmicas).
  const cardRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastMeasureRef = useRef<{ w: number; h: number } | null>(null);

  const isFilter = widget.visual_type === "filtro";
  const isFieldFilter = widget.visual_type === "filtro_campo";
  const isTable = widget.visual_type === "tabela";
  const isRecordList = isTable && widget.settings?.rowMode === "records";
  const rowSource = widget.settings?.rowSource ?? "records";
  const isEntityList = isRecordList && rowSource !== "records";
  const isQuickTable = widget.visual_type === "tabela_editavel";
  const isKanban = widget.visual_type === "kanban";
  const isAgenda = widget.visual_type === "agenda";
  const isCalc = widget.visual_type === "calculado";
  const isKpi = widget.visual_type === "kpi";
  const isCalculator = widget.visual_type === "calculadora";
  const isNote = widget.visual_type === "nota";
  const isShape = widget.visual_type === "forma";
  const isImage = widget.visual_type === "imagem";
  const kpi = isKpi ? appearance?.kpi : undefined;
  const noteAp = isNote ? appearance?.note : undefined;
  // Sem cromo de card: forma e imagem sempre (fundo transparente — PNG com
  // alpha aparece limpo); nota quando "Sem moldura" (Aparência).
  const frameless = isShape || isImage || (isNote && noteAp?.frameless === true);
  const title = appearance?.title;
  // Barra de busca/filtro embutida nas tabelas (ocultável na config do widget).
  const showTableBar = isTable && widget.settings?.showFilterBar !== false;
  // Busca textual client-side (lista de registros sem limit, barra visível):
  // a barra alimenta clientQ e a RecordListTable filtra em memória — o servidor
  // pula o q do tf_ nesses widgets (page.tsx usa o MESMO critério; ver
  // searchHandledOnClient). Semeia do tf_ da URL p/ deep-link chegar filtrado.
  const sp = useSearchParams();
  const clientSearch =
    isRecordList &&
    !isEntityList &&
    showTableBar &&
    searchHandledOnClient(widget.settings);
  const [clientQ, setClientQ] = useState(() =>
    clientSearch ? (parseViewFilter(sp.get(`tf_${widget.id}`)).q ?? "") : ""
  );

  // Paginação server-side (serverPaginatedList): recordList é só a página 1;
  // trocar de página busca as linhas via action (fetchWidgetRecordsPage), com
  // o escopo reconstruído da URL. Quando as props do RSC mudam (refresh após
  // edição/busca/navegação), volta à página 1 — as props JÁ são a página 1 do
  // recorte novo (ajuste de estado em render, padrão do repo).
  const serverPaged =
    isRecordList &&
    !isEntityList &&
    typeof recordListTotal === "number" &&
    serverPaginatedList(widget.settings);
  const [srvPage, setSrvPage] = useState<{
    page: number;
    rows: RecordRow[];
    fkLabels: Record<string, string>;
  } | null>(null);
  const [srvLoading, setSrvLoading] = useState(false);
  // Guarda de resposta obsoleta: cliques rápidos no pager (ou o re-fetch do
  // effect abaixo) disparam chamadas concorrentes — só a ÚLTIMA aterrissa.
  const pageReqRef = useRef(0);
  const handleServerPage = useCallback(
    (page: number) => {
      pageReqRef.current++;
      if (page <= 1) {
        setSrvPage(null); // página 1 = props do RSC (sempre atuais)
        setSrvLoading(false);
        return;
      }
      const id = pageReqRef.current;
      setSrvLoading(true);
      void fetchWidgetRecordsPage(
        dashboardId,
        widget.id,
        window.location.search,
        page - 1
      )
        .then((res) => {
          if (pageReqRef.current !== id || !res.ok) return;
          // Recorte encolheu (página pedida ficou vazia): volta à página 1.
          if (res.rows.length === 0) setSrvPage(null);
          else setSrvPage({ page, rows: res.rows, fkLabels: res.fkLabels });
        })
        .finally(() => {
          if (pageReqRef.current === id) setSrvLoading(false);
        });
    },
    [dashboardId, widget.id]
  );
  // Props do RSC mudaram (refresh após edição/busca/período): re-busca a MESMA
  // página no recorte novo em vez de voltar à página 1. Ref evita re-disparo
  // quando só o srvPage muda; no mount é no-op (ref 0).
  const srvPageNumRef = useRef(0);
  srvPageNumRef.current = srvPage?.page ?? 0;
  useEffect(() => {
    if (srvPageNumRef.current > 1) handleServerPage(srvPageNumRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordList]);
  const listFkLabels = useMemo(
    () => (srvPage ? { ...fkLabels, ...srvPage.fkLabels } : fkLabels),
    [fkLabels, srvPage]
  );
  const serverPageState = useMemo(() => {
    if (!serverPaged) return undefined;
    return {
      page: srvPage?.page ?? 1,
      total: recordListTotal,
      pageSize: RECORD_LIST_PAGE_SIZE,
      loading: srvLoading,
      onPageChange: handleServerPage,
    };
  }, [serverPaged, srvPage, srvLoading, recordListTotal, handleServerPage]);
  // Aparência: charts/tabela/pizza/kpi e KANBAN (quadro/colunas/cards/abas —
  // settings.kanban.appearance); segue fora em filtro/calc/agenda/imagem.
  const canStyle =
    !isFilter && !isFieldFilter && !isCalc && !isAgenda && !isImage;

  // Catálogo de operandos do editor in-place da nota — builder ÚNICO
  // (lib/widgets/agg-catalog.ts), mesma montagem do calcRefs do builder e da
  // action do quick-table; sem aninhados (comportamento vigente da Nota).
  const noteEditorRefs: OperandRef[] = useMemo(() => {
    if (!isNote) return [];
    return buildAggOperandCatalog(
      availableAggCatalogInput(availableForBuilder, fields, sourcesCatalog)
    );
  }, [isNote, availableForBuilder, fields, sourcesCatalog]);

  // Dimensões dinâmicas: mede o tamanho natural do conteúdo e reporta ao grid,
  // que renderiza max(mínimo, medido). Altura das tabelas vem da medição real do
  // <table> (encolhe com menos linhas); a largura vem da contagem de colunas (a
  // tabela é w-full, medir largura no DOM criaria loop). Gráficos (sem tamanho
  // natural) são estimados pela contagem de categorias.
  useEffect(() => {
    const wOn = autoSize?.width ?? false;
    const hOn = autoSize?.height ?? false;
    if ((!wOn && !hOn) || !onMeasure || cellW <= 0 || rowH <= 0) return;

    const PER_COL_W = 150; // largura aprox. por coluna de tabela
    const PER_CAT_W = 48; // largura aprox. por categoria (barra/linha/pizza/funil)
    const PER_CAT_H = 28; // altura aprox. por barra (barra horizontal)

    const isChart =
      widget.visual_type === "barra" ||
      widget.visual_type === "barra_horizontal" ||
      widget.visual_type === "linha" ||
      widget.visual_type === "pizza" ||
      widget.visual_type === "funil";

    const columnCount = (): number =>
      isRecordList
        ? (widget.settings?.columns?.length ?? 0)
        : (data.dimensions?.length ?? 0) + (data.metrics?.length ?? 0);

    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const card = cardRef.current;
        const content = contentRef.current;
        if (!card || !content) return;

        // "Cromo" do card (cabeçalho, paddings, barra de filtro) fora da área útil.
        const chromeH = Math.max(0, card.offsetHeight - content.clientHeight);
        const chromeW = Math.max(0, card.offsetWidth - content.clientWidth);

        const table = content.querySelector("table") as HTMLElement | null;
        let naturalW = 0;
        let naturalH = 0;
        if (table) {
          naturalH = table.offsetHeight;
          const cols = columnCount();
          naturalW = cols > 0 ? cols * PER_COL_W : 0;
        } else if (isChart) {
          const cats = data.rows?.length ?? 0;
          if (widget.visual_type === "barra_horizontal")
            naturalH = cats * PER_CAT_H;
          else naturalW = cats * PER_CAT_W;
        }

        const neededW = naturalW > 0 ? chromeW + naturalW : 0;
        const neededH = naturalH > 0 ? chromeH + naturalH : 0;
        const toUnits = (px: number, cell: number, margin: number) =>
          px > 0 ? Math.max(1, Math.ceil((px - margin) / (cell + margin))) : 0;

        const w = wOn ? toUnits(neededW, cellW, mx) : 0;
        const h = hOn ? toUnits(neededH, rowH, my) : 0;
        const last = lastMeasureRef.current;
        if (!last || last.w !== w || last.h !== h) {
          lastMeasureRef.current = { w, h };
          onMeasure(widget.id, w, h);
        }
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    if (cardRef.current) ro.observe(cardRef.current);
    const table = contentRef.current?.querySelector("table");
    if (table) ro.observe(table);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [
    autoSize?.width,
    autoSize?.height,
    onMeasure,
    cellW,
    rowH,
    mx,
    my,
    widget.id,
    widget.visual_type,
    widget.settings?.columns?.length,
    isRecordList,
    data,
    recordList,
    entityList,
  ]);

  // Menu "⋮" e overlays (builder/aparência/excluir) compartilhados entre o
  // layout padrão (com cabeçalho) e o frameless (forma/nota sem moldura).
  // Fechado pelo X (calculadora): desaparece imediatamente enquanto o
  // deleteWidget/refresh corre por trás. Depois de TODOS os hooks acima.
  if (closing) return null;

  // Exportação CSV (menu ⋮): "Exportar CSV" baixa o que o card exibe (dados já
  // recebidos por props — sem nova consulta); "Exportar registros (CSV)" busca
  // no servidor os registros por trás do recorte (runRecordList, RLS).
  const isAggregatedData =
    !isFilter &&
    !isFieldFilter &&
    !isQuickTable &&
    !isKanban &&
    !isAgenda &&
    !isCalc &&
    !isCalculator &&
    !isNote &&
    !isShape &&
    !isRecordList;
  const canExportDisplayed =
    canExport && ((isAggregatedData && !data.error) || isRecordList);
  const canExportRecords =
    canExport && (isAggregatedData || (isRecordList && !isEntityList));

  const exportFileName = (suffix?: string) =>
    csvFilename(
      `${widget.title ?? widget.visual_type}${suffix ? `-${suffix}` : ""}`
    );
  const exportLabels = {
    responsibles: fkLabels,
    operations: fkLabels,
    leads: fkLabels,
  };
  const exportColHeader = (c: RecordListColumn): string =>
    c.label ??
    available.find((a) => a.field === c.field)?.label ??
    recordRefLabel(c.field, fields);

  const exportDisplayedCsv = () => {
    const cols = (widget.settings?.columns ?? []) as RecordListColumn[];
    if (isEntityList) {
      const headers = ["Nome", ...cols.map(exportColHeader)];
      const rows = entityList.map((row) => {
        // Linha de entidade vira um "registro" só de custom_fields para reusar
        // o formatador compartilhado (moeda/data/percentual por definição).
        const fake = {
          custom_fields: row.values,
          currency: null,
        } as unknown as RecordRow;
        return [
          row.label,
          ...cols.map((c) =>
            recordColumnValue(fake, c.field, fields, exportLabels, available, {
              csv: true,
            })
          ),
        ];
      });
      downloadCsv(exportFileName(), buildCsv(headers, rows));
      return;
    }
    if (isRecordList) {
      // Busca client-side ativa: exporta só o que a tabela exibe (mesmo
      // matcher em memória de record-search.ts). Widget paginado no servidor:
      // exporta a PÁGINA visível (o conjunto completo sai pelo "Exportar
      // registros (CSV)", que refaz a consulta no servidor).
      const baseRecords = srvPage?.rows ?? recordList;
      const matcher = clientSearch
        ? recordSearchMatcher(clientQ, widget.settings?.searchFields, available)
        : null;
      const visibleRecords = matcher ? baseRecords.filter(matcher) : baseRecords;
      const metricCols = (widget.metrics ?? []).filter((m) => m.field);
      const headers = [
        ...cols.map(exportColHeader),
        ...metricCols.map(
          (m) =>
            m.label ??
            available.find((a) => a.field === m.field)?.label ??
            m.field
        ),
      ];
      const rows = visibleRecords.map((r) => [
        ...cols.map((c) =>
          recordColumnValue(r, c.field, fields, exportLabels, available, {
            csv: true,
          })
        ),
        ...metricCols.map((m) =>
          recordColumnValue(r, m.field, fields, exportLabels, available, {
            csv: true,
          })
        ),
      ]);
      downloadCsv(exportFileName(), buildCsv(headers, rows));
      return;
    }
    const { headers, rows } = widgetDataToCsv(data, widget.metrics ?? []);
    downloadCsv(exportFileName(), buildCsv(headers, rows));
  };

  const exportRecordsCsv = () => {
    setExportError(null);
    setExporting(true);
    void (async () => {
      try {
        const res = await exportWidgetRecordsCsv(
          dashboardId,
          widget.id,
          window.location.search
        );
        if (!res.ok) {
          setExportError(res.message);
          return;
        }
        downloadCsv(
          exportFileName("registros"),
          buildCsv(res.headers, res.rows)
        );
      } catch {
        setExportError("Falha ao exportar. Tente novamente.");
      } finally {
        setExporting(false);
      }
    })();
  };

  const showExportItems = canExportDisplayed || canExportRecords;
  const menu =
    canEdit || showExportItems ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Opções do widget">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit ? (
            <>
              {/* Sem preventDefault: o Sheet vive fora do menu, e o menu
                  precisa fechar — com o painel fechando já no salvar, um menu
                  aberto ficaria pairando sobre o card durante o processamento. */}
              <DropdownMenuItem onSelect={openBuilder}>
                <Pencil className="size-4" /> Editar dados
              </DropdownMenuItem>
              {canStyle ? (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    openAppearance();
                  }}
                >
                  <Palette className="size-4" /> Aparência
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  copyWidget(widget);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Copy className="size-4" /> {copied ? "Copiado!" : "Copiar widget"}
              </DropdownMenuItem>
            </>
          ) : null}
          {showExportItems ? (
            <>
              {canEdit ? <DropdownMenuSeparator /> : null}
              {canExportDisplayed ? (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    exportDisplayedCsv();
                  }}
                >
                  <Download className="size-4" /> Exportar CSV
                </DropdownMenuItem>
              ) : null}
              {canExportRecords ? (
                <DropdownMenuItem
                  disabled={exporting}
                  onSelect={(e) => {
                    e.preventDefault();
                    exportRecordsCsv();
                  }}
                >
                  <Download className="size-4" />{" "}
                  {exporting ? "Exportando…" : "Exportar registros (CSV)"}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="size-4" /> Excluir
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const overlays = canEdit ? (
    <>
      <WidgetBuilder
        key={`b${builderNonce}`}
        dashboardId={dashboardId}
        available={availableForBuilder}
        widget={widget}
        siblings={siblings}
        canManageFields={canManageFields}
        fields={fields}
        currencyOptions={currencyOptions}
        tabs={tabs}
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        onPendingChange={setSaving}
      />
      {canStyle ? (
        <WidgetAppearanceSheet
          key={`a${appearanceNonce}`}
          dashboardId={dashboardId}
          widget={widget}
          data={data}
          available={availableForBuilder}
          open={appearanceOpen}
          onOpenChange={setAppearanceOpen}
        />
      ) : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir widget?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir
              {widget.title ? ` "${widget.title}"` : " este widget"}? Esta
              ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  await deleteWidget(widget.id, dashboardId);
                  onWidgetDeleted?.(widget.id);
                  setDeleteOpen(false);
                });
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  ) : null;

  // Overlay de processamento: cobre o card enquanto o save do builder (painel
  // já fechado) ou a exclusão correm — versão por card do overlay global do
  // grid (dashboard-grid.tsx), pílula só com spinner (cards KPI são pequenos).
  const processingOverlay =
    saving || pending ? (
      <div className="bg-background/50 absolute inset-0 z-20 flex items-center justify-center rounded-lg backdrop-blur-[1px]">
        <div className="bg-background text-muted-foreground flex items-center rounded-full border p-1.5 shadow-sm">
          <Loader2 className="size-4 animate-spin" />
          <span className="sr-only">Atualizando...</span>
        </div>
      </div>
    ) : null;

  // Layout SEM CROMO (forma; nota "sem moldura"): o conteúdo ocupa o item
  // inteiro; o grip .widget-drag flutuante é OBRIGATÓRIO no modo edição (o
  // draggableHandle do grid é o único jeito de mover o item) e o menu "⋮"
  // aparece em hover.
  if (frameless) {
    return (
      <div ref={cardRef} className="group relative h-full">
        {editMode ? (
          <span className="widget-drag bg-background/80 text-muted-foreground absolute top-1 left-1 z-10 cursor-move rounded border p-0.5">
            <GripVertical className="size-4" />
          </span>
        ) : null}
        {menu ? (
          <div className="absolute top-1 right-1 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {menu}
          </div>
        ) : null}
        {isShape ? (
          <ShapeWidget
            shape={widget.settings?.shape}
            appearance={appearance?.shape}
            editMode={editMode}
          />
        ) : isImage ? (
          <ImageWidget
            image={widget.settings?.image}
            title={widget.title}
            editMode={editMode}
            canEdit={canEdit}
            onConfigure={openBuilder}
          />
        ) : (
          <div className="h-full overflow-hidden rounded-lg">
            <NoteWidget
              widget={widget}
              dashboardId={dashboardId}
              values={noteValues}
              appearance={noteAp}
              canEdit={canEdit}
              editMode={editMode}
              editorRefs={noteEditorRefs}
            />
          </div>
        )}
        {processingOverlay}
        {overlays}
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="bg-card relative flex h-full flex-col overflow-hidden rounded-lg border"
      style={{
        background:
          kpi?.bg ??
          (isNote
            ? (noteAp?.bg ?? "#fef9c3")
            : isCalculator
              ? appearance?.calculator?.bg
              : undefined),
        borderColor: title?.border ?? kpi?.border,
      }}
    >
      {kpi?.accent ? (
        <div style={{ height: 3, background: kpi.accent }} />
      ) : null}
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ background: title?.bg }}
      >
        {editMode ? (
          <span className="widget-drag text-muted-foreground cursor-move">
            <GripVertical className="size-4" />
          </span>
        ) : null}
        <span
          className="flex-1 truncate text-sm font-medium"
          style={{
            color: title?.color,
            ...fontStyle(fonts?.title, FONT_DEFAULTS.title, fontScale),
          }}
        >
          {widget.title ?? "Sem título"}
        </span>
        {menu}
        {isCalculator && canEdit ? (
          // Fechar fácil (sem confirmação): a exclusão entra no histórico do
          // dashboard, então Desfazer restaura a calculadora.
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground size-6"
            title="Fechar calculadora"
            aria-label="Fechar calculadora"
            onClick={() => {
              setClosing(true);
              startTransition(async () => {
                await deleteWidget(widget.id, dashboardId);
                onWidgetDeleted?.(widget.id);
              });
            }}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      {exportError ? (
        <p className="text-destructive border-b px-3 py-1 text-xs">
          {exportError}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        {showTableBar ? (
          <TableFilterBar
            paramKey={`tf_${widget.id}`}
            available={available}
            onSearchChange={clientSearch ? setClientQ : undefined}
          />
        ) : null}
        {/* Filtros rápidos: lado a lado, abaixo da barra de busca (tabelas) ou
            no topo do card (gráficos/KPI/calculado). */}
        {quickFilters && quickFilters.entries.length > 0 ? (
          <QuickFiltersBar
            dashboardId={dashboardId}
            widgetId={widget.id}
            qf={quickFilters}
            available={available}
          />
        ) : null}
        {/* Janela de períodos (settings.periodWindow): dropdown "3 meses/Este
            trimestre/…" + toggle dia útil × dia cheio, seleção compartilhada. */}
        {periodWindow && periodWindow.options.length > 0 ? (
          <PeriodWindowControl
            dashboardId={dashboardId}
            widgetId={widget.id}
            state={periodWindow}
            bdRef={data.businessDayRef}
          />
        ) : data.businessDayRef ? (
          // Sem o controle da janela (align direto nos settings, ou viewer de
          // snapshot — que congela settings e não monta o dropdown), o badge
          // "Nº dia útil" aparece sozinho no mesmo slot.
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5">
            <BusinessDayBadge bdRef={data.businessDayRef} />
          </div>
        ) : null}
        <div ref={contentRef} className="min-h-0 flex-1">
          {isFilter ? (
            <div className="flex h-full items-center p-1">
              <PeriodControls
                keys={{
                  preset: `pf_${widget.id}`,
                  de: `pfd_${widget.id}`,
                  ate: `pfa_${widget.id}`,
                }}
                defaults={{ preset: widget.settings?.defaultPreset ?? "" }}
              />
            </div>
          ) : isFieldFilter ? (
            <FieldFilterControls
              paramKey={`ff_${widget.id}`}
              fields={widget.settings?.fields ?? []}
              searchFields={widget.settings?.searchFields}
              available={available}
              options={filterOptions}
              savedValue={fieldFilterSeed}
              dashboardId={dashboardId}
              widgetId={widget.id}
              shared={widget.settings?.valueScope === "all"}
            />
          ) : isQuickTable ? (
            <QuickTableWidget
              widget={widget}
              dashboardId={dashboardId}
              cells={tableCells ?? []}
              userRoles={userRoles}
              available={available}
              dateFormat={dateFormat}
              canEdit={canEdit}
              editMode={editMode}
              appearance={appearance}
              onAppearanceChange={saveAppearance}
              scopeKey={deferredScopeKey}
            />
          ) : isKanban ? (
            <KanbanWidget
              widget={widget}
              dashboardId={dashboardId}
              userRoles={userRoles}
              canEditValues={canEditValues}
              canManageFields={canManageFields}
              canConfig={canEdit}
              scopeKey={deferredScopeKey}
            />
          ) : isAgenda ? (
            <AgendaWidget
              widget={widget}
              dashboardId={dashboardId}
              userRoles={userRoles}
              canEditValues={canEditValues}
              canManageFields={canManageFields}
            />
          ) : data.error ? (
            // Erro ao computar o widget no servidor (WidgetData.error): mostra
            // a mensagem em vez de uma tabela/gráfico silenciosamente em branco.
            <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
              <span className="text-destructive text-sm font-medium">
                Não foi possível carregar este widget.
              </span>
              <span
                className="text-muted-foreground max-w-full truncate text-xs"
                title={data.error}
              >
                {data.error}
              </span>
            </div>
          ) : isEntityList ? (
            <EntityListTable
              rows={entityList}
              columns={widget.settings?.columns ?? []}
              rowSource={rowSource as "responsibles" | "operations"}
              fields={fields}
              available={available}
              userRoles={userRoles}
              canEditValues={canEditValues}
              appearance={appearance}
              dateFormat={dateFormat}
              dashboardId={dashboardId}
              canEdit={canEdit}
              onAppearanceChange={saveAppearance}
            />
          ) : isRecordList ? (
            <RecordListTable
              records={srvPage?.rows ?? recordList}
              extraRecords={recordListExtra}
              serverPage={serverPageState}
              searchQ={clientSearch ? clientQ : undefined}
              searchFields={widget.settings?.searchFields}
              columns={widget.settings?.columns ?? []}
              metrics={widget.metrics ?? []}
              fields={fields}
              available={available}
              userRoles={userRoles}
              canEditValues={canEditValues}
              fkLabels={listFkLabels}
              responsibleOptions={responsibleOptions}
              appearance={appearance}
              dateFormat={dateFormat}
              currencyRates={currencyRates}
              conversionPeriod={conversionPeriod}
              canEdit={canEdit}
              onAppearanceChange={saveAppearance}
            />
          ) : isCalculator ? (
            <CalculatorWidget
              widget={widget}
              dashboardId={dashboardId}
              vars={calcVars}
              initialExpr={calcExpr}
              appearance={appearance?.calculator}
            />
          ) : isNote ? (
            <NoteWidget
              widget={widget}
              dashboardId={dashboardId}
              values={noteValues}
              appearance={noteAp}
              canEdit={canEdit}
              editMode={editMode}
              editorRefs={noteEditorRefs}
            />
          ) : isCalc ? (
            <div className="flex h-full flex-col justify-center p-1">
              {(() => {
                // Formatação condicional do valor (alvo "value"; regra vence
                // só quando casa — ver lib/widgets/conditional.ts).
                const cs = evalConditional(
                  appearance?.conditional,
                  "value",
                  calcValue?.value
                );
                return (
                  <span
                    className="text-3xl font-semibold tabular-nums"
                    style={{
                      color: cs?.text,
                      background: cs?.fill,
                      ...(cs?.bold ? { fontWeight: 700 } : {}),
                      ...fontStyle(fonts?.value, FONT_DEFAULTS.value, fontScale),
                    }}
                  >
                    {calcValue?.value == null
                      ? "—"
                      : calcValue.currency
                        ? formatMoney(
                            calcValue.value,
                            calcValue.currency,
                            appearance?.decimals
                          )
                        : calcValue.value.toLocaleString(
                            "pt-BR",
                            fracDigits(appearance?.decimals)
                          )}
                  </span>
                );
              })()}
            </div>
          ) : (
            <WidgetChart
              visualType={widget.visual_type}
              data={data}
              appearance={appearance}
              dateFormat={dateFormat}
              // Card em modo ranking: a métrica efetiva é a do settings.card
              // (as metrics do widget não participam da consulta derivada).
              metricsConfig={
                data.card?.mode === "topn" && widget.settings?.card?.metric
                  ? [widget.settings.card.metric]
                  : (widget.metrics ?? [])
              }
              canEdit={canEdit}
              onAppearanceChange={saveAppearance}
              dimChrono={Boolean(
                widget.dimensions?.[0] && isChronoDim(widget.dimensions[0])
              )}
            />
          )}
        </div>
      </div>

      {processingOverlay}
      {overlays}
    </div>
  );
});
