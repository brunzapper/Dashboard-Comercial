// Versão: 1.0 | Data: 15/07/2026
// Widget "Tabela rápida" (visual_type 'tabela_editavel'): planilha editável no
// dashboard. Renderiza a matriz de lib/widgets/quick-table/model.ts; células
// livres são digitáveis por qualquer visualizador (bloqueio por papel via
// editableRoles, validado também na server action saveQuickTableCells). UX de
// planilha: clique seleciona, digitar substitui, duplo-clique/Enter/F2 edita,
// setas navegam, Delete limpa, Esc cancela. Persistência otimista: override
// local + saveQuickTableCells + router.refresh() com debounce (a action não
// revalida, p/ digitação fluida — mesmo padrão do saveWidgetSettings).
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import type { AvailableField } from "@/lib/widgets/fields";
import type { DateFormat } from "@/lib/widgets/format";
import type {
  AppearanceSettings,
  ColorPair,
  Widget,
} from "@/lib/widgets/types";
import { alignClass, resolveAlign } from "@/lib/widgets/appearance";
import {
  buildQuickTableMatrix,
  cellKey,
  type QTCell,
  type QTCellValue,
  type QTMatrix,
} from "@/lib/widgets/quick-table/model";
import { saveQuickTableCells } from "@/app/(app)/dashboards/actions";

// Posição de uma célula na GRADE RENDERIZADA (índices de exibição; as chaves
// estáveis ficam nas próprias células da matriz).
type Pos = { r: number; c: number };

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
  const qt = widget.settings?.quickTable;

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
        qt: qt ?? { columns: [], rows: [] },
        cells: effectiveCells,
        data: null, // modo BI chega no carregamento deferido (runQuickTable)
        userRoles,
        available,
        tableAp: appearance?.table,
        dateFormat,
      }),
    [qt, effectiveCells, userRoles, available, appearance?.table, dateFormat]
  );

  // ---- persistência ----
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

  // ---- seleção e edição (UX de planilha) ----
  const [sel, setSel] = useState<Pos | null>(null);
  const [editing, setEditing] = useState<
    | { pos: Pos; draft: string }
    | null
  >(null);
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

  // ---- aparência ----
  const t = appearance?.table ?? {};
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

  void canEdit;
  void editMode;
  void onAppearanceChange;

  if (!qt) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Tabela sem estrutura configurada. Edite o widget.
      </div>
    );
  }

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
          {matrix.headerRow ? (
            <thead>
              <tr
                style={{
                  background: t.headerBg ?? "var(--muted)",
                  color: t.headerColor,
                }}
              >
                {matrix.cols.map((col, ci) => (
                  <th
                    key={col.key}
                    className={cn(
                      "h-8 px-2 py-1 text-xs font-medium select-none",
                      alignClass(
                        resolveAlign(t, { column: col.key, numeric: col.numeric })
                      )
                    )}
                    style={{
                      ...cellBorder(ci === matrix.cols.length - 1),
                      ...widthStyle(col.key),
                      ...(t.colColors?.[col.key]?.fill
                        ? { background: t.colColors[col.key].fill }
                        : {}),
                      ...(t.colColors?.[col.key]?.text
                        ? { color: t.colColors[col.key].text }
                        : {}),
                    }}
                  >
                    <span className="block truncate">{col.label || " "}</span>
                  </th>
                ))}
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
                  {row.cells.map((cell, ci) => {
                    const isSel = sel?.r === ri && sel?.c === ci;
                    const isEditing =
                      editing?.pos.r === ri && editing?.pos.c === ci;
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
                        className={cn(
                          "relative h-8 px-2 py-1 align-middle",
                          align,
                          cell.numeric && "tabular-nums",
                          cell.editable && "cursor-cell",
                          isSel &&
                            "ring-primary/70 z-10 rounded-[2px] ring-2 ring-inset"
                        )}
                        style={{
                          background: pair.fill,
                          color: pair.text,
                          ...cellBorder(ci === row.cells.length - 1),
                          ...widthStyle(cell.colKey),
                          height: h,
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
                          <span className="block truncate">
                            {cell.display || " "}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
