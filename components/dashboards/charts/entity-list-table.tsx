// Versão: 1.1 | Data: 18/07/2026
// v1.1 (18/07/2026): refresh pós-edição debounced e fora da transition da
//   célula (useDebouncedRefresh) — sem re-render do dashboard por célula.
// Widget de Tabela em modo lista cuja "Fonte das linhas" é uma ENTIDADE
// (responsáveis/operações). Uma linha por entidade: a 1ª coluna é o nome
// (read-only) e as demais são as colunas personalizadas escolhidas — as não
// calculadas ficam editáveis (respeitando editable_by_roles) e gravam em
// entity_custom_values via updateEntityField (valores globais/compartilhados).
// Datas formatadas (padrão do dashboard + override por coluna) e duplo-clique
// numa data abre o calendário. Larguras/alturas redimensionáveis na edição.
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

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
import { useDebouncedRefresh } from "@/lib/use-debounced-refresh";
import { NUMERIC_DATA_TYPES, type FieldDefinition } from "@/lib/records/types";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import {
  evalConditional,
  hasConditional,
  scaleDomains,
} from "@/lib/widgets/conditional";
import { formatMoney, resolveFieldMoney } from "@/lib/widgets/currency";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { ENTITY_TYPE_OF } from "@/lib/widgets/entity-list";
import { bucketRecordDate } from "@/lib/widgets/date-buckets";
import { alignClass, groupByLevels, resolveAlign } from "@/lib/widgets/appearance";
import {
  buildGroupItems,
  dedupeFields,
  type GroupNode,
  type GroupOpts,
} from "@/lib/widgets/grouping";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  type DateFormat,
} from "@/lib/widgets/format";
import type {
  AppearanceSettings,
  ColorPair,
  RecordListColumn,
  TableAlign,
} from "@/lib/widgets/types";
import { updateEntityField } from "@/app/(app)/dashboards/actions";
import { ColorPopover, ContextMenu, ResizeHandle } from "../appearance-editing";

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
  dashboardId,
  onSaved,
}: {
  entityType: "responsible" | "operation";
  entityId: string;
  field: FieldDefinition;
  userRoles: string[];
  canEditValues: boolean;
  dateFormat: DateFormat;
  value: string;
  // Dashboard de origem — a action revalida SÓ ele (ver updateEntityField).
  dashboardId?: string;
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

  if (!editable) {
    // Entidades (responsável/operação) não têm moeda de registro; a moeda vem do
    // próprio campo (fixa p/ 'moeda'; fallback BRL quando 'calculado'-herdar).
    const fieldMoney = resolveFieldMoney(field, null);
    const display = fieldMoney.isMoney
      ? formatMoney(serverValue, fieldMoney.code)
      : field.data_type === "data"
        ? formatDateValue(serverValue, dateFormat)
        : serverValue;
    // Traço só para vazio/nulo — zero (0 numérico ou "0") exibe normalmente.
    return (
      <span className="block truncate">
        {display == null || display === "" ? "—" : display}
      </span>
    );
  }

  function commit(raw: string) {
    if (raw === savedRef.current) return;
    setValue(raw);
    setError(false);
    startTransition(async () => {
      const res = await updateEntityField(
        entityType,
        entityId,
        field.field_key,
        raw,
        dashboardId
      );
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
  dashboardId,
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
  // Dashboard de origem — repassado à action p/ revalidação cirúrgica.
  dashboardId?: string;
  canEdit?: boolean;
  onAppearanceChange?: (a: AppearanceSettings) => void;
}) {
  // Reconcile pós-edição debounced e fora da transition da célula (a action
  // updateEntityField já revalida só o dashboard; aqui evitamos re-render por
  // célula e o input travado até o recompute).
  const refresh = useDebouncedRefresh();
  const ap = appearance ?? {};
  const t = ap.table ?? {};
  const editable = canEdit && Boolean(onAppearanceChange);
  const change = onAppearanceChange ?? (() => {});
  const dashFmt = dateFormat ?? DEFAULT_DATE_FORMAT;
  const entityType = ENTITY_TYPE_OF[rowSource];

  // Formatação condicional (appearance.conditional): alvo = field da coluna
  // (custom:<key>); valor cru vem de r.values. Regra > coluna manual.
  const cond = ap.conditional;
  const condActive = hasConditional(cond);
  const condDomains = condActive
    ? scaleDomains(
        rows as unknown as Record<string, unknown>[],
        cond?.scales,
        (row, target) =>
          (row as unknown as EntityListRow).values[target.slice(7)]
      )
    : {};
  const condStyleOf = (field: string, raw: unknown) =>
    condActive
      ? evalConditional(cond, field, raw, { domain: condDomains[field] })
      : null;

  const [menu, setMenu] = useState<
    | { kind: "ctx"; x: number; y: number; column: string }
    | { kind: "color"; x: number; y: number; column: string }
    | null
  >(null);
  // Grupos EXPANDIDOS no "Agrupar por" (efêmero) — abre sempre recolhido.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
  // Cor e alinhamento por coluna (único escopo deste widget: 1 linha = entidade).
  const setColColor = (column: string, cp: ColorPair) => {
    const map = { ...(t.colColors ?? {}) };
    if (!cp.fill && !cp.text) delete map[column];
    else map[column] = cp;
    setTable({ colColors: map });
  };
  const setColAlign = (column: string, a: TableAlign | undefined) => {
    const map = { ...(t.colAlign ?? {}) };
    if (!a) delete map[column];
    else map[column] = a;
    setTable({ colAlign: map });
  };

  // --- Agrupar por: agrupa as entidades por uma ou mais colunas em seções
  // recolhíveis. Colunas de data com "Agrupar período" entram como níveis mais
  // externos; o "Agrupar por" explícito aninha dentro. Folhas = entidades
  // editáveis (mesmas células). ---
  const rawOf = (field: string, r: EntityListRow) => r.values[field.slice(7)];
  const isNumericCol = (field: string): boolean => {
    const dt = fieldByKey.get(field.slice(7))?.data_type;
    return dt ? NUMERIC_DATA_TYPES.includes(dt) : false;
  };
  const sumCol = (field: string, rs: EntityListRow[]): number => {
    let s = 0;
    for (const r of rs) {
      const n = Number(rawOf(field, r));
      if (Number.isFinite(n)) s += n;
    }
    return s;
  };
  // Exibição de um valor de coluna (cabeçalho do grupo) — honra transform de data,
  // máscara, moeda; senão texto.
  const colDisplay = (field: string, r: EntityListRow): string => {
    const f = fieldByKey.get(field.slice(7));
    const raw = rawOf(field, r);
    if (raw == null || raw === "") return "—";
    if (f?.data_type === "data") {
      const c = cols.find((col) => col.field === field);
      if (c?.transform) return bucketRecordDate(raw, c.transform, c.weekMode).label;
      return formatDateValue(raw, fmtOf(field));
    }
    if (f) {
      const m = resolveFieldMoney(f, null);
      if (m.isMoney) return formatMoney(raw, m.code);
    }
    return String(raw);
  };
  const dateSortKey = (field: string, r: EntityListRow): number => {
    const c = cols.find((col) => col.field === field);
    const raw = rawOf(field, r);
    if (c?.transform) return bucketRecordDate(raw, c.transform, c.weekMode).sort;
    const m = String(raw ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
  };
  const periodAggCols = cols.filter(
    (c) => c.transform && c.agg && c.agg !== "individual"
  );
  const groupLevels = dedupeFields([
    ...periodAggCols.map((c) => c.field),
    ...groupByLevels(t.groupBy),
  ]).filter((f) => cols.some((c) => c.field === f));
  const groupOpts: GroupOpts<EntityListRow> = {
    keyOf: (r, field) =>
      isDateCol(field) ? colDisplay(field, r) : String(rawOf(field, r) ?? ""),
    labelOf: (r, field) => colDisplay(field, r),
    sortKeyOf: (r, field) => dateSortKey(field, r),
    isExpanded: (k) => expanded.has(k),
  };
  type Item = GroupNode<EntityListRow> | { kind: "grand" };
  const displayItems: Item[] =
    groupLevels.length > 0
      ? [...buildGroupItems(rows, groupLevels, groupOpts), { kind: "grand" }]
      : rows.map((r) => ({ kind: "data", row: r }));

  const numFmt = (field: string, n: number): string => {
    const f = fieldByKey.get(field.slice(7));
    if (f) {
      const m = resolveFieldMoney(f, null);
      if (m.isMoney) return formatMoney(n, m.code);
    }
    return n.toLocaleString("pt-BR");
  };

  // Linha de dados = 1 entidade (com células editáveis).
  const renderDataRow = (r: EntityListRow) => {
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
        <TableCell
          className={cn(
            "relative align-top font-medium",
            alignClass(resolveAlign(t, { column: "__name", rowKey: r.id }))
          )}
          style={cellBorder(0)}
        >
          <span className={cellSpanClass}>{r.label}</span>
          {editable ? (
            <ResizeHandle axis="row" onResize={(hh) => setRowHeight(r.id, hh)} />
          ) : null}
        </TableCell>
        {cols.map((c, ci) => {
          const field = fieldByKey.get(c.field.slice(7));
          const raw = r.values[c.field.slice(7)];
          const cs = condStyleOf(c.field, raw);
          return (
            <TableCell
              key={c.field}
              className={cn(
                "align-top",
                !t.colWidths?.[c.field] && "max-w-[200px]",
                alignClass(
                  resolveAlign(t, { column: c.field, rowKey: r.id, numeric: isNumericCol(c.field) })
                )
              )}
              style={{
                background: cs?.fill ?? t.colColors?.[c.field]?.fill,
                color: cs?.text ?? t.colColors?.[c.field]?.text ?? t.bodyColor,
                ...(cs?.bold ? { fontWeight: 600 } : {}),
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
                  dashboardId={dashboardId}
                  onSaved={refresh}
                />
              ) : (
                <span className={cellSpanClass}>—</span>
              )}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };

  // Cabeçalho de grupo (recolhível) ou "Total geral": rótulo + contagem + soma das
  // colunas numéricas.
  const renderGroupRow = (
    keyId: string,
    label: string,
    rs: EntityListRow[],
    opts?: {
      collapsible?: boolean;
      isCollapsed?: boolean;
      onToggle?: () => void;
      level?: number;
    }
  ) => (
    <TableRow
      key={`__grp:${keyId}`}
      className={cn(rowBorder, "font-medium")}
      style={{
        background: t.headerBg ?? "var(--muted)",
        color: t.headerColor,
        ...(t.borderColor ? { borderColor: t.borderColor } : {}),
      }}
    >
      <TableCell
        className={alignClass(resolveAlign(t, { column: "__name" }))}
        style={cellBorder(0)}
      >
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1",
            opts?.collapsible ? "cursor-pointer" : "cursor-default"
          )}
          style={opts?.level ? { paddingLeft: opts.level * 16 } : undefined}
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
          <span className="text-muted-foreground ml-1 text-xs">({rs.length})</span>
        </button>
      </TableCell>
      {cols.map((c, ci) => (
        <TableCell
          key={c.field}
          className={cn(
            alignClass(
              resolveAlign(t, { column: c.field, numeric: isNumericCol(c.field) })
            ),
            isNumericCol(c.field) && "tabular-nums"
          )}
          style={cellBorder(ci + 1)}
        >
          {isNumericCol(c.field) ? numFmt(c.field, sumCol(c.field, rs)) : null}
        </TableCell>
      ))}
    </TableRow>
  );

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Nenhum registro para exibir.
      </div>
    );
  }

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
            <TableHead
              className={cn(
                "whitespace-nowrap",
                alignClass(resolveAlign(t, { column: "__name" }))
              )}
              style={cellBorder(0)}
            >
              Nome
            </TableHead>
            {cols.map((c, ci) => (
              <TableHead
                key={c.field}
                className={cn(
                  "group relative whitespace-nowrap",
                  alignClass(
                    resolveAlign(t, { column: c.field, numeric: isNumericCol(c.field) })
                  )
                )}
                onDoubleClick={
                  editable
                    ? (e) =>
                        setMenu({ kind: "ctx", x: e.clientX, y: e.clientY, column: c.field })
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
          {displayItems.map((item) =>
            item.kind === "data" ? (
              renderDataRow(item.row)
            ) : item.kind === "grand" ? (
              renderGroupRow("__grand", "Total geral", rows, { level: 0 })
            ) : (
              renderGroupRow(item.key, item.label, item.rows, {
                collapsible: true,
                isCollapsed: !expanded.has(item.key),
                onToggle: () => toggleExpand(item.key),
                level: item.level,
              })
            )
          )}
        </TableBody>
      </Table>

      {menu?.kind === "ctx" ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          coloring={{
            scopes: ["col"],
            onScope: () =>
              setMenu({ kind: "color", x: menu.x, y: menu.y, column: menu.column }),
          }}
          dateFormat={
            isDateCol(menu.column)
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
          title="Aparência da coluna"
          value={t.colColors?.[menu.column] ?? {}}
          onChange={(cp) => setColColor(menu.column, cp)}
          align={{
            value: t.colAlign?.[menu.column],
            onSelect: (a) => setColAlign(menu.column, a),
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
