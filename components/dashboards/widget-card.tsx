// Versão: 2.0 | Data: 10/07/2026
// Card de um widget no grid: cabeçalho (título + menu "⋮" + alça de arraste no
// modo edição) e o chart. v2.0 (Fase 10): botões lápis/lixeira viram um menu
// "⋮" (Editar dados / Aparência / Excluir com confirmação); a aparência do
// widget (cores, grade, legenda, etc.) é aplicada aos charts/tabelas e ao card
// KPI (fundo/borda/abinha de destaque).
"use client";

import { useState, useTransition } from "react";
import { GripVertical, MoreVertical, Palette, Pencil, Trash2 } from "lucide-react";

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
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { deleteWidget } from "@/app/(app)/dashboards/actions";
import { WidgetChart } from "./charts/widget-chart";
import { RecordListTable } from "./charts/record-list-table";
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
  dashboardId,
  dateFormat,
  siblings,
  tabs,
  canEdit,
  canManageFields = false,
  editMode,
  filterOptions,
}: {
  widget: Widget;
  data: WidgetData;
  recordList: RecordRow[];
  entityList: EntityListRow[];
  calcValue: number | null;
  fields: FieldDefinition[];
  fkLabels: Record<string, string>;
  responsibleOptions?: { value: string; label: string }[];
  userRoles: string[];
  canEditValues: boolean;
  available: AvailableField[];
  dashboardId: string;
  dateFormat?: DateFormat;
  siblings: Widget[];
  tabs?: { id: string; name: string; color?: string }[];
  canEdit: boolean;
  canManageFields?: boolean;
  editMode: boolean;
  filterOptions?: FieldFilterOptions;
}) {
  const [pending, startTransition] = useTransition();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { ap: appearance, save: saveAppearance } = useWidgetAppearance(
    widget,
    dashboardId
  );

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

  return (
    <div
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
        <div className="min-h-0 flex-1">
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
            available={available}
            widget={widget}
            siblings={siblings}
            canManageFields={canManageFields}
            tabs={tabs}
            open={builderOpen}
            onOpenChange={setBuilderOpen}
          />
          {canStyle ? (
            <WidgetAppearanceSheet
              dashboardId={dashboardId}
              widget={widget}
              data={data}
              available={available}
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
