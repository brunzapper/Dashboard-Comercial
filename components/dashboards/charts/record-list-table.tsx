// Versão: 2.0 | Data: 10/07/2026
// Widget de Tabela em modo "registros individuais". Uma linha por registro;
// colunas do núcleo read-only, colunas personalizadas editáveis via EditableCell.
// v2.0 (Fase 10.1): edição de aparência IN-LOCO (reordenar colunas/linhas por
// arraste, ordenar e colorir via duplo-clique) quando canEdit. Células editáveis
// mantêm o comportamento de edição (menu só no cabeçalho e em células não-editáveis).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EditableCell } from "@/components/registros/editable-cell";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import {
  applyManualOrder,
  distinctFills,
  reorderKeys,
} from "@/lib/widgets/appearance";
import type {
  AppearanceSettings,
  ColorPair,
  RecordListColumn,
} from "@/lib/widgets/types";
import {
  ColorOrderDialog,
  ColorPopover,
  ContextMenu,
  type ColorScope,
} from "../appearance-editing";

const FK_FIELDS = new Set(["responsible_id", "operation_id", "related_lead_id"]);
const MONEY_FIELDS = new Set(["value", "mrr"]);
const DATE_FIELDS = new Set(["closed_at", "opened_at", "source_created_at"]);

function money(v: unknown): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function coreDisplay(
  field: string,
  record: RecordRow,
  fkLabels: Record<string, string>
): string {
  const v = (record as unknown as Record<string, unknown>)[field];
  if (FK_FIELDS.has(field)) return v ? (fkLabels[String(v)] ?? "—") : "—";
  if (MONEY_FIELDS.has(field)) return money(v);
  if (field === "closed") return v ? "Sim" : "Não";
  if (DATE_FIELDS.has(field)) return v ? String(v).slice(0, 10) : "—";
  return v == null || v === "" ? "—" : String(v);
}

function rawValue(field: string, record: RecordRow): unknown {
  if (field.startsWith("custom:")) return record.custom_fields?.[field.slice(7)];
  return (record as unknown as Record<string, unknown>)[field];
}

type Menu =
  | { kind: "ctx"; x: number; y: number; column: string; rowKey?: string; scopes: ColorScope[] }
  | { kind: "color"; x: number; y: number; scope: ColorScope; column: string; rowKey?: string }
  | { kind: "colorOrder"; x: number; y: number; column: string };

export function RecordListTable({
  records,
  columns,
  fields,
  available,
  userRoles,
  canEditValues,
  fkLabels,
  appearance,
  canEdit = false,
  onAppearanceChange,
}: {
  records: RecordRow[];
  columns: RecordListColumn[];
  fields: FieldDefinition[];
  available: AvailableField[];
  userRoles: string[];
  canEditValues: boolean;
  fkLabels: Record<string, string>;
  appearance?: AppearanceSettings;
  canEdit?: boolean;
  onAppearanceChange?: (a: AppearanceSettings) => void;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const ap = appearance ?? {};
  const t = ap.table ?? {};
  const editable = canEdit && Boolean(onAppearanceChange);
  const change = onAppearanceChange ?? (() => {});

  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  const baseCols = columns.filter((c) => c.field);
  const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));
  const cols = applyManualOrder(baseCols, t.columnOrder, (c) => c.field);

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

  const gl = t.gridLines ?? "both";
  const vertical = gl === "vertical" || gl === "both";
  const horizontal = gl === "horizontal" || gl === "both";
  const rowBorder = horizontal ? "" : "border-b-0";
  const cellBorder = (last: boolean) =>
    vertical && !last
      ? { borderRight: `1px solid ${t.borderColor ?? "var(--border)"}` }
      : {};

  const setTable = (patch: Partial<NonNullable<AppearanceSettings["table"]>>) =>
    change({ ...ap, table: { ...t, ...patch } });

  function setColor(m: { scope: ColorScope; column: string; rowKey?: string }, cp: ColorPair) {
    const clear = !cp.fill && !cp.text;
    if (m.scope === "col") {
      const map = { ...(t.colColors ?? {}) };
      if (clear) delete map[m.column];
      else map[m.column] = cp;
      setTable({ colColors: map });
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
  function colorValue(m: { scope: ColorScope; column: string; rowKey?: string }): ColorPair {
    if (m.scope === "col") return t.colColors?.[m.column] ?? {};
    if (m.scope === "row" && m.rowKey) return t.rowColors?.[m.rowKey] ?? {};
    if (m.scope === "cell" && m.rowKey) return t.cellColors?.[`${m.rowKey}:${m.column}`] ?? {};
    return {};
  }

  if (cols.length === 0) {
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
            {editable ? <TableHead className="w-6 px-1" /> : null}
            {cols.map((c, ci) => (
              <TableHead
                key={c.field}
                className={cn("group whitespace-nowrap", editable && "cursor-move")}
                draggable={editable}
                onDragStart={editable ? () => setDragCol(c.field) : undefined}
                onDragOver={editable ? (e) => e.preventDefault() : undefined}
                onDrop={
                  editable
                    ? () => {
                        if (dragCol)
                          setTable({
                            columnOrder: reorderKeys(
                              cols.map((x) => x.field),
                              dragCol,
                              c.field
                            ),
                          });
                        setDragCol(null);
                      }
                    : undefined
                }
                onDoubleClick={
                  editable
                    ? (e) =>
                        setMenu({
                          kind: "ctx",
                          x: e.clientX,
                          y: e.clientY,
                          column: c.field,
                          scopes: ["col"],
                        })
                    : undefined
                }
                style={{
                  background: t.colColors?.[c.field]?.fill,
                  color: t.colColors?.[c.field]?.text ?? t.headerColor,
                  ...cellBorder(ci === cols.length - 1),
                }}
              >
                <span className="inline-flex items-center gap-1">
                  {editable ? (
                    <GripVertical className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                  ) : null}
                  {fieldLabel(c.field, available)}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const rowCp = t.rowColors?.[r.id];
            return (
              <TableRow
                key={r.id}
                className={rowBorder}
                style={{
                  background: rowCp?.fill ?? t.bodyBg,
                  color: rowCp?.text ?? t.bodyColor,
                  ...(t.borderColor ? { borderColor: t.borderColor } : {}),
                }}
              >
                {editable ? (
                  <TableCell
                    className="group w-6 cursor-move px-1"
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
                  </TableCell>
                ) : null}
                {cols.map((c, ci) => {
                  const isCustom = c.field.startsWith("custom:");
                  const field = isCustom ? fieldByKey.get(c.field.slice(7)) : undefined;
                  const isEditableCell = Boolean(isCustom && field && c.editable);
                  const cellCp = t.cellColors?.[`${r.id}:${c.field}`];
                  const colCp = t.colColors?.[c.field];
                  return (
                    <TableCell
                      key={c.field}
                      className="max-w-[200px] align-top"
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
                              })
                          : undefined
                      }
                      style={{
                        background: cellCp?.fill ?? colCp?.fill,
                        color: cellCp?.text ?? rowCp?.text ?? colCp?.text ?? t.bodyColor,
                        ...cellBorder(ci === cols.length - 1),
                      }}
                    >
                      {isEditableCell && field ? (
                        <EditableCell
                          record={r}
                          field={field}
                          userRoles={userRoles}
                          canEditValues={canEditValues}
                          onSaved={refresh}
                        />
                      ) : isCustom ? (
                        <span className="block truncate">
                          {field && r.custom_fields?.[field.field_key] != null
                            ? String(r.custom_fields[field.field_key])
                            : "—"}
                        </span>
                      ) : (
                        <span className="block truncate">
                          {coreDisplay(c.field, r, fkLabels)}
                        </span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {menu?.kind === "ctx" ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          ordering={{
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
          }}
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
              }),
          }}
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
