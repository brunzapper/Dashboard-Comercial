// Versão: 1.1 | Data: 15/07/2026
// Widget "Tabela Livre" (visual_type 'tabela_editavel'): planilha editável no
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
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Eraser, Loader2, Palette, Plus, Settings2 } from "lucide-react";

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
  classifyCellRaw,
  newColId,
  newRowId,
  quickTableBI,
  type QTCell,
  type QTCellValue,
  type QTMatrix,
} from "@/lib/widgets/quick-table/model";
import {
  colLetter,
  computeCellFormulas,
  formatFormulaResult,
  type CellFormulaOutput,
} from "@/lib/widgets/quick-table/cell-formulas";
import { saveQuickTableCells } from "@/app/(app)/dashboards/actions";
import {
  runQuickTable,
  type QuickTableResult,
} from "@/app/(app)/dashboards/quick-table-actions";
import {
  ColorPopover,
  ContextMenu,
  ResizeHandle,
  type ColorScope,
} from "../appearance-editing";
import { ColumnPanel, RowPanel, useQuickTableConfig } from "./column-panel";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";

// Posição de uma célula na GRADE RENDERIZADA (índices de exibição; as chaves
// estáveis ficam nas próprias células da matriz).
type Pos = { r: number; c: number };
// Seleção retangular: âncora (onde o gesto começou) e cabeça (onde está). Uma
// célula só = anchor === head.
type Sel = { anchor: Pos; head: Pos };

// Menus/painéis flutuantes abertos por gesto (um por vez).
type Menu =
  | { kind: "ctx"; x: number; y: number; column: string; rowKey?: string; scopes: ColorScope[] }
  | { kind: "color"; x: number; y: number; scope: ColorScope; column: string; rowKey?: string }
  | { kind: "colPanel"; x: number; y: number; colId: string }
  | { kind: "rowPanel"; x: number; y: number; rowId: string }
  // Aparência em LOTE da seleção retangular (cor/alinhamento por célula).
  | { kind: "batchColor"; x: number; y: number };

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
  // Modo snapshot (viewer público): dados BI chegam precomputados do servidor
  // da página (runQuickTable exige sessão) e TODAS as células ficam
  // somente-leitura (na app autenticada, células livres são digitáveis por
  // qualquer visualizador — isso não vale num link público).
  const snapshotMode = useSnapshotMode();
  const readOnly = snapshotMode.snapshot;
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

  // ---- computação deferida (dados BI + expressões {=…}) ----
  // A page NÃO computa nada desta tabela: o widget busca via runQuickTable
  // depois do mount ("carrega por último"). Refaz quando a config BI, as
  // expressões digitadas ou os parâmetros de URL (período/filtros) mudam;
  // enquanto refaz, mantém os dados anteriores (stale-while-refetch).
  const bi = useMemo(() => quickTableBI(qt), [qt]);
  const biKey = useMemo(
    () =>
      JSON.stringify(
        qt.columns.map((c) => [
          c.kind,
          c.field,
          c.transform,
          c.weekMode,
          c.metric?.field,
          c.metric?.agg,
          c.pivot === true,
        ])
      ),
    [qt.columns]
  );
  const exprKey = useMemo(
    () =>
      JSON.stringify(
        effectiveCells
          .filter(
            (c) => classifyCellRaw(String(c.value ?? "")) === "expr"
          )
          .map((c) => [c.row_key, c.col_key, c.value])
          .sort()
      ),
    [effectiveCells]
  );
  const search = useSearchParams().toString();
  const needsServer = bi.hasBI || exprKey !== "[]";
  const [fetched, setFetched] = useState<QuickTableResult | null>(null);
  useEffect(() => {
    // Modo snapshot: sem sessão a action falharia; o resultado vem
    // precomputado pela page pública (snapshotMode.quickTableResults).
    if (!needsServer || readOnly) return;
    let cancelled = false;
    // Pequeno atraso coalesce mudanças rápidas (digitação de {=…}, painel).
    const timer = setTimeout(() => {
      void runQuickTable(dashboardId, widget.id, search).then((res) => {
        if (!cancelled) setFetched(res);
      });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // biKey/exprKey resumem a config/expressões — são as deps reais.
  }, [needsServer, readOnly, biKey, exprKey, search, dashboardId, widget.id]);
  const deferred = readOnly
    ? (snapshotMode.quickTableResults?.[widget.id] ?? null)
    : fetched;

  // ---- matriz renderizada ----
  const matrix: QTMatrix = useMemo(() => {
    const m = buildQuickTableMatrix({
      qt,
      cells: effectiveCells,
      // undefined = BI carregando (skeleton); null = sem colunas BI.
      data: bi.hasBI ? (deferred ? deferred.data : undefined) : null,
      exprValues: deferred?.exprValues,
      userRoles,
      available,
      tableAp: appearance?.table,
      dateFormat,
    });
    // Snapshot: nenhuma célula é digitável, independentemente de editableRoles
    // (ausente = "todos os visualizadores" — não vale para um link público).
    if (!readOnly) return m;
    return {
      ...m,
      rows: m.rows.map((r) => ({
        ...r,
        cells: r.cells.map((c) => (c.editable ? { ...c, editable: false } : c)),
      })),
    };
  }, [
    qt,
    effectiveCells,
    bi.hasBI,
    deferred,
    userRoles,
    available,
    appearance?.table,
    dateFormat,
    readOnly,
  ]);

  // ---- fórmulas de célula ("=…", avaliadas no cliente) ----
  // Refs A1 posicionais sobre a grade renderizada; valores-base vêm de
  // QTCell.value ({=…} entra pelo valor resolvido — a fórmula nunca lê o
  // banco). Ciclos viram "#CICLO!"; erro de sintaxe vira mensagem na célula.
  const formulaCalc: CellFormulaOutput = useMemo(() => {
    const formulas = new Map<string, string>();
    const grid: (string | null)[][] = [];
    const cellMap = new Map<string, QTCell>();
    matrix.rows.forEach((row, r) => {
      grid[r] = [];
      row.cells.forEach((cell, c) => {
        const k = cellKey(row.key, cell.colKey);
        grid[r][c] = k;
        cellMap.set(k, cell);
        if (cell.content === "formula" && cell.raw) formulas.set(k, cell.raw);
      });
    });
    if (formulas.size === 0) {
      return { values: new Map(), errors: new Map() };
    }
    return computeCellFormulas({
      formulas,
      keyAt: (c, r) => grid[r]?.[c] ?? null,
      baseValue: (k) => {
        const cell = cellMap.get(k);
        if (!cell) return null;
        const v = cell.value;
        // Texto digitado com cara de número (aceita vírgula decimal) entra
        // como número nas fórmulas.
        if (typeof v === "string") {
          const s = v.trim();
          if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(",", "."));
        }
        return v;
      },
      dims: { rows: matrix.rows.length, cols: matrix.cols.length },
    });
  }, [matrix]);

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
      // readOnly (snapshot): nenhuma célula é editável, mas a guarda dupla
      // garante que nada tenta gravar mesmo se um caminho novo surgir.
      if (batch.length === 0 || readOnly) return;
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
    [dashboardId, widget.id, scheduleRefresh, readOnly]
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

  // Aparência em LOTE: aplica cor/alinhamento a TODAS as células da seleção
  // num único patch (um save, um refresh).
  function setBatchColor(cp: ColorPair) {
    const clear = !cp.fill && !cp.text;
    const map = { ...(t.cellColors ?? {}) };
    for (const cell of rectCells()) {
      const k = `${cell.rowKey}:${cell.colKey}`;
      if (clear) delete map[k];
      else map[k] = cp;
    }
    changeAp({ cellColors: map });
  }
  function setBatchAlign(a: TableAlign | undefined) {
    const map = { ...(t.cellAlign ?? {}) };
    for (const cell of rectCells()) {
      const k = `${cell.rowKey}:${cell.colKey}`;
      if (!a) delete map[k];
      else map[k] = a;
    }
    changeAp({ cellAlign: map });
  }

  // ---- seleção e edição (UX de planilha) ----
  const [sel, setSel] = useState<Sel | null>(null);
  const [editing, setEditing] = useState<{ pos: Pos; draft: string } | null>(
    null
  );
  // Mini-toolbar de aparência em lote: aparece ao SOLTAR um arrasto de seleção
  // multi-célula (posição do ponteiro no fim do gesto).
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number } | null>(
    null
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragSelAbort = useRef<AbortController | null>(null);
  useEffect(() => () => dragSelAbort.current?.abort(), []);

  const cellAt = (p: Pos): QTCell | undefined => matrix.rows[p.r]?.cells[p.c];

  // Retângulo normalizado da seleção (índices de exibição, inclusivos).
  const rect = sel
    ? {
        r0: Math.min(sel.anchor.r, sel.head.r),
        r1: Math.max(sel.anchor.r, sel.head.r),
        c0: Math.min(sel.anchor.c, sel.head.c),
        c1: Math.max(sel.anchor.c, sel.head.c),
      }
    : null;
  const inRect = (r: number, c: number) =>
    rect != null && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;
  const multiSel =
    rect != null && (rect.r0 !== rect.r1 || rect.c0 !== rect.c1);
  // Células do retângulo, na ordem de leitura (linhas de cima p/ baixo).
  const rectCells = (): QTCell[] => {
    if (!rect) return [];
    const out: QTCell[] = [];
    for (let r = rect.r0; r <= rect.r1; r += 1) {
      for (let c = rect.c0; c <= rect.c1; c += 1) {
        const cell = matrix.rows[r]?.cells[c];
        if (cell) out.push(cell);
      }
    }
    return out;
  };

  // Texto exibido de uma célula (fórmulas usam o valor computado no cliente).
  const displayOf = (cell: QTCell): string => {
    if (cell.content !== "formula") return cell.display;
    const k = cellKey(cell.rowKey, cell.colKey);
    return (
      formulaCalc.errors.get(k) ??
      formatFormulaResult(formulaCalc.values.get(k) ?? null)
    );
  };

  // Copiar a seleção como TSV (compatível com Excel/Google Sheets).
  function copySelection() {
    if (!rect) return;
    const lines: string[] = [];
    for (let r = rect.r0; r <= rect.r1; r += 1) {
      const cols: string[] = [];
      for (let c = rect.c0; c <= rect.c1; c += 1) {
        const cell = matrix.rows[r]?.cells[c];
        cols.push(cell ? displayOf(cell).replaceAll("\t", " ") : "");
      }
      lines.push(cols.join("\t"));
    }
    void navigator.clipboard?.writeText(lines.join("\n"));
  }

  // Colar TSV a partir da ÂNCORA: só em células editáveis pela role (as
  // bloqueadas/derivadas são puladas em silêncio). "=…"/"{=…}" colados entram
  // como fórmula/expressão.
  function pasteText(text: string) {
    if (!sel || !text) return;
    const start = {
      r: Math.min(sel.anchor.r, sel.head.r),
      c: Math.min(sel.anchor.c, sel.head.c),
    };
    const rows = text.replace(/\r/g, "").split("\n");
    while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
    const batch: { rowKey: string; colKey: string; value: string | null }[] = [];
    rows.forEach((line, dr) => {
      line.split("\t").forEach((val, dc) => {
        const cell = matrix.rows[start.r + dr]?.cells[start.c + dc];
        if (!cell?.editable) return;
        batch.push({
          rowKey: cell.rowKey,
          colKey: cell.colKey,
          value: val.trim() === "" ? null : val,
        });
      });
    });
    saveCells(batch);
  }

  // Limpar (Delete) todas as células editáveis da seleção.
  function clearSelection() {
    const batch = rectCells()
      .filter((cell) => cell.editable && cell.raw != null)
      .map((cell) => ({
        rowKey: cell.rowKey,
        colKey: cell.colKey,
        value: null,
      }));
    saveCells(batch);
  }

  function startEdit(p: Pos, initial?: string) {
    const cell = matrix.rows[p.r]?.cells[p.c];
    if (!cell?.editable) return;
    setSel({ anchor: p, head: p });
    setSelToolbar(null);
    setEditing({ pos: p, draft: initial ?? (cell.raw ?? "") });
  }

  function commitEdit(move?: "down" | "right") {
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
          const r = move === "down" ? s.anchor.r + 1 : s.anchor.r;
          const c = move === "right" ? s.anchor.c + 1 : s.anchor.c;
          if (r < matrix.rows.length && c < matrix.cols.length) {
            return { anchor: { r, c }, head: { r, c } };
          }
          return s;
        });
      }
      return null;
    });
    containerRef.current?.focus();
  }

  function cancelEdit() {
    setEditing(null);
    containerRef.current?.focus();
  }

  // Teclado no container (fora da edição): navegação/atalhos de planilha.
  // Setas movem (Shift estende a seleção); Ctrl/Cmd+C copia TSV; colar chega
  // pelo evento `paste` do container; Delete limpa a seleção em lote.
  function onKeyDown(e: React.KeyboardEvent) {
    if (editing) return; // o input cuida do próprio teclado
    if (!sel) return;
    const move = (dr: number, dc: number, extend: boolean) => {
      e.preventDefault();
      setSelToolbar(null);
      setSel((s) => {
        if (!s) return s;
        const base = extend ? s.head : s.anchor;
        const r = Math.min(Math.max(0, base.r + dr), matrix.rows.length - 1);
        const c = Math.min(Math.max(0, base.c + dc), matrix.cols.length - 1);
        return extend
          ? { anchor: s.anchor, head: { r, c } }
          : { anchor: { r, c }, head: { r, c } };
      });
    };
    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      copySelection();
      return;
    }
    switch (e.key) {
      case "ArrowUp":
        return move(-1, 0, e.shiftKey);
      case "ArrowDown":
        return move(1, 0, e.shiftKey);
      case "ArrowLeft":
        return move(0, -1, e.shiftKey);
      case "ArrowRight":
        return move(0, 1, e.shiftKey);
      case "Tab":
        return move(0, e.shiftKey ? -1 : 1, false);
      case "Enter":
      case "F2": {
        e.preventDefault();
        startEdit(sel.anchor);
        return;
      }
      case "Escape":
        setSel(null);
        setSelToolbar(null);
        return;
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        clearSelection();
        return;
      }
      default: {
        // Digitar um caractere imprimível substitui o conteúdo (como planilha).
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const cell = cellAt(sel.anchor);
          if (cell?.editable) {
            e.preventDefault();
            startEdit(sel.anchor, e.key);
          }
        }
      }
    }
  }

  // Arrasto de seleção: âncora no pointerdown da célula; a cabeça segue o
  // ponteiro (elementFromPoint → data-r/data-c). Ao soltar com mais de uma
  // célula selecionada, abre a mini-toolbar de aparência (se pode estilizar).
  function beginDragSelect(e: React.PointerEvent, p: Pos) {
    if (e.shiftKey && sel) {
      setSel({ anchor: sel.anchor, head: p });
      return;
    }
    setSel({ anchor: p, head: p });
    setSelToolbar(null);
    dragSelAbort.current?.abort();
    const ac = new AbortController();
    dragSelAbort.current = ac;
    const { signal } = ac;
    let last: Pos = p;
    window.addEventListener(
      "pointermove",
      (ev) => {
        const el = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest("[data-r]") as HTMLElement | null;
        if (!el) return;
        const r = Number(el.dataset.r);
        const c = Number(el.dataset.c);
        if (!Number.isInteger(r) || !Number.isInteger(c)) return;
        if (r === last.r && c === last.c) return;
        last = { r, c };
        setSel((s) => (s ? { anchor: s.anchor, head: { r, c } } : s));
      },
      { signal }
    );
    window.addEventListener(
      "pointerup",
      (ev) => {
        ac.abort();
        if (
          (last.r !== p.r || last.c !== p.c) &&
          canEdit &&
          onAppearanceChange
        ) {
          setSelToolbar({ x: ev.clientX + 8, y: ev.clientY + 8 });
        }
      },
      { signal }
    );
    window.addEventListener("pointercancel", () => ac.abort(), { signal });
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
        onCopy={(e) => {
          if (editing || !sel) return;
          e.preventDefault();
          copySelection();
        }}
        onPaste={(e) => {
          if (editing || !sel) return;
          const text = e.clipboardData.getData("text/plain");
          if (!text) return;
          e.preventDefault();
          pasteText(text);
        }}
        className="outline-none"
        role="grid"
        aria-label={widget.title ?? "Tabela Livre"}
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
                      {structureEdit ? (
                        <span className="text-muted-foreground/70 text-[10px] font-normal">
                          {colLetter(ci)}
                        </span>
                      ) : null}
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
            {matrix.loading
              ? // Skeleton das linhas de DADOS enquanto o runQuickTable roda
                // (as células livres abaixo já renderizam de imediato).
                [0, 1, 2].map((i) => (
                  <tr key={`skel-${i}`} aria-hidden>
                    {structureEdit ? <td className="w-6 px-0.5" /> : null}
                    {matrix.cols.map((col, ci) => (
                      <td
                        key={col.key}
                        className="h-8 px-2 py-1"
                        style={cellBorder(ci === matrix.cols.length - 1)}
                      >
                        <span className="bg-muted block h-3.5 w-3/4 animate-pulse rounded" />
                      </td>
                    ))}
                    {structureEdit ? <td className="w-8 px-0.5" /> : null}
                  </tr>
                ))
              : null}
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
                      <span className="text-muted-foreground/70 block text-center text-[10px] group-hover:hidden">
                        {ri + 1}
                      </span>
                      {row.kind === "free" ? (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground hidden w-full items-center justify-center group-hover:flex"
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
                    const isSel =
                      sel?.anchor.r === ri && sel?.anchor.c === ci;
                    const selected = !isSel && inRect(ri, ci);
                    const isEditing =
                      editing?.pos.r === ri && editing?.pos.c === ci;
                    // Coluna livre em que ESTE usuário não pode digitar
                    // (bloqueio por papel) — read-only com dica.
                    const locked =
                      matrix.cols[ci]?.column.kind === "free" &&
                      !cell.editable;
                    // Fórmula "=…": exibe o resultado computado (ou o erro).
                    const k = cellKey(row.key, cell.colKey);
                    const formulaError =
                      cell.content === "formula"
                        ? formulaCalc.errors.get(k)
                        : undefined;
                    const display =
                      cell.content === "formula"
                        ? (formulaError ??
                          formatFormulaResult(
                            formulaCalc.values.get(k) ?? null
                          ))
                        : cell.display;
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
                            : (formulaError ??
                              (cell.content === "formula"
                                ? (cell.raw ?? undefined)
                                : undefined))
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
                          containerRef.current?.focus();
                          if (e.button === 0) {
                            beginDragSelect(e, { r: ri, c: ci });
                          } else if (!inRect(ri, ci)) {
                            // Clique-direito fora da seleção: seleciona a célula.
                            setSel({
                              anchor: { r: ri, c: ci },
                              head: { r: ri, c: ci },
                            });
                            setSelToolbar(null);
                          }
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
                          <span
                            className={cn(
                              spanClass,
                              formulaError && "text-destructive"
                            )}
                          >
                            {display || " "}
                          </span>
                        )}
                        {selected ? (
                          <span
                            aria-hidden
                            className="bg-primary/10 pointer-events-none absolute inset-0"
                          />
                        ) : null}
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
        {matrix.loading ? (
          <div className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-xs">
            <Loader2 className="size-3 animate-spin" /> Carregando dados…
          </div>
        ) : null}
        {matrix.error ? (
          <div
            className="text-destructive truncate px-2 py-1 text-xs"
            title={matrix.error}
          >
            Não foi possível carregar os dados: {matrix.error}
          </div>
        ) : null}
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
      {menu?.kind === "batchColor" && sel ? (
        <ColorPopover
          x={menu.x}
          y={menu.y}
          title={`Aparência da seleção (${rectCells().length} células)`}
          value={
            t.cellColors?.[
              `${cellAt(sel.anchor)?.rowKey}:${cellAt(sel.anchor)?.colKey}`
            ] ?? {}
          }
          onChange={setBatchColor}
          onClose={() => setMenu(null)}
          align={{
            value:
              t.cellAlign?.[
                `${cellAt(sel.anchor)?.rowKey}:${cellAt(sel.anchor)?.colKey}`
              ],
            onSelect: setBatchAlign,
          }}
        />
      ) : null}
      {/* Mini-toolbar da seleção multi-célula (aparece ao soltar o arrasto). */}
      {selToolbar && multiSel && !menu ? (
        <div
          className="bg-popover text-popover-foreground fixed z-50 flex items-center gap-0.5 rounded-md border p-1 shadow-md"
          style={{
            left: Math.max(4, Math.min(selToolbar.x, window.innerWidth - 160)),
            top: Math.max(4, Math.min(selToolbar.y, window.innerHeight - 48)),
          }}
        >
          {canEdit && onAppearanceChange ? (
            <button
              type="button"
              className="hover:bg-accent hover:text-accent-foreground flex items-center gap-1 rounded-sm px-2 py-1 text-xs"
              onClick={() =>
                setMenu({ kind: "batchColor", x: selToolbar.x, y: selToolbar.y })
              }
            >
              <Palette className="size-3.5" /> Aparência
            </button>
          ) : null}
          <button
            type="button"
            className="hover:bg-accent hover:text-accent-foreground flex items-center gap-1 rounded-sm px-2 py-1 text-xs"
            onClick={copySelection}
          >
            <Copy className="size-3.5" /> Copiar
          </button>
          <button
            type="button"
            className="hover:bg-accent hover:text-accent-foreground flex items-center gap-1 rounded-sm px-2 py-1 text-xs"
            onClick={() => {
              clearSelection();
              setSelToolbar(null);
            }}
          >
            <Eraser className="size-3.5" /> Limpar
          </button>
        </div>
      ) : null}
    </div>
  );
}
