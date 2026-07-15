// Versão: 1.1 | Data: 15/07/2026
// Widget "Tabela rápida" (visual_type 'tabela_editavel'): planilha editável no
// dashboard. Renderiza a matriz de lib/widgets/quick-table/model.ts; células
// livres são digitáveis por qualquer visualizador (bloqueio por papel via
// editableRoles, validado também na server action saveQuickTableCells). UX de
// planilha: clique seleciona, digitar substitui, duplo-clique/Enter/F2 edita,
// setas navegam, Delete limpa, Esc cancela. Persistência otimista: override
// local + saveQuickTableCells + router.refresh() com debounce (a action não
// revalida, p/ digitação fluida — mesmo padrão do saveWidgetSettings).
// v1.1 (15/07/2026): edição de ESTRUTURA no modo Editar layout (dono/admin):
//   botões "+" de linha/coluna, painel de coluna (rótulo/tipo/papéis) e de
//   linha (excluir), redimensionar coluna/linha (appearance.colWidths/
//   rowHeights) e aparência por clique-direito (cor/alinhamento por
//   coluna/linha/célula, via ContextMenu/ColorPopover compartilhados).
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Plus, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AvailableField } from "@/lib/widgets/fields";
import type { DateFormat } from "@/lib/widgets/format";
import type {
  AppearanceSettings,
  ColorPair,
  QuickTableColumn,
  TableAlign,
  Widget,
} from "@/lib/widgets/types";
import { alignClass, resolveAlign } from "@/lib/widgets/appearance";
import {
  buildQuickTableMatrix,
  cellKey,
  newColId,
  newRowId,
  type QTCell,
  type QTCellValue,
  type QTMatrix,
} from "@/lib/widgets/quick-table/model";
import { saveQuickTableCells } from "@/app/(app)/dashboards/actions";
import {
  ColorPopover,
  ContextMenu,
  ResizeHandle,
  type ColorScope,
} from "../appearance-editing";
import { ColumnPanel, RowPanel, useQuickTableConfig } from "./column-panel";

// Posição de uma célula na GRADE RENDERIZADA (índices de exibição; as chaves
// estáveis ficam nas próprias células da matriz).
type Pos = { r: number; c: number };

// Menus/painéis flutuantes abertos por gesto (um por vez).
type Menu =
  | { kind: "ctx"; x: number; y: number; column: string; rowKey?: string; scopes: ColorScope[] }
  | { kind: "color"; x: number; y: number; scope: ColorScope; column: string; rowKey?: string }
  | { kind: "colPanel"; x: number; y: number; colId: string }
  | { kind: "rowPanel"; x: number; y: number; rowId: string };

export function QuickTableWidget({
  widget,
  dashboardId,
  cells,
  userRoles,
  available,
  dateFormat,
  canEdit = false,
  editMode = false,
  appearance,
  onAppearanceChange,
}: {
  widget: Widget;
  dashboardId: string;
  // Valores digitados (dashboard_table_cells do widget), vindos do RSC.
  cells: QTCellValue[];
  userRoles: string[];
  available: AvailableField[];
  dateFormat?: DateFormat;
  canEdit?: boolean; // dono/admin: edita a ESTRUTURA (colunas/linhas/aparência)
  editMode?: boolean; // modo "Editar layout" do dashboard
  appearance?: AppearanceSettings;
  onAppearanceChange?: (a: AppearanceSettings) => void;
}) {
  const router = useRouter();
  // Estrutura otimista (colunas/linhas) — gravação debounced em settings.
  const { qt, save: saveConfig } = useQuickTableConfig(widget, dashboardId);
  // Edição de estrutura/aparência: dono/admin com "Editar layout" ativo.
  const structureEdit = canEdit && editMode && Boolean(onAppearanceChange);

  // ---- valores otimistas ----
  // Overrides locais por chave de célula ("rowKey:colKey"); null = apagada.
  // Ressincroniza quando a prop do servidor muda (padrão seedKey), descartando
  // só os overrides que o servidor já alcançou.
  const serverKey = useMemo(() => JSON.stringify(cells), [cells]);
  const [seedKey, setSeedKey] = useState(serverKey);
  const [overrides, setOverrides] = useState<Map<string, string | null>>(
    () => new Map()
  );
  if (seedKey !== serverKey) {
    setSeedKey(serverKey);
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      const server = new Map(
        cells.map((c) => [cellKey(c.row_key, c.col_key), String(c.value ?? "")])
      );
      const next = new Map(prev);
      for (const [k, v] of prev) {
        const sv = server.get(k) ?? null;
        if ((v ?? "") === (sv ?? "")) next.delete(k);
      }
      return next;
    });
  }

  const effectiveCells = useMemo<QTCellValue[]>(() => {
    if (overrides.size === 0) return cells;
    const out = new Map(
      cells.map((c) => [cellKey(c.row_key, c.col_key), c] as const)
    );
    for (const [k, v] of overrides) {
      const i = k.lastIndexOf(":");
      const row_key = k.slice(0, i);
      const col_key = k.slice(i + 1);
      if (v == null || v === "") out.delete(k);
      else out.set(k, { row_key, col_key, value: v });
    }
    return [...out.values()];
  }, [cells, overrides]);

  // ---- matriz renderizada ----
  const matrix: QTMatrix = useMemo(
    () =>
      buildQuickTableMatrix({
        qt,
        cells: effectiveCells,
        data: null, // modo BI chega no carregamento deferido (runQuickTable)
        userRoles,
        available,
        tableAp: appearance?.table,
        dateFormat,
      }),
    [qt, effectiveCells, userRoles, available, appearance?.table, dateFormat]
  );

  // ---- persistência de células ----
  // refresh() debounced: reconcilia com o servidor (e alimenta o histórico de
  // Desfazer/Refazer) sem recomputar o dashboard a cada tecla.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 800);
  }, [router]);

  const saveCells = useCallback(
    (batch: { rowKey: string; colKey: string; value: string | null }[]) => {
      if (batch.length === 0) return;
      setOverrides((prev) => {
        const next = new Map(prev);
        for (const b of batch) next.set(cellKey(b.rowKey, b.colKey), b.value);
        return next;
      });
      void saveQuickTableCells(dashboardId, widget.id, batch).then((res) => {
        if (!res.ok) {
          // Falhou (ex.: coluna bloqueada) — desfaz o otimista e ressincroniza.
          setOverrides((prev) => {
            const next = new Map(prev);
            for (const b of batch) next.delete(cellKey(b.rowKey, b.colKey));
            return next;
          });
        }
        scheduleRefresh();
      });
    },
    [dashboardId, widget.id, scheduleRefresh]
  );

  // ---- estrutura (colunas/linhas) ----
  const [menu, setMenu] = useState<Menu | null>(null);

  const addColumn = () =>
    saveConfig({
      ...qt,
      columns: [...qt.columns, { id: newColId(), kind: "free" }],
    });
  const addRow = () =>
    saveConfig({ ...qt, rows: [...qt.rows, { id: newRowId() }] });
  const patchColumn = (colId: string, patch: Partial<QuickTableColumn>) => {
    let columns = qt.columns.map((c) =>
      c.id === colId ? { ...c, ...patch } : c
    );
    // No máximo UMA dimensão pivot: ligar aqui desliga nas demais.
    if (patch.pivot === true) {
      columns = columns.map((c) =>
        c.id === colId ? c : c.pivot ? { ...c, pivot: undefined } : c
      );
    }
    saveConfig({ ...qt, columns });
  };
  const deleteColumn = (colId: string) => {
    // Chaves de aparência/células da coluna ficam órfãs de propósito (ids
    // nunca são reusados); limpar exigiria acoplar dois gravadores debounced.
    saveConfig({ ...qt, columns: qt.columns.filter((c) => c.id !== colId) });
    setMenu(null);
  };
  const deleteRow = (rowId: string) => {
    saveConfig({ ...qt, rows: qt.rows.filter((r) => r.id !== rowId) });
    setMenu(null);
  };

  // ---- aparência (cores/alinhamento/tamanhos) ----
  const t = appearance?.table ?? {};
  const changeAp = (patch: Partial<NonNullable<AppearanceSettings["table"]>>) =>
    onAppearanceChange?.({
      ...(appearance ?? {}),
      table: { ...t, ...patch },
    });

  function setColor(
    m: { scope: ColorScope; column: string; rowKey?: string },
    cp: ColorPair
  ) {
    const clear = !cp.fill && !cp.text;
    if (m.scope === "col") {
      const map = { ...(t.colColors ?? {}) };
      if (clear) delete map[m.column];
      else map[m.column] = cp;
      changeAp({ colColors: map });
    } else if (m.scope === "row" && m.rowKey) {
      const map = { ...(t.rowColors ?? {}) };
      if (clear) delete map[m.rowKey];
      else map[m.rowKey] = cp;
      changeAp({ rowColors: map });
    } else if (m.scope === "cell" && m.rowKey) {
      const map = { ...(t.cellColors ?? {}) };
      const k = `${m.rowKey}:${m.column}`;
      if (clear) delete map[k];
      else map[k] = cp;
      changeAp({ cellColors: map });
    }
  }
  function colorValue(m: {
    scope: ColorScope;
    column: string;
    rowKey?: string;
  }): ColorPair {
    if (m.scope === "col") return t.colColors?.[m.column] ?? {};
    if (m.scope === "row" && m.rowKey) return t.rowColors?.[m.rowKey] ?? {};
    if (m.scope === "cell" && m.rowKey)
      return t.cellColors?.[`${m.rowKey}:${m.column}`] ?? {};
    return {};
  }
  function setAlign(
    m: { scope: ColorScope; column: string; rowKey?: string },
    a: TableAlign | undefined
  ) {
    if (m.scope === "col") {
      const map = { ...(t.colAlign ?? {}) };
      if (!a) delete map[m.column];
      else map[m.column] = a;
      changeAp({ colAlign: map });
    } else if (m.scope === "row" && m.rowKey) {
      const map = { ...(t.rowAlign ?? {}) };
      if (!a) delete map[m.rowKey];
      else map[m.rowKey] = a;
      changeAp({ rowAlign: map });
    } else if (m.scope === "cell" && m.rowKey) {
      const map = { ...(t.cellAlign ?? {}) };
      const k = `${m.rowKey}:${m.column}`;
      if (!a) delete map[k];
      else map[k] = a;
      changeAp({ cellAlign: map });
    }
  }
  function alignValue(m: {
    scope: ColorScope;
    column: string;
    rowKey?: string;
  }): TableAlign | undefined {
    if (m.scope === "col") return t.colAlign?.[m.column];
    if (m.scope === "row" && m.rowKey) return t.rowAlign?.[m.rowKey];
    if (m.scope === "cell" && m.rowKey)
      return t.cellAlign?.[`${m.rowKey}:${m.column}`];
    return undefined;
  }
  const setColWidth = (colKey: string, w: number) =>
    changeAp({ colWidths: { ...(t.colWidths ?? {}), [colKey]: w } });
  const setRowHeight = (rowKey: string, h: number) =>
    changeAp({ rowHeights: { ...(t.rowHeights ?? {}), [rowKey]: h } });

  // ---- seleção e edição (UX de planilha) ----
  const [sel, setSel] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<{ pos: Pos; draft: string } | null>(
    null
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  const cellAt = (p: Pos): QTCell | undefined => matrix.rows[p.r]?.cells[p.c];

  const startEdit = useCallback(
    (p: Pos, initial?: string) => {
      const cell = matrix.rows[p.r]?.cells[p.c];
      if (!cell?.editable) return;
      setSel(p);
      setEditing({ pos: p, draft: initial ?? (cell.raw ?? "") });
    },
    [matrix]
  );

  const commitEdit = useCallback(
    (move?: "down" | "right") => {
      setEditing((cur) => {
        if (!cur) return null;
        const cell = matrix.rows[cur.pos.r]?.cells[cur.pos.c];
        if (cell && (cell.raw ?? "") !== cur.draft) {
          saveCells([
            {
              rowKey: cell.rowKey,
              colKey: cell.colKey,
              value: cur.draft.trim() === "" ? null : cur.draft,
            },
          ]);
        }
        if (move) {
          setSel((s) => {
            if (!s) return s;
            const r = move === "down" ? s.r + 1 : s.r;
            const c = move === "right" ? s.c + 1 : s.c;
            if (r < matrix.rows.length && c < matrix.cols.length) return { r, c };
            return s;
          });
        }
        return null;
      });
      containerRef.current?.focus();
    },
    [matrix, saveCells]
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    containerRef.current?.focus();
  }, []);

  // Teclado no container (fora da edição): navegação/atalhos de planilha.
  function onKeyDown(e: React.KeyboardEvent) {
    if (editing) return; // o input cuida do próprio teclado
    if (!sel) return;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      setSel((s) => {
        if (!s) return s;
        const r = Math.min(Math.max(0, s.r + dr), matrix.rows.length - 1);
        const c = Math.min(Math.max(0, s.c + dc), matrix.cols.length - 1);
        return { r, c };
      });
    };
    switch (e.key) {
      case "ArrowUp":
        return move(-1, 0);
      case "ArrowDown":
        return move(1, 0);
      case "ArrowLeft":
        return move(0, -1);
      case "ArrowRight":
        return move(0, 1);
      case "Tab":
        return move(0, e.shiftKey ? -1 : 1);
      case "Enter":
      case "F2": {
        e.preventDefault();
        startEdit(sel);
        return;
      }
      case "Escape":
        setSel(null);
        return;
      case "Delete":
      case "Backspace": {
        const cell = cellAt(sel);
        if (cell?.editable && cell.raw != null) {
          e.preventDefault();
          saveCells([{ rowKey: cell.rowKey, colKey: cell.colKey, value: null }]);
        }
        return;
      }
      default: {
        // Digitar um caractere imprimível substitui o conteúdo (como planilha).
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const cell = cellAt(sel);
          if (cell?.editable) {
            e.preventDefault();
            startEdit(sel, e.key);
          }
        }
      }
    }
  }

  // ---- estilos derivados da aparência ----
  const gl = t.gridLines ?? "both";
  const vertical = gl === "vertical" || gl === "both";
  const horizontal = gl === "horizontal" || gl === "both";
  const borderColor = t.borderColor ?? "var(--border)";
  const cellBorder = (last: boolean): React.CSSProperties => ({
    ...(vertical && !last ? { borderRight: `1px solid ${borderColor}` } : {}),
    ...(horizontal ? { borderBottom: `1px solid ${borderColor}` } : {}),
  });
  const widthStyle = (colKey: string): React.CSSProperties => {
    const w = t.colWidths?.[colKey];
    return w ? { width: w, minWidth: w, maxWidth: w } : { minWidth: 88 };
  };
  const cellPair = (rowKey: string, colKey: string): ColorPair => ({
    fill:
      t.cellColors?.[`${rowKey}:${colKey}`]?.fill ??
      t.rowColors?.[rowKey]?.fill ??
      t.colColors?.[colKey]?.fill,
    text:
      t.cellColors?.[`${rowKey}:${colKey}`]?.text ??
      t.rowColors?.[rowKey]?.text ??
      t.colColors?.[colKey]?.text ??
      t.bodyColor,
  });
  const cellText = t.cellText ?? "clip";
  const spanClass =
    cellText === "wrap" ? "block whitespace-normal break-words" : "block truncate";

  if (!qt || qt.columns.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Tabela sem colunas.{" "}
        {structureEdit ? (
          <Plus
            className="mx-1 inline size-4 cursor-pointer"
            onClick={addColumn}
            aria-label="Adicionar coluna"
          />
        ) : (
          "Ative Editar layout para montá-la."
        )}
      </div>
    );
  }

  // Total de colunas do DOM (gutter + dados + coluna do "+").
  const domCols =
    matrix.cols.length + (structureEdit ? 2 : 0);

  return (
    <div className="h-full overflow-auto [scrollbar-gutter:stable]">
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="outline-none"
        role="grid"
        aria-label={widget.title ?? "Tabela rápida"}
      >
        <table
          className="w-full border-collapse text-sm"
          style={{ background: t.bodyBg }}
        >
          {matrix.headerRow || structureEdit ? (
            <thead>
              <tr
                style={{
                  background: t.headerBg ?? "var(--muted)",
                  color: t.headerColor,
                }}
              >
                {structureEdit ? <th className="w-6 px-0.5" /> : null}
                {matrix.cols.map((col, ci) => (
                  <th
                    key={col.key}
                    className={cn(
                      "group relative h-8 px-2 py-1 text-xs font-medium select-none",
                      alignClass(
                        resolveAlign(t, { column: col.key, numeric: col.numeric })
                      )
                    )}
                    style={{
                      ...cellBorder(ci === matrix.cols.length - 1 && !structureEdit),
                      ...widthStyle(col.key),
                      ...(t.colColors?.[col.key]?.fill
                        ? { background: t.colColors[col.key].fill }
                        : {}),
                      ...(t.colColors?.[col.key]?.text
                        ? { color: t.colColors[col.key].text }
                        : {}),
                    }}
                    onDoubleClick={
                      structureEdit
                        ? (e) =>
                            setMenu({
                              kind: "colPanel",
                              x: e.clientX,
                              y: e.clientY,
                              colId: col.column.id,
                            })
                        : undefined
                    }
                    onContextMenu={
                      structureEdit
                        ? (e) => {
                            e.preventDefault();
                            setMenu({
                              kind: "ctx",
                              x: e.clientX,
                              y: e.clientY,
                              column: col.key,
                              scopes: ["col"],
                            });
                          }
                        : undefined
                    }
                  >
                    <span className="flex items-center gap-1">
                      <span className="block flex-1 truncate">
                        {col.label || " "}
                      </span>
                      {structureEdit ? (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                          title="Configurar coluna"
                          aria-label="Configurar coluna"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenu({
                              kind: "colPanel",
                              x: e.clientX,
                              y: e.clientY,
                              colId: col.column.id,
                            });
                          }}
                        >
                          <Settings2 className="size-3.5" />
                        </button>
                      ) : null}
                    </span>
                    {structureEdit ? (
                      <ResizeHandle
                        axis="col"
                        onResize={(w) => setColWidth(col.key, w)}
                      />
                    ) : null}
                  </th>
                ))}
                {structureEdit ? (
                  <th className="w-8 px-0.5">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 items-center justify-center rounded"
                      title="Adicionar coluna"
                      aria-label="Adicionar coluna"
                      onClick={addColumn}
                    >
                      <Plus className="size-4" />
                    </button>
                  </th>
                ) : null}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {matrix.rows.map((row, ri) => {
              const h = t.rowHeights?.[row.key];
              return (
                <tr
                  key={row.key}
                  style={{
                    height: h,
                    background: t.rowColors?.[row.key]?.fill,
                  }}
                >
                  {structureEdit ? (
                    <td
                      className="group relative w-6 px-0.5"
                      style={cellBorder(false)}
                    >
                      {row.kind === "free" ? (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
                          title="Opções da linha"
                          aria-label="Opções da linha"
                          onClick={(e) =>
                            setMenu({
                              kind: "rowPanel",
                              x: e.clientX,
                              y: e.clientY,
                              rowId: row.key,
                            })
                          }
                        >
                          <Settings2 className="size-3.5" />
                        </button>
                      ) : null}
                      <ResizeHandle
                        axis="row"
                        minSize={24}
                        onResize={(hh) => setRowHeight(row.key, hh)}
                      />
                    </td>
                  ) : null}
                  {row.cells.map((cell, ci) => {
                    const isSel = sel?.r === ri && sel?.c === ci;
                    const isEditing =
                      editing?.pos.r === ri && editing?.pos.c === ci;
                    // Coluna livre em que ESTE usuário não pode digitar
                    // (bloqueio por papel) — read-only com dica.
                    const locked =
                      matrix.cols[ci]?.column.kind === "free" &&
                      !cell.editable;
                    const pair = cellPair(row.key, cell.colKey);
                    const align = alignClass(
                      resolveAlign(t, {
                        column: cell.colKey,
                        rowKey: row.key,
                        numeric: cell.numeric,
                      })
                    );
                    return (
                      <td
                        key={cell.colKey}
                        data-r={ri}
                        data-c={ci}
                        title={
                          locked
                            ? "Coluna bloqueada para o seu papel"
                            : undefined
                        }
                        className={cn(
                          "relative h-8 px-2 py-1 align-middle",
                          align,
                          cell.numeric && "tabular-nums",
                          cell.editable && "cursor-cell",
                          locked && "cursor-not-allowed opacity-80",
                          isSel &&
                            "ring-primary/70 z-10 rounded-[2px] ring-2 ring-inset"
                        )}
                        style={{
                          background: pair.fill,
                          color: pair.text,
                          ...cellBorder(
                            ci === row.cells.length - 1 && !structureEdit
                          ),
                          ...widthStyle(cell.colKey),
                          height: h,
                          ...(cellText === "clip" ? { overflow: "hidden" } : {}),
                        }}
                        onPointerDown={(e) => {
                          // Seleciona sem roubar o foco do input em edição.
                          if (isEditing) return;
                          e.preventDefault();
                          if (editing) commitEdit();
                          setSel({ r: ri, c: ci });
                          containerRef.current?.focus();
                        }}
                        onDoubleClick={() => {
                          if (cell.editable) startEdit({ r: ri, c: ci });
                        }}
                        onContextMenu={
                          structureEdit
                            ? (e) => {
                                e.preventDefault();
                                setMenu({
                                  kind: "ctx",
                                  x: e.clientX,
                                  y: e.clientY,
                                  column: cell.colKey,
                                  rowKey: row.key,
                                  scopes: ["row", "col", "cell"],
                                });
                              }
                            : undefined
                        }
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editing.draft}
                            onChange={(e) =>
                              setEditing((cur) =>
                                cur ? { ...cur, draft: e.target.value } : cur
                              )
                            }
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit("down");
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                commitEdit("right");
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                            className={cn(
                              "absolute inset-0 size-full border-none bg-transparent px-2 py-1 text-sm outline-none",
                              align
                            )}
                            aria-label="Editar célula"
                          />
                        ) : (
                          <span className={spanClass}>
                            {cell.display || " "}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {structureEdit ? <td className="w-8 px-0.5" /> : null}
                </tr>
              );
            })}
            {structureEdit ? (
              <tr>
                <td colSpan={domCols} className="px-0.5 py-0.5">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-6 w-full items-center justify-center gap-1 rounded text-xs"
                    title="Adicionar linha"
                    aria-label="Adicionar linha"
                    onClick={addRow}
                  >
                    <Plus className="size-4" /> linha
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ---- menus/painéis flutuantes ---- */}
      {menu?.kind === "ctx" ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
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
            menu.scope === "col"
              ? "Cor da coluna"
              : menu.scope === "row"
                ? "Cor da linha"
                : "Cor da célula"
          }
          value={colorValue(menu)}
          onChange={(cp) => setColor(menu, cp)}
          onClose={() => setMenu(null)}
          align={{
            value: alignValue(menu),
            onSelect: (a) => setAlign(menu, a),
          }}
        />
      ) : null}
      {menu?.kind === "colPanel"
        ? (() => {
            const col = qt.columns.find((c) => c.id === menu.colId);
            if (!col) return null;
            return (
              <ColumnPanel
                x={menu.x}
                y={menu.y}
                column={col}
                available={available}
                onChange={(patch) => patchColumn(col.id, patch)}
                onDelete={() => deleteColumn(col.id)}
                onClose={() => setMenu(null)}
              />
            );
          })()
        : null}
      {menu?.kind === "rowPanel" ? (
        <RowPanel
          x={menu.x}
          y={menu.y}
          onDelete={() => deleteRow(menu.rowId)}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
