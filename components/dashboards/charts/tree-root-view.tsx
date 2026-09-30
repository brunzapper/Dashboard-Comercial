// Versão: 1.0 | Data: 30/09/2026
// v1.0 (30/09/2026): a visualização ROOT da Tree — a mesma árvore desenhada
//   num canvas, para mostrar O QUE DEPENDE DE QUÊ.
//
// O que ela faz, e a lista não fazia:
//  - galhos ARRASTÁVEIS: soltar no vazio grava a posição (offset relativo ao
//    slot — o subgalho vai junto); soltar SOBRE outro nó o re-pendura (ele
//    passa a depender daquele). O descendente nunca é alvo: seria ciclo;
//  - galhos COLAPSÁVEIS que abrem PARA O LADO ou PARA BAIXO, por galho;
//  - de QUALQUER nó sai um galho novo (anotação, tarefa ou comentário);
//  - selecionar um nó ilumina o CAMINHO dele até o Resultado esperado (ou até
//    a raiz) e o que está abaixo dele (do que ele depende), e diz quanto falta.
//
// Decisões:
//  - o LAYOUT é puro (`lib/tree/root-layout.ts`) e o cartão tem tamanho fixo —
//    a mesma árvore sai no mesmo lugar em qualquer tela;
//  - os NÓS seguem HTML (têm ações e texto); só os CONECTORES são SVG — com
//    posição livre, uma borda CSS não liga dois pontos arbitrários. É a única
//    emenda à regra "as linhas são bordas" da lista, e vale só aqui;
//  - arrasto por POINTER EVENTS, não HTML5 DnD: o canvas tem zoom e pan, e o
//    DnD nativo não sabe de nenhum dos dois;
//  - o que está recolhido é preferência de QUEM OLHA (localStorage, com
//    try/catch); a direção e a posição são da árvore (banco);
//  - as ações do nó selecionado são as MESMAS da lista (`NodeActions`), nunca
//    uma segunda cópia.
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownFromLine,
  ArrowRightFromLine,
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  Crosshair,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Star,
  Undo2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  descendantIds,
  isCheckable,
  isDone,
  parentIndex,
  pathToGoal,
  progressOf,
  remainingOf,
  type TreeProgress,
} from "@/lib/tree/path";
import {
  edgePath,
  hitTest,
  layoutRoot,
  type RootBox,
} from "@/lib/tree/root-layout";
import {
  TREE_DIRECTION_LABELS,
  TREE_NODE_KIND_LABELS,
  type TreeBranchKind,
  type TreeDirection,
  type TreeNode,
  type TreeNodeGeometry,
  type TreeScope,
} from "@/lib/tree/model";
import type { TreeNoteStatus } from "@/app/(app)/dashboards/tree-actions";
import {
  AddBranchMenu,
  KIND_TONE,
  NodeActions,
  NodeDate,
  NoteDoneButton,
  type NodeActionsContext,
} from "./tree-node-parts";

/** Arrasto abaixo disto é clique. */
const DRAG_THRESHOLD_PX = 4;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const FIT_PAD = 24;

interface View {
  x: number;
  y: number;
  k: number;
}

/** Nó que não é fato de ninguém: não arrasta, não recebe galho. */
function isSynthetic(id: string): boolean {
  return id.startsWith("series:") || id.startsWith("kind:");
}

/** Encaixa o conteúdo na janela, sem ampliar além de 100%. */
export function fitView(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  size: { w: number; h: number }
): View {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  if (size.w <= 0 || size.h <= 0) {
    return { x: FIT_PAD - bounds.minX, y: FIT_PAD - bounds.minY, k: 1 };
  }
  const k = Math.max(
    MIN_ZOOM,
    Math.min(1, (size.w - 2 * FIT_PAD) / bw, (size.h - 2 * FIT_PAD) / bh)
  );
  const x = Math.max(FIT_PAD, (size.w - bw * k) / 2) - bounds.minX * k;
  const y = Math.max(FIT_PAD, (size.h - bh * k) / 2) - bounds.minY * k;
  return { x, y, k };
}

function readCollapsed(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(key: string, set: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // Preferência de quem olha: sem storage, só não lembra.
  }
}

type Gesture =
  | {
      kind: "pan";
      pointerId: number;
      sx: number;
      sy: number;
      view: View;
      moved: boolean;
    }
  | {
      kind: "node";
      pointerId: number;
      id: string;
      sx: number;
      sy: number;
      moved: boolean;
    };

interface DragState {
  id: string;
  ids: Set<string>;
  dx: number;
  dy: number;
  target: string | null;
}

export interface TreeRootViewProps {
  nodes: TreeNode[];
  geometry: TreeNodeGeometry[];
  defaultDirection: TreeDirection;
  /** Onde lembrar o que está recolhido (por árvore). */
  storageKey: string;
  scope: TreeScope;
  actx: NodeActionsContext;
  onAddBranch: (kind: TreeBranchKind, parent: TreeNode | null) => void;
  onReparent: (nodeId: string, parentId: string | null) => void;
  onMove: (nodeId: string, offset: { x: number; y: number }) => void;
  onDirection: (nodeId: string, direction: TreeDirection) => void;
  onEditNote: (
    node: TreeNode,
    patch: { label?: string; status?: TreeNoteStatus; goal?: boolean }
  ) => void;
  /** Controles do widget que moram na barra da Root (ordem, carregar mais…). */
  toolbarExtra?: ReactNode;
}

export function TreeRootView({
  nodes,
  geometry,
  defaultDirection,
  storageKey,
  scope,
  actx,
  onAddBranch,
  onReparent,
  onMove,
  onDirection,
  onEditNote,
  toolbarExtra,
}: TreeRootViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    readCollapsed(storageKey)
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const gesture = useRef<Gesture | null>(null);

  const geoById = useMemo(
    () => new Map(geometry.map((g) => [g.nodeRef, g])),
    [geometry]
  );
  const nodeById = useMemo(() => {
    const map = new Map<string, TreeNode>();
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        map.set(n.id, n);
        walk(n.children);
      }
    };
    walk(nodes);
    return map;
  }, [nodes]);
  const parents = useMemo(() => parentIndex(nodes), [nodes]);

  const layout = useMemo(
    () =>
      layoutRoot(nodes, {
        defaultDirection,
        directionOf: (id) => geoById.get(id)?.direction ?? null,
        collapsed,
        offsetOf: (id) => {
          const g = geoById.get(id);
          return g ? { x: g.offsetX, y: g.offsetY } : null;
        },
      }),
    [nodes, defaultDirection, geoById, collapsed]
  );

  const effective = view ?? fitView(layout.bounds, size);
  // O último valor efetivo, para os handlers que não re-renderizam (roda do
  // mouse, pan) partirem do que está NA TELA — inclusive do encaixe automático.
  const effectiveRef = useRef(effective);
  const boxesRef = useRef<RootBox[]>(layout.boxes);
  useLayoutEffect(() => {
    effectiveRef.current = effective;
    boxesRef.current = layout.boxes;
  });

  // Tamanho da janela: o encaixe automático depende dele.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen]);

  // Roda do mouse: Ctrl/⌘ amplia em torno do cursor; sem modificador, rola o
  // canvas. Listener NÃO passivo — é o único jeito de impedir o zoom da página.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = effectiveRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const k = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, v.k * Math.exp(-e.deltaY * 0.0015))
        );
        setView({
          k,
          x: px - ((px - v.x) * k) / v.k,
          y: py - ((py - v.y) * k) / v.k,
        });
        return;
      }
      setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fullscreen]);

  // Esc: cancela o arrasto, depois a seleção, depois a tela cheia.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (gesture.current) {
        gesture.current = null;
        setDrag(null);
        return;
      }
      if (selected) setSelected(null);
      else if (fullscreen) setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, fullscreen]);

  const toggleCollapsed = useCallback(
    (id: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        writeCollapsed(storageKey, next);
        return next;
      });
    },
    [storageKey]
  );

  const zoomBy = (factor: number) => {
    const v = effectiveRef.current;
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.k * factor));
    const cx = size.w / 2;
    const cy = size.h / 2;
    setView({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k });
  };

  const toCanvas = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const v = effectiveRef.current;
    return {
      x: (clientX - (rect?.left ?? 0) - v.x) / v.k,
      y: (clientY - (rect?.top ?? 0) - v.y) / v.k,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Controle dentro do cartão (botão, campo, menu) não inicia arrasto.
    if (
      target.closest(
        "[data-no-drag], button, input, textarea, select, a, [role='menuitem']"
      )
    ) {
      return;
    }
    const nodeEl = target.closest<HTMLElement>("[data-tree-node]");
    containerRef.current?.setPointerCapture(e.pointerId);
    if (nodeEl?.dataset.treeNode) {
      gesture.current = {
        kind: "node",
        pointerId: e.pointerId,
        id: nodeEl.dataset.treeNode,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
      };
      return;
    }
    gesture.current = {
      kind: "pan",
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      view: effectiveRef.current,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dxs = e.clientX - g.sx;
    const dys = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dxs, dys) < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    if (g.kind === "pan") {
      setView({ ...g.view, x: g.view.x + dxs, y: g.view.y + dys });
      return;
    }
    if (isSynthetic(g.id)) return;
    const node = nodeById.get(g.id);
    if (!node) return;
    const k = effectiveRef.current.k;
    const ids = new Set([g.id, ...descendantIds(node)]);
    // O agrupador sintético não recebe galho (o servidor recusaria).
    for (const b of boxesRef.current) if (isSynthetic(b.id)) ids.add(b.id);
    const hit = hitTest(boxesRef.current, toCanvas(e.clientX, e.clientY), ids);
    setDrag({
      id: g.id,
      ids: new Set([g.id, ...descendantIds(node)]),
      dx: dxs / k,
      dy: dys / k,
      target: hit?.id ?? null,
    });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
    if (g.kind === "pan") {
      // Clique no vazio: tira a seleção.
      if (!g.moved) setSelected(null);
      return;
    }
    const current = drag;
    setDrag(null);
    if (!g.moved || !current || current.id !== g.id) {
      setSelected((s) => (s === g.id ? null : g.id));
      return;
    }
    const parentId = parents.get(g.id)?.id ?? null;
    if (current.target) {
      if (current.target !== parentId) onReparent(g.id, current.target);
      return;
    }
    const base = geoById.get(g.id);
    onMove(g.id, {
      x: (base?.offsetX ?? 0) + current.dx,
      y: (base?.offsetY ?? 0) + current.dy,
    });
  };

  // --- leitura do caminho ---
  const selectedNode = selected ? (nodeById.get(selected) ?? null) : null;
  const pathSet = useMemo(
    () => new Set(selectedNode ? pathToGoal(nodes, selectedNode.id) : []),
    [nodes, selectedNode]
  );
  const belowSet = useMemo(
    () => new Set(selectedNode ? descendantIds(selectedNode) : []),
    [selectedNode]
  );

  const boxById = new Map(layout.boxes.map((b) => [b.id, b]));
  const shifted = (b: RootBox): RootBox =>
    drag && drag.ids.has(b.id) ? { ...b, x: b.x + drag.dx, y: b.y + drag.dy } : b;

  const shell = cn(
    "bg-background relative flex min-h-0 flex-col overflow-hidden rounded-md border",
    fullscreen ? "fixed inset-4 z-50 shadow-2xl" : "h-full min-h-[240px] flex-1"
  );

  const body = (
    <div className={shell}>
      {/* Barra da Root: zoom, encaixe, galho na raiz, tela cheia. */}
      <div className="bg-background/90 flex flex-wrap items-center gap-1 border-b px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Reduzir"
          title="Reduzir"
          onClick={() => zoomBy(1 / 1.2)}
        >
          <Minus className="size-4" />
        </Button>
        <span className="text-muted-foreground w-10 text-center text-xs tabular-nums">
          {Math.round(effective.k * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Ampliar"
          title="Ampliar"
          onClick={() => zoomBy(1.2)}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          title="Encaixar a árvore na janela"
          onClick={() => setView(null)}
        >
          <Crosshair className="size-3.5" /> Ajustar
        </Button>
        <AddBranchMenu
          parent={null}
          scopeKind={scope.kind}
          onPick={onAddBranch}
          label="Galho na raiz"
        />
        {toolbarExtra}
        <span className="text-muted-foreground ml-auto hidden text-[11px] lg:inline">
          Arraste para mover · solte sobre um nó para depender dele · Ctrl+roda
          para ampliar
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          onClick={() => {
            setFullscreen((v) => !v);
            setView(null);
          }}
        >
          {fullscreen ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </Button>
      </div>

      {selectedNode ? (
        <SelectedBar
          node={selectedNode}
          parent={parents.get(selectedNode.id) ?? null}
          nodes={nodes}
          nodeById={nodeById}
          geometry={geoById.get(selectedNode.id) ?? null}
          direction={boxById.get(selectedNode.id)?.direction ?? defaultDirection}
          scope={scope}
          actx={actx}
          onAddBranch={onAddBranch}
          onReparent={onReparent}
          onMove={onMove}
          onDirection={onDirection}
          onEditNote={onEditNote}
          onClose={() => setSelected(null)}
        />
      ) : null}

      <div
        ref={containerRef}
        className={cn(
          "relative min-h-0 flex-1 touch-none overflow-hidden select-none",
          "bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px]",
          "cursor-grab active:cursor-grabbing"
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(null);
        }}
        role="tree"
        aria-label="Árvore — visualização Root"
      >
        {nodes.length === 0 ? (
          <div className="text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm">
            <p>
              Nada aqui ainda. Comece pelo resultado esperado e puxe dele o que
              precisa acontecer antes.
            </p>
            <AddBranchMenu
              parent={null}
              scopeKind={scope.kind}
              onPick={onAddBranch}
              label="Primeiro galho"
            />
          </div>
        ) : null}

        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate(${effective.x}px, ${effective.y}px) scale(${effective.k})`,
          }}
        >
          {/* Conectores: a única parte em SVG (ver o cabeçalho). */}
          <svg
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width={1}
            height={1}
            aria-hidden
          >
            {layout.edges.map((edge) => {
              const from = boxById.get(edge.from);
              const to = boxById.get(edge.to);
              if (!from || !to) return null;
              const onPath = pathSet.has(edge.from) && pathSet.has(edge.to);
              const below =
                selectedNode != null &&
                (edge.from === selectedNode.id || belowSet.has(edge.from)) &&
                belowSet.has(edge.to);
              const dim = selectedNode != null && !onPath && !below;
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={edgePath(shifted(from), shifted(to), edge.direction)}
                  fill="none"
                  className={cn(
                    "transition-opacity",
                    onPath
                      ? "stroke-primary"
                      : below
                        ? "stroke-primary/60"
                        : "stroke-muted-foreground/40",
                    dim && "opacity-30"
                  )}
                  strokeWidth={onPath ? 2.5 : 1.5}
                  strokeDasharray={below && !onPath ? "5 4" : undefined}
                />
              );
            })}
          </svg>

          {layout.boxes.map((raw) => {
            const box = shifted(raw);
            const node = nodeById.get(box.id);
            if (!node) return null;
            const highlighted =
              selectedNode != null &&
              (pathSet.has(node.id) || belowSet.has(node.id));
            return (
              <RootNodeTile
                key={node.id}
                node={node}
                box={box}
                actx={actx}
                selected={selected === node.id}
                dim={selectedNode != null && !highlighted}
                onPath={pathSet.has(node.id) && selected !== node.id}
                dragging={drag?.ids.has(node.id) ?? false}
                dropTarget={drag?.target === node.id}
                collapsed={collapsed.has(node.id)}
                progress={progressOf(node)}
                onToggleCollapsed={() => toggleCollapsed(node.id)}
                onSelect={() =>
                  setSelected((s) => (s === node.id ? null : node.id))
                }
                onAddBranch={onAddBranch}
                scopeKind={scope.kind}
              />
            );
          })}
        </div>
      </div>
    </div>
  );

  // Tela cheia vai por PORTAL: a grade do dashboard posiciona os cards com
  // `transform`, e um `position: fixed` dentro de um ancestral transformado
  // fica preso ao card em vez da janela.
  if (fullscreen && typeof document !== "undefined") {
    return (
      <>
        <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
          Aberta em tela cheia.
        </div>
        {createPortal(
          <div className="fixed inset-0 z-50 bg-black/40">{body}</div>,
          document.body
        )}
      </>
    );
  }
  return body;
}

function ProgressBar({ progress }: { progress: TreeProgress }) {
  if (progress.total === 0) return null;
  const pct = Math.round((progress.done / progress.total) * 100);
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-1"
      title={`${progress.done} de ${progress.total} concluídos abaixo deste galho`}
    >
      <span className="bg-muted h-1.5 min-w-6 flex-1 overflow-hidden rounded-full">
        <span
          className={cn(
            "block h-full rounded-full",
            pct === 100 ? "bg-emerald-500" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
        {progress.done}/{progress.total}
      </span>
    </span>
  );
}

function RootNodeTile({
  node,
  box,
  actx,
  selected,
  dim,
  onPath,
  dragging,
  dropTarget,
  collapsed,
  progress,
  onToggleCollapsed,
  onSelect,
  onAddBranch,
  scopeKind,
}: {
  node: TreeNode;
  box: RootBox;
  actx: NodeActionsContext;
  selected: boolean;
  dim: boolean;
  onPath: boolean;
  dragging: boolean;
  dropTarget: boolean;
  collapsed: boolean;
  progress: TreeProgress;
  onToggleCollapsed: () => void;
  onSelect: () => void;
  onAddBranch: (kind: TreeBranchKind, parent: TreeNode | null) => void;
  scopeKind: TreeScope["kind"];
}) {
  const task = node.refId ? (actx.taskById.get(node.refId) ?? null) : null;
  const done = isCheckable(node) && isDone(node);
  return (
    <div
      data-tree-node={node.id}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={box.hasChildren ? !collapsed : undefined}
      aria-label={`${TREE_NODE_KIND_LABELS[node.kind]}: ${node.label}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group bg-card absolute flex flex-col gap-1 rounded-lg border-2 px-2 py-1.5 shadow-sm transition-[opacity,box-shadow]",
        KIND_TONE[node.kind] ?? "border-muted",
        node.goal && "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
        isSynthetic(node.id) ? "cursor-default" : "cursor-move",
        selected && "ring-primary ring-2 ring-offset-1",
        onPath && "ring-primary/60 ring-2",
        dropTarget && "ring-2 ring-emerald-500 ring-offset-2",
        dragging && "z-10 opacity-80 shadow-lg",
        dim && "opacity-35"
      )}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
          {TREE_NODE_KIND_LABELS[node.kind]}
        </Badge>
        {node.goal ? (
          <Badge className="h-4 shrink-0 gap-0.5 bg-amber-500 px-1 text-[10px] text-white">
            <Star className="size-2.5" /> Resultado
          </Badge>
        ) : null}
        <span className="flex-1" />
        {node.kind === "note" ? (
          <NoteDoneButton node={node} onChanged={actx.onChanged} compact />
        ) : null}
        <span
          className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[on=true]:opacity-100"
          data-on={selected}
        >
          <AddBranchMenu
            parent={node}
            scopeKind={scopeKind}
            onPick={onAddBranch}
            compact
          />
        </span>
        {box.hasChildren ? (
          <button
            type="button"
            data-no-drag
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expandir galho" : "Recolher galho"}
            title={collapsed ? "Expandir galho" : "Recolher galho"}
            className="text-muted-foreground hover:text-foreground flex items-center rounded text-[10px]"
          >
            {collapsed ? (
              <>
                <ChevronRight className="size-3.5" />+{box.hiddenCount}
              </>
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "line-clamp-2 shrink-0 text-left text-xs leading-snug font-medium",
          done && "text-muted-foreground line-through"
        )}
        title={node.body ? `${node.label}\n\n${node.body}` : node.label}
        // O rótulo seleciona; o resto do cartão arrasta.
        data-no-drag
      >
        {node.label}
      </button>
      <div className="mt-auto flex items-center gap-1.5">
        {node.at || task ? <NodeDate node={node} task={task} /> : null}
        <ProgressBar progress={progress} />
      </div>
    </div>
  );
}

/**
 * A barra do nó SELECIONADO: o caminho até o Resultado, quanto falta, a
 * edição da anotação, a direção do galho e as ações de sempre do nó.
 */
function SelectedBar({
  node,
  parent,
  nodes,
  nodeById,
  geometry,
  direction,
  scope,
  actx,
  onAddBranch,
  onReparent,
  onMove,
  onDirection,
  onEditNote,
  onClose,
}: {
  node: TreeNode;
  parent: TreeNode | null;
  nodes: TreeNode[];
  nodeById: Map<string, TreeNode>;
  geometry: TreeNodeGeometry | null;
  direction: TreeDirection;
  scope: TreeScope;
  actx: NodeActionsContext;
  onAddBranch: (kind: TreeBranchKind, parent: TreeNode | null) => void;
  onReparent: (nodeId: string, parentId: string | null) => void;
  onMove: (nodeId: string, offset: { x: number; y: number }) => void;
  onDirection: (nodeId: string, direction: TreeDirection) => void;
  onEditNote: TreeRootViewProps["onEditNote"];
  onClose: () => void;
}) {
  const path = pathToGoal(nodes, node.id)
    .slice(1)
    .map((id) => nodeById.get(id)?.label ?? "")
    .filter(Boolean);
  const progress = progressOf(node);
  const remaining = remainingOf(node);
  const synthetic = isSynthetic(node.id);
  const moved = (geometry?.offsetX ?? 0) !== 0 || (geometry?.offsetY ?? 0) !== 0;
  const isNote = node.kind === "note" && node.refId;
  const noteStatus: TreeNoteStatus =
    node.status === "concluída"
      ? "concluida"
      : node.status === "aberta"
        ? "pendente"
        : "texto";

  return (
    <div className="bg-muted/40 flex flex-col gap-1.5 border-b px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {TREE_NODE_KIND_LABELS[node.kind]}
        </Badge>
        {isNote ? (
          <Input
            key={`${node.id}:${node.label}`}
            defaultValue={node.label}
            className="h-7 max-w-xs flex-1 text-xs"
            aria-label="Texto da anotação"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== node.label) onEditNote(node, { label: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium" title={node.label}>
            {node.label}
          </span>
        )}
        {progress.total > 0 ? (
          <span className="text-muted-foreground">
            {progress.done} de {progress.total} concluídos
            {remaining > 0 ? ` · faltam ${remaining}` : " · tudo pronto"}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          aria-label="Fechar"
          title="Fechar (Esc)"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {path.length > 0 ? (
        <p className="text-muted-foreground truncate" title={path.join(" → ")}>
          Serve a: {path.join(" → ")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {isNote ? (
          <>
            <select
              className="border-input bg-background h-7 rounded-md border px-1 text-xs"
              value={noteStatus}
              aria-label="Tipo da anotação"
              onChange={(e) =>
                onEditNote(node, { status: e.target.value as TreeNoteStatus })
              }
            >
              <option value="texto">Texto livre</option>
              <option value="pendente">Etapa — pendente</option>
              <option value="concluida">Etapa — concluída</option>
            </select>
            <Button
              type="button"
              variant={node.goal ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1 text-xs"
              title="O resultado esperado: a Root mostra o caminho de cada nó até ele"
              onClick={() => onEditNote(node, { goal: !node.goal })}
            >
              <Star className="size-3.5" />
              {node.goal ? "É o resultado" : "Marcar como resultado"}
            </Button>
          </>
        ) : null}

        {!synthetic ? (
          <>
            <span className="text-muted-foreground ml-1">Galhos:</span>
            {(["h", "v"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                variant={direction === d ? "secondary" : "ghost"}
                size="icon"
                className="size-7"
                aria-label={`Galhos abrem ${TREE_DIRECTION_LABELS[d].toLowerCase()}`}
                title={`Galhos abrem ${TREE_DIRECTION_LABELS[d].toLowerCase()}`}
                aria-pressed={direction === d}
                onClick={() => onDirection(node.id, d)}
              >
                {d === "h" ? (
                  <ArrowRightFromLine className="size-3.5" />
                ) : (
                  <ArrowDownFromLine className="size-3.5" />
                )}
              </Button>
            ))}
            {parent && !isSynthetic(parent.id) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                title="Tira este galho de dentro do pai e o põe na raiz"
                onClick={() => onReparent(node.id, null)}
              >
                <CornerLeftUp className="size-3.5" /> Soltar na raiz
              </Button>
            ) : null}
            {moved ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                title="Volta o galho para o lugar calculado"
                onClick={() => onMove(node.id, { x: 0, y: 0 })}
              >
                <Undo2 className="size-3.5" /> Voltar ao lugar
              </Button>
            ) : null}
          </>
        ) : null}

        <AddBranchMenu parent={node} scopeKind={scope.kind} onPick={onAddBranch} />
        <NodeActions node={node} actx={actx} />
      </div>
    </div>
  );
}
