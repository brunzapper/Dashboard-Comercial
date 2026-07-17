// Versão: 2.3 | Data: 16/07/2026
// Card de um widget no grid: cabeçalho (título + menu "⋮" + alça de arraste no
// modo edição) e o chart.
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

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Copy, GripVertical, MoreVertical, Palette, Pencil, Trash2, X } from "lucide-react";

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
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import type { WidgetQuickFilters } from "@/lib/widgets/quick-filters";
import type { DateFormat } from "@/lib/widgets/format";
import { formatMoney, type CurrencyRates } from "@/lib/widgets/currency";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import {
  aggOperandRefs,
  condAggOperandRefs,
} from "@/lib/widgets/calc-metrics";
import { COND_DATA_TYPES } from "@/lib/records/cond-operands";
import type { OperandRef } from "@/lib/records/date-operands";
import { deleteWidget } from "@/app/(app)/dashboards/actions";
import { copyWidget } from "@/lib/widgets/clipboard";
import { WidgetChart } from "./charts/widget-chart";
import { QuickTableWidget } from "./quick-table/quick-table-widget";
import { KanbanWidget } from "@/components/kanban/kanban-widget";
import { AgendaWidget } from "@/components/agenda/agenda-widget";
import type { QTCellValue } from "@/lib/widgets/quick-table/model";
import { CalculatorWidget } from "./calculator-widget";
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
import { FieldFilterControls } from "./field-filter-controls";
import { WidgetBuilder } from "./widget-builder";
import { WidgetAppearanceSheet } from "./widget-appearance-sheet";
import { useWidgetAppearance } from "./appearance-editing";

export function WidgetCard({
  widget,
  data,
  recordList,
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
  canManageFields = false,
  currencyOptions,
  currencyRates = {},
  conversionPeriod,
  editMode,
  filterOptions,
  quickFilters,
  autoSize,
  cellW = 0,
  rowH = 0,
  mx = 0,
  my = 0,
  onMeasure,
  onWidgetDeleted,
}: {
  widget: Widget;
  data: WidgetData;
  recordList: RecordRow[];
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
  canManageFields?: boolean;
  editMode: boolean;
  filterOptions?: FieldFilterOptions;
  // Filtros rápidos do widget (config + valores efetivos + opções), montados no
  // servidor (page.tsx). Presente só quando o widget configura quickFilters.
  quickFilters?: WidgetQuickFilters;
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
}) {
  const [pending, startTransition] = useTransition();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // X da calculadora: some na hora (otimista); o refresh remove de vez.
  const [closing, setClosing] = useState(false);
  const { ap: appearance, save: saveAppearance } = useWidgetAppearance(
    widget,
    dashboardId
  );

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
  const kpi = isKpi ? appearance?.kpi : undefined;
  const noteAp = isNote ? appearance?.note : undefined;
  // Sem cromo de card: forma sempre; nota quando "Sem moldura" (Aparência).
  const frameless = isShape || (isNote && noteAp?.frameless === true);
  const title = appearance?.title;
  // Barra de busca/filtro embutida nas tabelas (ocultável na config do widget).
  const showTableBar = isTable && widget.settings?.showFilterBar !== false;
  // Aparência: charts/tabela/pizza/kpi e KANBAN (quadro/colunas/cards/abas —
  // settings.kanban.appearance); segue fora em filtro/calc/agenda.
  const canStyle = !isFilter && !isFieldFilter && !isCalc && !isAgenda;

  // Catálogo de operandos do editor in-place da nota (mesma montagem do
  // calcRefs do builder — aggOperandRefs + condAggOperandRefs).
  const noteEditorRefs: OperandRef[] = useMemo(() => {
    if (!isNote) return [];
    const numeric = availableForBuilder.filter((f) => f.isNumeric);
    const countable = availableForBuilder.filter(
      (f) => (f.isNumeric || f.isDate) && !f.aggCalc && !f.displayOnly
    );
    const customCond = fields
      .filter((f) => COND_DATA_TYPES.includes(f.data_type))
      .map((f) => ({ field_key: f.field_key, label: f.label }));
    const customDate = fields
      .filter((f) => f.data_type === "data")
      .map((f) => ({ field_key: f.field_key, label: f.label }));
    return [
      ...aggOperandRefs(numeric, countable),
      ...condAggOperandRefs(numeric, customCond, customDate),
    ];
  }, [isNote, availableForBuilder, fields]);

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

  const menu = canEdit ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Opções do widget">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setBuilderOpen(true);
          }}
        >
          <Pencil className="size-4" /> Editar dados
        </DropdownMenuItem>
        {canStyle ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setAppearanceOpen(true);
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
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const overlays = canEdit ? (
    <>
      <WidgetBuilder
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
      />
      {canStyle ? (
        <WidgetAppearanceSheet
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
        {canEdit ? (
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
        {overlays}
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="bg-card flex h-full flex-col overflow-hidden rounded-lg border"
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
          style={{ color: title?.color }}
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
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        {showTableBar ? (
          <TableFilterBar
            paramKey={`tf_${widget.id}`}
            available={available}
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
            />
          ) : isKanban ? (
            <KanbanWidget
              widget={widget}
              dashboardId={dashboardId}
              userRoles={userRoles}
              canEditValues={canEditValues}
              canManageFields={canManageFields}
              canConfig={canEdit}
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
              canEdit={canEdit}
              onAppearanceChange={saveAppearance}
            />
          ) : isRecordList ? (
            <RecordListTable
              records={recordList}
              columns={widget.settings?.columns ?? []}
              metrics={widget.metrics ?? []}
              fields={fields}
              available={available}
              userRoles={userRoles}
              canEditValues={canEditValues}
              fkLabels={fkLabels}
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
              <span className="text-3xl font-semibold tabular-nums">
                {calcValue?.value == null
                  ? "—"
                  : calcValue.currency
                    ? formatMoney(calcValue.value, calcValue.currency)
                    : calcValue.value.toLocaleString("pt-BR", {
                        maximumFractionDigits: 2,
                      })}
              </span>
            </div>
          ) : (
            <WidgetChart
              visualType={widget.visual_type}
              data={data}
              appearance={appearance}
              dateFormat={dateFormat}
              metricsConfig={widget.metrics ?? []}
              canEdit={canEdit}
              onAppearanceChange={saveAppearance}
            />
          )}
        </div>
      </div>

      {overlays}
    </div>
  );
}
