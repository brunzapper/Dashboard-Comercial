// Versão: 2.0 | Data: 10/07/2026
// Card de um widget no grid: cabeçalho (título + menu "⋮" + alça de arraste no
// modo edição) e o chart. v2.0 (Fase 10): botões lápis/lixeira viram um menu
// "⋮" (Editar dados / Aparência / Excluir com confirmação); a aparência do
// widget (cores, grade, legenda, etc.) é aplicada aos charts/tabelas e ao card
// KPI (fundo/borda/abinha de destaque).
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Copy, GripVertical, MoreVertical, Palette, Pencil, Trash2 } from "lucide-react";

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
  FieldFilterOptions,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import type { DateFormat } from "@/lib/widgets/format";
import type { CurrencyRates } from "@/lib/widgets/currency";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { deleteWidget } from "@/app/(app)/dashboards/actions";
import { copyWidget } from "@/lib/widgets/clipboard";
import { WidgetChart } from "./charts/widget-chart";
import {
  RecordListTable,
  type ResponsibleOption,
} from "./charts/record-list-table";
import { EntityListTable } from "./charts/entity-list-table";
import { PeriodControls } from "./period-controls";
import { TableFilterBar } from "./table-filter-bar";
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
  autoSize,
  cellW = 0,
  rowH = 0,
  mx = 0,
  my = 0,
  onMeasure,
}: {
  widget: Widget;
  data: WidgetData;
  recordList: RecordRow[];
  entityList: EntityListRow[];
  calcValue: number | null;
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
  // Dimensões dinâmicas (ligadas por eixo): mede o tamanho natural do conteúdo e
  // reporta ao grid, que usa max(mínimo, medido). `cellW`/`rowH`/`mx`/`my` são as
  // métricas de célula do grid (p/ converter px → unidades).
  autoSize?: { width?: boolean; height?: boolean };
  cellW?: number;
  rowH?: number;
  mx?: number;
  my?: number;
  onMeasure?: (id: string, wUnits: number, hUnits: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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
  const isCalc = widget.visual_type === "calculado";
  const isKpi = widget.visual_type === "kpi";
  const kpi = isKpi ? appearance?.kpi : undefined;
  const title = appearance?.title;
  // Barra de busca/filtro embutida nas tabelas (ocultável na config do widget).
  const showTableBar = isTable && widget.settings?.showFilterBar !== false;
  // Aparência só faz sentido em charts/tabela/pizza/kpi (não em filtro/calc).
  const canStyle = !isFilter && !isFieldFilter && !isCalc;

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

  return (
    <div
      ref={cardRef}
      className="bg-card flex h-full flex-col overflow-hidden rounded-lg border"
      style={{
        background: kpi?.bg,
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
        {canEdit ? (
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
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        {showTableBar ? (
          <TableFilterBar
            paramKey={`tf_${widget.id}`}
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
          ) : isCalc ? (
            <div className="flex h-full flex-col justify-center p-1">
              <span className="text-3xl font-semibold tabular-nums">
                {calcValue == null
                  ? "—"
                  : calcValue.toLocaleString("pt-BR", {
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

      {canEdit ? (
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
      ) : null}
    </div>
  );
}
