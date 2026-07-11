// Versão: 1.0 | Data: 11/07/2026
// Widget de Tabela em modo lista cuja "Fonte das linhas" é uma ENTIDADE
// (responsáveis/operações). Uma linha por entidade: a 1ª coluna é o nome
// (read-only) e as demais são as colunas personalizadas escolhidas — as não
// calculadas ficam editáveis (respeitando editable_by_roles) e gravam em
// entity_custom_values via updateEntityField (valores globais/compartilhados).
// Datas formatadas (padrão do dashboard + override por coluna) e duplo-clique
// numa data abre o calendário. Larguras/alturas redimensionáveis na edição.
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FieldDefinition } from "@/lib/records/types";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { ENTITY_TYPE_OF } from "@/lib/widgets/entity-list";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  type DateFormat,
} from "@/lib/widgets/format";
import type { AppearanceSettings, RecordListColumn } from "@/lib/widgets/types";
import { updateEntityField } from "@/app/(app)/dashboards/actions";
import { ContextMenu, ResizeHandle } from "../appearance-editing";

// Célula editável de um valor ligado à entidade. Reusa o padrão da EditableCell
// de Registros, mas grava via updateEntityField (entity_custom_values).
function EntityEditableCell({
  entityType,
  entityId,
  field,
  userRoles,
  canEditValues,
  dateFormat,
  value: serverValue,
  onSaved,
}: {
  entityType: "responsible" | "operation";
  entityId: string;
  field: FieldDefinition;
  userRoles: string[];
  canEditValues: boolean;
  dateFormat: DateFormat;
  value: string;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState(serverValue);
  const savedRef = useRef(serverValue);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const [editingDate, setEditingDate] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(serverValue);
    savedRef.current = serverValue;
  }, [serverValue]);

  const editable =
    canEditValues &&
    field.data_type !== "calculado" &&
    field.editable_by_roles.some((r) => userRoles.includes(r));

  function money(v: string): string {
    const n = Number(v);
    if (!Number.isFinite(n)) return v;
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  if (!editable) {
    const display =
      field.data_type === "moeda"
        ? money(serverValue)
        : field.data_type === "data"
          ? formatDateValue(serverValue, dateFormat)
          : serverValue;
    return <span className="block truncate">{display || "—"}</span>;
  }

  function commit(raw: string) {
    if (raw === savedRef.current) return;
    setValue(raw);
    setError(false);
    startTransition(async () => {
      const res = await updateEntityField(entityType, entityId, field.field_key, raw);
      if (res.ok) {
        savedRef.current = raw;
        onSaved?.();
      } else {
        setValue(savedRef.current);
        setError(true);
      }
    });
  }

  if (field.data_type === "selecao") {
    return (
      <Combobox
        options={[
          { value: "", label: "—" },
          ...field.options.map((opt) => ({ value: opt, label: opt })),
        ]}
        value={value}
        onValueChange={commit}
        placeholder="—"
        disabled={pending}
        className={cn("w-full", error && "border-destructive")}
        aria-label={field.label}
      />
    );
  }

  if (field.data_type === "booleano") {
    return (
      <Checkbox
        checked={value === "true"}
        onCheckedChange={(c) => commit(c === true ? "true" : "false")}
        disabled={pending}
        aria-label={field.label}
        aria-invalid={error}
      />
    );
  }

  if (field.data_type === "data") {
    if (!editingDate) {
      return (
        <button
          type="button"
          onDoubleClick={() => setEditingDate(true)}
          title="Duplo-clique para escolher a data"
          className={cn("block w-full truncate text-left", error && "text-destructive")}
          aria-label={field.label}
        >
          {formatDateValue(value, dateFormat) || "—"}
        </button>
      );
    }
    return (
      <Input
        type="date"
        autoFocus
        value={value.slice(0, 10)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => {
          commit(e.target.value);
          setEditingDate(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(savedRef.current);
            setEditingDate(false);
          }
        }}
        disabled={pending}
        aria-label={field.label}
        aria-invalid={error}
        className={cn(error && "border-destructive")}
      />
    );
  }

  if (field.data_type === "numero" || field.data_type === "moeda") {
    return (
      <Input
        type="number"
        step={field.data_type === "moeda" ? "0.01" : "any"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        disabled={pending}
        aria-label={field.label}
        aria-invalid={error}
        className={cn("text-right", error && "border-destructive")}
      />
    );
  }

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      disabled={pending}
      aria-label={field.label}
      aria-invalid={error}
      className={cn(error && "border-destructive")}
    />
  );
}

export function EntityListTable({
  rows,
  columns,
  rowSource,
  fields,
  available,
  userRoles,
  canEditValues,
  appearance,
  dateFormat,
  canEdit = false,
  onAppearanceChange,
}: {
  rows: EntityListRow[];
  columns: RecordListColumn[];
  rowSource: "responsibles" | "operations";
  fields: FieldDefinition[];
  available: AvailableField[];
  userRoles: string[];
  canEditValues: boolean;
  appearance?: AppearanceSettings;
  dateFormat?: DateFormat;
  canEdit?: boolean;
  onAppearanceChange?: (a: AppearanceSettings) => void;
}) {
  const router = useRouter();
  const ap = appearance ?? {};
  const t = ap.table ?? {};
  const editable = canEdit && Boolean(onAppearanceChange);
  const change = onAppearanceChange ?? (() => {});
  const dashFmt = dateFormat ?? DEFAULT_DATE_FORMAT;
  const entityType = ENTITY_TYPE_OF[rowSource];

  const [menu, setMenu] = useState<{ x: number; y: number; column: string } | null>(null);

  const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));
  // Só colunas personalizadas fazem sentido por entidade; a 1ª coluna é o nome.
  const cols = columns.filter((c) => c.field.startsWith("custom:"));

  const isDateCol = (field: string): boolean =>
    field.startsWith("custom:") && fieldByKey.get(field.slice(7))?.data_type === "data";
  const fmtOf = (field: string): DateFormat => t.dateFormats?.[field] ?? dashFmt;

  const gl = t.gridLines ?? "both";
  const vertical = gl === "vertical" || gl === "both";
  const horizontal = gl === "horizontal" || gl === "both";
  const rowBorder = horizontal ? "" : "border-b-0";
  const totalCols = cols.length + 1; // + coluna do nome
  const cellBorder = (idx: number) =>
    vertical && idx < totalCols - 1
      ? { borderRight: `1px solid ${t.borderColor ?? "var(--border)"}` }
      : {};
  const widthStyle = (field: string): React.CSSProperties => {
    const w = t.colWidths?.[field];
    return w ? { width: w, minWidth: w, maxWidth: w } : {};
  };
  // Classe do conteúdo interno da célula: cortar (…) ou quebrar linha.
  const cellText = t.cellText ?? "clip";
  const cellSpanClass =
    cellText === "wrap"
      ? "block whitespace-normal break-words"
      : "block truncate";

  const setTable = (patch: Partial<NonNullable<AppearanceSettings["table"]>>) =>
    change({ ...ap, table: { ...t, ...patch } });
  const setColWidth = (column: string, w: number) =>
    setTable({ colWidths: { ...(t.colWidths ?? {}), [column]: w } });
  const setRowHeight = (rowKey: string, h: number) =>
    setTable({ rowHeights: { ...(t.rowHeights ?? {}), [rowKey]: h } });
  const setColDateFormat = (column: string, f: DateFormat) =>
    setTable({ dateFormats: { ...(t.dateFormats ?? {}), [column]: f } });

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Nenhum registro para exibir.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
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
            <TableHead className="whitespace-nowrap" style={cellBorder(0)}>
              Nome
            </TableHead>
            {cols.map((c, ci) => (
              <TableHead
                key={c.field}
                className="group relative whitespace-nowrap"
                onDoubleClick={
                  editable && isDateCol(c.field)
                    ? (e) => setMenu({ x: e.clientX, y: e.clientY, column: c.field })
                    : undefined
                }
                style={{
                  background: t.colColors?.[c.field]?.fill,
                  color: t.colColors?.[c.field]?.text ?? t.headerColor,
                  ...cellBorder(ci + 1),
                  ...widthStyle(c.field),
                }}
              >
                {c.label?.trim() || fieldLabel(c.field, available)}
                {editable ? (
                  <ResizeHandle axis="col" onResize={(w) => setColWidth(c.field, w)} />
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const h = t.rowHeights?.[r.id];
            return (
              <TableRow
                key={r.id}
                className={rowBorder}
                style={{
                  background: t.bodyBg,
                  color: t.bodyColor,
                  ...(t.borderColor ? { borderColor: t.borderColor } : {}),
                  ...(h ? { height: h } : {}),
                }}
              >
                <TableCell className="relative align-top font-medium" style={cellBorder(0)}>
                  <span className={cellSpanClass}>{r.label}</span>
                  {editable ? (
                    <ResizeHandle axis="row" onResize={(hh) => setRowHeight(r.id, hh)} />
                  ) : null}
                </TableCell>
                {cols.map((c, ci) => {
                  const field = fieldByKey.get(c.field.slice(7));
                  const raw = r.values[c.field.slice(7)];
                  return (
                    <TableCell
                      key={c.field}
                      className={cn("align-top", !t.colWidths?.[c.field] && "max-w-[200px]")}
                      style={{
                        background: t.colColors?.[c.field]?.fill,
                        color: t.colColors?.[c.field]?.text ?? t.bodyColor,
                        ...cellBorder(ci + 1),
                        ...widthStyle(c.field),
                        ...(cellText === "clip" ? { overflow: "hidden" } : {}),
                      }}
                    >
                      {field ? (
                        <EntityEditableCell
                          entityType={entityType}
                          entityId={r.id}
                          field={field}
                          userRoles={userRoles}
                          canEditValues={canEditValues}
                          dateFormat={fmtOf(c.field)}
                          value={raw == null ? "" : String(raw)}
                          onSaved={() => router.refresh()}
                        />
                      ) : (
                        <span className={cellSpanClass}>—</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          dateFormat={{
            value: t.dateFormats?.[menu.column],
            onSelect: (f) => {
              setColDateFormat(menu.column, f);
              setMenu(null);
            },
          }}
        />
      ) : null}
    </div>
  );
}
