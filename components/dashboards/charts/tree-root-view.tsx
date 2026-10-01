// Versão: 1.2 | Data: 01/10/2026
// v1.2 (01/10/2026): nós OPERACIONAIS (0149). (a) o tamanho do cartão é POR
//   NÓ (`sizeOf` → layoutRoot): indicador/plano/ritual mostram meta ×
//   realizado, 5W2H e a próxima data, e não cabem em 224×92; (b) o corpo deles
//   vem do widget (`renderBody`) — a Root não sabe de indicador; (c) o
//   rascunho vira Indicador/Plano/Ritual pelo clique direito (abre o editor do
//   nó com o texto digitado, como a tarefa); (d) "Copiar id do nó" — o valor de
//   "Mostrar só o galho" (`rootRef`) de outro widget.
// v1.1 (01/10/2026): criação e edição DENTRO do canvas.
//   (a) RASCUNHO no canvas: o "+" de um card, o clique direito no vazio e o
//       "Nova branch independente" abrem na hora a PRÉVIA da branch nova — um
//       card com a caixa de texto já focada, no lugar exato onde ela vai
//       ficar (o rascunho entra no layout como um nó de verdade). Antes a
//       caixa de digitação morava no widget, FORA do portal da tela cheia, e
//       ficava atrás do canvas.
//   (b) toda branch nasce como ANOTAÇÃO; o clique direito em cima dela (no
//       rascunho ou já salva) a converte em COMENTÁRIO ou TAREFA.
//   (c) DIGITAR no card: clicar no texto de uma anotação ou comentário abre a
//       edição ali mesmo (Enter salva, Shift+Enter quebra linha, Esc desfaz).
//   (d) vocabulário: "branch" no lugar de "galho".
//   Branch criada no clique direito / na barra nasce ONDE apareceu: o servidor
//   decide o slot pela data, então, quando o nó volta, o deslocamento até o
//   ponto da prévia é gravado como geometria (offset relativo ao slot — o
//   mesmo mecanismo do arrasto).
// Versão: 1.0 | Data: 30/09/2026
// v1.0 (30/09/2026): a visualização ROOT da Tree — a mesma árvore desenhada
//   num canvas, para mostrar O QUE DEPENDE DE QUÊ.
//
// O que ela faz, e a lista não fazia:
//  - branches ARRASTÁVEIS: soltar no vazio grava a posição (offset relativo ao
//    slot — as sub-branches vão junto); soltar SOBRE outro nó a re-pendura (ela
//    passa a depender daquele). O descendente nunca é alvo: seria ciclo;
//  - branches COLAPSÁVEIS que abrem PARA O LADO ou PARA BAIXO, por branch;
//  - de QUALQUER nó sai uma branch nova;
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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownFromLine,
  ArrowRightFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  CornerLeftUp,
  Crosshair,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Minus,
  Plus,
  Sparkles,
  Star,
  Undo2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  descendantIds,
  insertNode,
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
  ROOT_NODE_HEIGHT,
  ROOT_NODE_WIDTH,
  type RootBox,
} from "@/lib/tree/root-layout";
import {
  branchKindDisabledReason,
  TREE_BRANCH_LABELS,
  TREE_DIRECTION_LABELS,
  TREE_NODE_KIND_LABELS,
  type TreeDirection,
  type TreeNode,
  type TreeNodeGeometry,
  type TreeScope,
} from "@/lib/tree/model";
import type { TreeNoteStatus } from "@/app/(app)/dashboards/tree-actions";
import {
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

/** Id do nó-rascunho dentro do layout (nunca vai ao servidor). */
export const ROOT_DRAFT_ID = "draft:new";

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

/** O tipo do rascunho: toda branch nasce anotação; o clique direito troca. */
type DraftKind = "note" | "comment";

interface Draft {
  parentId: string | null;
  kind: DraftKind;
  /** Deslocamento da PRÉVIA em relação ao slot (para aparecer onde se pediu). */
  offset: { x: number; y: number } | null;
  /** Onde a branch deve ficar no canvas (só as independentes). */
  abs: { x: number; y: number } | null;
  text: string;
  saving: boolean;
}

interface ContextMenuState {
  /** Posição na JANELA do canvas (px), não no espaço do layout. */
  x: number;
  y: number;
  target: { kind: "node"; id: string } | { kind: "draft" };
}

/** O que a Root pede ao widget para criar uma branch. */
export interface RootCreateInput {
  kind: DraftKind;
  parentRef: string | null;
  text: string;
  analyze?: boolean;
}

export interface TreeRootViewProps {
  nodes: TreeNode[];
  geometry: TreeNodeGeometry[];
  defaultDirection: TreeDirection;
  /** Onde lembrar o que está recolhido (por árvore). */
  storageKey: string;
  scope: TreeScope;
  actx: NodeActionsContext;
  /**
   * Salva o rascunho (anotação ou comentário). Devolve o id do nó criado —
   * com ele a Root grava a posição em que a prévia apareceu — ou null na
   * falha (o rascunho fica na tela para tentar de novo).
   */
  onCreate: (input: RootCreateInput) => Promise<string | null>;
  /** O rascunho virou tarefa: abre o editor de tarefa com o texto digitado. */
  onCreateTask: (input: { parentRef: string | null; title: string }) => void;
  /** Converte uma anotação salva em comentário ou tarefa. */
  onConvert: (node: TreeNode, to: "comment" | "task") => void;
  onDeleteNote: (node: TreeNode) => void;
  onEditComment: (node: TreeNode, body: string) => void;
  onReparent: (nodeId: string, parentId: string | null) => void;
  onMove: (nodeId: string, offset: { x: number; y: number }) => void;
  onDirection: (nodeId: string, direction: TreeDirection) => void;
  onEditNote: (
    node: TreeNode,
    patch: { label?: string; status?: TreeNoteStatus; goal?: boolean }
  ) => void;
  /** Há dock de IA: o rascunho de comentário oferece "Salvar e analisar". */
  canAnalyze?: boolean;
  /** Controles do widget que moram na barra da Root (ordem, carregar mais…). */
  toolbarExtra?: ReactNode;
  /** v1.2: tamanho do cartão por nó (ausente = o fixo de sempre). */
  sizeOf?: (node: TreeNode) => { w: number; h: number };
  /** v1.2: corpo de um nó operacional (null = o corpo de sempre). */
  renderBody?: (node: TreeNode) => ReactNode | null;
  /** v1.2: o rascunho vira um nó operacional (abre o editor dele). */
  onCreateOperational?: (input: {
    kind: "indicator" | "plan" | "ritual";
    parentRef: string | null;
    title: string;
  }) => void;
}

/** Anotação e comentário com dono no banco são digitáveis no próprio card. */
function isTextEditable(node: TreeNode): boolean {
  return (node.kind === "note" || node.kind === "comment") && Boolean(node.refId);
}

export function TreeRootView({
  nodes,
  geometry,
  defaultDirection,
  storageKey,
  scope,
  actx,
  onCreate,
  onCreateTask,
  onConvert,
  onDeleteNote,
  onEditComment,
  onReparent,
  onMove,
  onDirection,
  onEditNote,
  canAnalyze = false,
  toolbarExtra,
  sizeOf,
  renderBody,
  onCreateOperational,
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const gesture = useRef<Gesture | null>(null);
  // Branch recém-salva que precisa ficar ONDE a prévia apareceu (ver v1.1).
  const pendingPlace = useRef<{ id: string; abs: { x: number; y: number } } | null>(
    null
  );

  const geoById = useMemo(
    () => new Map(geometry.map((g) => [g.nodeRef, g])),
    [geometry]
  );

  // O rascunho entra na árvore como um nó de verdade: o layout o posiciona
  // como posicionará a branch salva, e a prévia aparece no lugar certo.
  const shown = useMemo(
    () =>
      draft
        ? insertNode(nodes, draft.parentId, {
            id: ROOT_DRAFT_ID,
            kind: draft.kind,
            at: "",
            label: draft.text,
            children: [],
            depth: 0,
          })
        : nodes,
    [nodes, draft]
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, TreeNode>();
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        map.set(n.id, n);
        walk(n.children);
      }
    };
    walk(shown);
    return map;
  }, [shown]);
  const parents = useMemo(() => parentIndex(shown), [shown]);

  const layoutOpts = useMemo(
    () => ({
      defaultDirection,
      directionOf: (id: string) => geoById.get(id)?.direction ?? null,
      collapsed,
      // v1.2: o rascunho mantém o cartão padrão (ele é um texto).
      ...(sizeOf
        ? {
            sizeOf: (n: TreeNode) =>
              n.id === ROOT_DRAFT_ID ? { w: ROOT_NODE_WIDTH, h: ROOT_NODE_HEIGHT } : sizeOf(n),
          }
        : {}),
    }),
    [defaultDirection, geoById, collapsed, sizeOf]
  );

  const layout = useMemo(
    () =>
      layoutRoot(shown, {
        ...layoutOpts,
        offsetOf: (id) => {
          if (id === ROOT_DRAFT_ID) return draft?.offset ?? null;
          const g = geoById.get(id);
          return g ? { x: g.offsetX, y: g.offsetY } : null;
        },
      }),
    [shown, layoutOpts, geoById, draft?.offset]
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

  // A branch salva a partir de uma prévia independente volta do servidor no
  // slot que a DATA dela manda; aqui ela é levada para onde a prévia estava,
  // gravando o deslocamento como geometria. Antes da pintura: sem salto.
  useLayoutEffect(() => {
    const pending = pendingPlace.current;
    if (!pending) return;
    const box = layout.boxes.find((b) => b.id === pending.id);
    if (!box) return;
    pendingPlace.current = null;
    const g = geoById.get(pending.id);
    const slotX = box.x - (g?.offsetX ?? 0);
    const slotY = box.y - (g?.offsetY ?? 0);
    const dx = pending.abs.x - slotX;
    const dy = pending.abs.y - slotY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    onMove(pending.id, { x: dx, y: dy });
  }, [layout, geoById, onMove]);

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
      // Rolar DENTRO de uma caixa de texto rola o texto, não o canvas.
      if ((e.target as HTMLElement | null)?.closest?.("textarea")) return;
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

  // Esc: fecha o menu, cancela o arrasto, depois a seleção, depois a tela
  // cheia. (As caixas de texto tratam o próprio Esc e não chegam aqui.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) {
        setMenu(null);
        return;
      }
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
  }, [menu, selected, fullscreen]);

  // Clique fora fecha o menu de contexto.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-tree-menu]")) return;
      setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

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

  /**
   * Abre a PRÉVIA de uma branch nova. `at` (clique direito no vazio) é o ponto
   * do canvas onde ela deve aparecer; sem pai e sem `at`, ela entra no fim da
   * pilha de branches independentes e fica ONDE apareceu.
   */
  const startDraft = (
    parentId: string | null,
    kind: DraftKind = "note",
    at: { x: number; y: number } | null = null
  ) => {
    setMenu(null);
    setEditing(null);
    setSelected(null);
    if (parentId && collapsed.has(parentId)) toggleCollapsed(parentId);
    let offset: { x: number; y: number } | null = null;
    let abs: { x: number; y: number } | null = null;
    if (!parentId) {
      // O slot que o layout daria à prévia SEM deslocamento.
      const probe = layoutRoot(
        insertNode(nodes, null, {
          id: ROOT_DRAFT_ID,
          kind,
          at: "",
          label: "",
          children: [],
          depth: 0,
        }),
        {
          ...layoutOpts,
          offsetOf: (id) => {
            const g = geoById.get(id);
            return g ? { x: g.offsetX, y: g.offsetY } : null;
          },
        }
      ).boxes.find((b) => b.id === ROOT_DRAFT_ID);
      if (probe) {
        abs = at ?? { x: probe.x, y: probe.y };
        offset = at ? { x: at.x - probe.x, y: at.y - probe.y } : null;
      }
    }
    setDraft({ parentId, kind, offset, abs, text: "", saving: false });
  };

  const cancelDraft = () => setDraft(null);

  const saveDraft = async (analyze = false) => {
    const current = draft;
    if (!current || current.saving) return;
    const text = current.text.trim();
    if (!text) return cancelDraft();
    setDraft({ ...current, saving: true });
    const id = await onCreate({
      kind: current.kind,
      parentRef: current.parentId,
      text,
      analyze,
    });
    if (!id) {
      // Falhou: o texto fica na tela para tentar de novo (o toast diz o motivo).
      setDraft({ ...current, saving: false });
      return;
    }
    if (current.abs) pendingPlace.current = { id, abs: current.abs };
    setDraft(null);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Controle dentro do cartão (botão, campo, menu) não inicia arrasto.
    if (
      target.closest(
        "[data-no-drag], button, input, textarea, select, a, [role='menuitem'], [data-tree-menu]"
      )
    ) {
      return;
    }
    const nodeEl = target.closest<HTMLElement>("[data-tree-node]");
    containerRef.current?.setPointerCapture(e.pointerId);
    if (nodeEl?.dataset.treeNode && nodeEl.dataset.treeNode !== ROOT_DRAFT_ID) {
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
    if (nodeEl) return;
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
    // O agrupador sintético e o rascunho não recebem branch.
    for (const b of boxesRef.current) {
      if (isSynthetic(b.id) || b.id === ROOT_DRAFT_ID) ids.add(b.id);
    }
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

  /**
   * Clique direito. No VAZIO cria na hora uma branch independente ali; num
   * CARD abre o menu dele (no rascunho: o tipo da branch). Dentro da caixa de
   * texto de uma edição, o menu do navegador fica (copiar/colar).
   */
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-tree-menu]")) return e.preventDefault();
    const nodeEl = target.closest<HTMLElement>("[data-tree-node]");
    const id = nodeEl?.dataset.treeNode ?? null;
    if (target.closest("textarea") && id !== ROOT_DRAFT_ID) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);
    if (!id) {
      startDraft(null, "note", toCanvas(e.clientX, e.clientY));
      return;
    }
    setMenu({
      x,
      y,
      target: id === ROOT_DRAFT_ID ? { kind: "draft" } : { kind: "node", id },
    });
  };

  // --- leitura do caminho ---
  const selectedNode = selected ? (nodeById.get(selected) ?? null) : null;
  const pathSet = useMemo(
    () => new Set(selectedNode ? pathToGoal(shown, selectedNode.id) : []),
    [shown, selectedNode]
  );
  const belowSet = useMemo(
    () => new Set(selectedNode ? descendantIds(selectedNode) : []),
    [selectedNode]
  );

  const boxById = new Map(layout.boxes.map((b) => [b.id, b]));
  const shifted = (b: RootBox): RootBox =>
    drag && drag.ids.has(b.id) ? { ...b, x: b.x + drag.dx, y: b.y + drag.dy } : b;

  const commentReason = branchKindDisabledReason("comment", scope.kind);

  // "Comentar aqui" (das ações do nó) abre o rascunho de comentário DENTRO do
  // canvas — o compositor do widget fica fora da tela cheia.
  const rootActx: NodeActionsContext = {
    ...actx,
    onNote: (n) => startDraft(n.id, "comment"),
  };

  /**
   * O rascunho vira TAREFA: o editor de tarefa abre com o texto digitado. O
   * menu não rouba o foco (`mousedown` cancelado), então a caixa de texto não
   * dispara "salvar por blur" antes desta escolha — e o React não entrega o
   * blur de um elemento que esta mesma escolha desmonta.
   */
  const draftToTask = () => {
    const d = draft;
    setDraft(null);
    onCreateTask({ parentRef: d?.parentId ?? null, title: d?.text.trim() ?? "" });
  };

  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    if (menu.target.kind === "draft") {
      const kind = draft?.kind ?? "note";
      return [
        {
          label: TREE_BRANCH_LABELS.note,
          checked: kind === "note",
          onSelect: () => setDraft((d) => (d ? { ...d, kind: "note" } : d)),
        },
        {
          label: TREE_BRANCH_LABELS.comment,
          checked: kind === "comment",
          disabled: commentReason,
          onSelect: () => setDraft((d) => (d ? { ...d, kind: "comment" } : d)),
        },
        {
          label: TREE_BRANCH_LABELS.task,
          hint: "Abre o editor de tarefa com este texto",
          onSelect: draftToTask,
        },
        // v1.2 (01/10/2026): nós operacionais — abrem o editor do nó.
        ...(onCreateOperational
          ? (["indicator", "plan", "ritual"] as const).map((k) => ({
              label: TREE_BRANCH_LABELS[k],
              hint: "Abre o editor com este texto",
              disabled: branchKindDisabledReason(k, scope.kind),
              onSelect: () => {
                const d = draft;
                setDraft(null);
                onCreateOperational({
                  kind: k,
                  parentRef: d?.parentId ?? null,
                  title: d?.text.trim() ?? "",
                });
              },
            }))
          : []),
      ];
    }
    const node = nodeById.get(menu.target.id);
    if (!node) return [];
    const synthetic = isSynthetic(node.id);
    const parent = parents.get(node.id) ?? null;
    const items: MenuItem[] = [
      {
        label: "Nova branch a partir daqui",
        disabled: synthetic ? "O agrupador não recebe branches." : null,
        onSelect: () => startDraft(node.id),
      },
    ];
    if (isTextEditable(node)) {
      items.push({ label: "Editar texto", onSelect: () => setEditing(node.id) });
    }
    // v1.2: nó operacional abre o editor dele.
    if (
      (node.kind === "indicator" || node.kind === "plan" || node.kind === "ritual") &&
      actx.onEditOperational
    ) {
      items.push({
        label: `Editar ${TREE_NODE_KIND_LABELS[node.kind].toLowerCase()}`,
        onSelect: () => actx.onEditOperational?.(node),
      });
    }
    // v1.2: o id que outro widget usa em "Mostrar só o galho".
    if (!synthetic) {
      items.push({
        label: "Copiar id do nó",
        hint: "Para “Mostrar só o galho” noutro widget",
        onSelect: () => {
          void navigator.clipboard?.writeText(node.id).catch(() => undefined);
        },
      });
    }
    if (node.kind === "note" && node.refId) {
      const checkable = node.status === "aberta" || node.status === "concluída";
      items.push(
        { separator: true },
        {
          label: `Converter em ${TREE_BRANCH_LABELS.comment.toLowerCase()}`,
          disabled: commentReason,
          onSelect: () => onConvert(node, "comment"),
        },
        {
          label: `Converter em ${TREE_BRANCH_LABELS.task.toLowerCase()}`,
          onSelect: () => onConvert(node, "task"),
        },
        { separator: true },
        {
          label: node.goal ? "Desmarcar resultado" : "Marcar como resultado",
          onSelect: () => onEditNote(node, { goal: !node.goal }),
        },
        {
          label: checkable ? "Tornar texto livre" : "Tornar etapa (a concluir)",
          onSelect: () =>
            onEditNote(node, { status: checkable ? "texto" : "pendente" }),
        }
      );
    }
    if (!synthetic && parent && !isSynthetic(parent.id)) {
      items.push({
        label: "Tornar independente",
        onSelect: () => onReparent(node.id, null),
      });
    }
    if (node.kind === "note" && node.refId) {
      items.push(
        { separator: true },
        { label: "Excluir anotação", danger: true, onSelect: () => onDeleteNote(node) }
      );
    }
    return items;
  };

  const shell = cn(
    "bg-background relative flex min-h-0 flex-col overflow-hidden rounded-md border",
    fullscreen ? "fixed inset-4 z-50 shadow-2xl" : "h-full min-h-[240px] flex-1"
  );

  const body = (
    <div className={shell}>
      {/* Barra da Root: zoom, encaixe, nova branch, tela cheia. */}
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          title="Cria uma branch que não depende de nenhuma outra (atalho: clique direito no canvas)"
          onClick={() => startDraft(null)}
        >
          <Plus className="size-3.5" /> Nova branch independente
        </Button>
        {scope.kind === "record" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            title="Comentário do registro — vai para o feed dele"
            onClick={() => startDraft(null, "comment")}
          >
            <MessageSquarePlus className="size-3.5" /> Comentar
          </Button>
        ) : null}
        {toolbarExtra}
        <span className="text-muted-foreground ml-auto hidden text-[11px] xl:inline">
          Clique direito no canvas cria uma branch · arraste para mover · solte
          sobre um nó para depender dele
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-7 xl:ml-0"
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

      {selectedNode && selectedNode.id !== ROOT_DRAFT_ID ? (
        <SelectedBar
          node={selectedNode}
          parent={parents.get(selectedNode.id) ?? null}
          nodes={shown}
          nodeById={nodeById}
          geometry={geoById.get(selectedNode.id) ?? null}
          direction={boxById.get(selectedNode.id)?.direction ?? defaultDirection}
          actx={rootActx}
          onNewBranch={() => startDraft(selectedNode.id)}
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
        onContextMenu={onContextMenu}
        role="tree"
        aria-label="Árvore — visualização Root"
      >
        {shown.length === 0 ? (
          <div className="text-muted-foreground pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm">
            <p>
              Nada aqui ainda. Clique com o botão direito em qualquer lugar para
              criar uma branch — comece pelo resultado esperado e puxe dele o
              que precisa acontecer antes.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-events-auto gap-1"
              onClick={() => startDraft(null)}
            >
              <Plus className="size-3.5" /> Primeira branch
            </Button>
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
              const isDraftEdge = edge.to === ROOT_DRAFT_ID;
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
                    onPath || isDraftEdge
                      ? "stroke-primary"
                      : below
                        ? "stroke-primary/60"
                        : "stroke-muted-foreground/40",
                    dim && "opacity-30"
                  )}
                  strokeWidth={onPath ? 2.5 : 1.5}
                  strokeDasharray={
                    isDraftEdge ? "3 3" : below && !onPath ? "5 4" : undefined
                  }
                />
              );
            })}
          </svg>

          {layout.boxes.map((raw) => {
            const box = shifted(raw);
            const node = nodeById.get(box.id);
            if (!node) return null;
            if (node.id === ROOT_DRAFT_ID && draft) {
              return (
                <DraftTile
                  key={ROOT_DRAFT_ID}
                  box={box}
                  draft={draft}
                  canAnalyze={canAnalyze && draft.kind === "comment"}
                  onText={(text) => setDraft((d) => (d ? { ...d, text } : d))}
                  onSave={(analyze) => void saveDraft(analyze)}
                  onCancel={cancelDraft}
                />
              );
            }
            const highlighted =
              selectedNode != null &&
              (pathSet.has(node.id) || belowSet.has(node.id));
            return (
              <RootNodeTile
                key={node.id}
                node={node}
                box={box}
                actx={rootActx}
                selected={selected === node.id}
                dim={selectedNode != null && !highlighted}
                onPath={pathSet.has(node.id) && selected !== node.id}
                dragging={drag?.ids.has(node.id) ?? false}
                dropTarget={drag?.target === node.id}
                collapsed={collapsed.has(node.id)}
                progress={progressOf(node)}
                editing={editing === node.id}
                onToggleCollapsed={() => toggleCollapsed(node.id)}
                onSelect={() =>
                  setSelected((s) => (s === node.id ? null : node.id))
                }
                onStartEdit={() => setEditing(node.id)}
                onCommitEdit={(text) => {
                  setEditing(null);
                  if (node.kind === "comment") {
                    if (text !== (node.body ?? node.label)) onEditComment(node, text);
                  } else if (text !== node.label) {
                    onEditNote(node, { label: text });
                  }
                }}
                onCancelEdit={() => setEditing(null)}
                onNewBranch={() => startDraft(node.id)}
                body={renderBody?.(node) ?? null}
              />
            );
          })}
        </div>

        {menu ? (
          <TreeContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
        ) : null}
      </div>
    </div>
  );

  // Tela cheia vai por PORTAL: a grade do dashboard posiciona os cards com
  // `transform`, e um `position: fixed` dentro de um ancestral transformado
  // fica preso ao card em vez da janela. Rascunho, edição e menu moram DENTRO
  // do body — e por isso vão junto para a frente do canvas.
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

type MenuItem =
  | { separator: true }
  | {
      separator?: false;
      label: string;
      hint?: string;
      checked?: boolean;
      danger?: boolean;
      /** Motivo de estar desabilitado (null/ausente = habilitado). */
      disabled?: string | null;
      onSelect: () => void;
    };

/**
 * Menu do clique direito. Próprio (e não o do Radix) porque abre numa
 * coordenada livre e precisa morar DENTRO do canvas — é isso que o leva junto
 * para a tela cheia. `mousedown` não rouba o foco: com o rascunho aberto, a
 * caixa de texto segue focada e não "salva por blur" antes da escolha.
 */
function TreeContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      data-tree-menu
      role="menu"
      className="bg-popover text-popover-foreground absolute z-30 min-w-52 rounded-md border p-1 text-sm shadow-lg"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="bg-border my-1 h-px" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={Boolean(item.disabled)}
            title={item.disabled ?? item.hint}
            className={cn(
              "hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left disabled:pointer-events-none disabled:opacity-50",
              item.danger && "text-destructive"
            )}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="w-3.5 shrink-0">
              {item.checked ? <Check className="size-3.5" /> : null}
            </span>
            <span className="flex flex-col">
              <span>{item.label}</span>
              {item.disabled ? (
                <span className="text-muted-foreground text-[11px]">{item.disabled}</span>
              ) : null}
            </span>
          </button>
        )
      )}
    </div>
  );
}

/**
 * Caixa de texto de um card: Enter salva, Shift+Enter quebra linha, Esc
 * desfaz; sair da caixa também salva. O Esc não sobe até o canvas (que o usaria
 * para fechar a seleção ou a tela cheia).
 */
function CardTextarea({
  initial,
  placeholder,
  disabled,
  onChange,
  onCommit,
  onCancel,
  keepFocusWithin,
}: {
  initial: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (text: string) => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
  /** Blur para dentro deste elemento não salva (os botões do rascunho). */
  keepFocusWithin?: boolean;
}) {
  const done = useRef(false);
  return (
    <textarea
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      disabled={disabled}
      rows={3}
      data-no-drag
      className="bg-background placeholder:text-muted-foreground w-full flex-1 resize-none rounded border px-1.5 py-1 text-xs leading-snug outline-none focus:ring-1"
      onFocus={(e) => {
        const el = e.currentTarget;
        el.setSelectionRange(el.value.length, el.value.length);
      }}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          done.current = true;
          onCancel();
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          done.current = true;
          onCommit(e.currentTarget.value.trim());
        }
      }}
      onBlur={(e) => {
        if (done.current) return;
        const within = e.currentTarget.closest("[data-tree-node]");
        if (
          keepFocusWithin &&
          within &&
          e.relatedTarget instanceof Node &&
          within.contains(e.relatedTarget)
        ) {
          return;
        }
        done.current = true;
        const text = e.currentTarget.value.trim();
        if (text) onCommit(text);
        else onCancel();
      }}
    />
  );
}

/** A PRÉVIA da branch nova — um card de verdade, já pronto para digitar. */
function DraftTile({
  box,
  draft,
  canAnalyze,
  onText,
  onSave,
  onCancel,
}: {
  box: RootBox;
  draft: Draft;
  canAnalyze: boolean;
  onText: (text: string) => void;
  onSave: (analyze: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-tree-node={ROOT_DRAFT_ID}
      role="treeitem"
      aria-selected
      aria-label={`Nova branch (${TREE_BRANCH_LABELS[draft.kind].toLowerCase()})`}
      className={cn(
        "bg-card absolute z-20 flex flex-col gap-1 rounded-lg border-2 border-dashed px-2 py-1.5 shadow-lg",
        KIND_TONE[draft.kind] ?? "border-muted"
      )}
      style={{ left: box.x, top: box.y, width: box.w, minHeight: box.h }}
    >
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
          {TREE_BRANCH_LABELS[draft.kind]}
        </Badge>
        <span className="text-muted-foreground truncate text-[10px]">
          clique direito muda o tipo
        </span>
      </div>
      <CardTextarea
        initial={draft.text}
        placeholder={
          draft.kind === "comment"
            ? "O que aconteceu?"
            : "Uma etapa, uma condição, o resultado…"
        }
        disabled={draft.saving}
        keepFocusWithin
        onChange={onText}
        onCommit={() => onSave(false)}
        onCancel={onCancel}
      />
      {draft.kind === "comment" ? (
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={draft.saving}
            onClick={() => onSave(false)}
          >
            Salvar
          </Button>
          {canAnalyze ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-6 gap-1 px-2 text-[11px]"
              disabled={draft.saving}
              title="Salva o comentário e pede à IA que avalie o que ele muda nas tarefas deste registro."
              onClick={() => onSave(true)}
            >
              <Sparkles className="size-3" /> Salvar e analisar
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
function ProgressBar({ progress }: { progress: TreeProgress }) {
  if (progress.total === 0) return null;
  const pct = Math.round((progress.done / progress.total) * 100);
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-1"
      title={`${progress.done} de ${progress.total} concluídos abaixo desta branch`}
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
  editing,
  onToggleCollapsed,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onNewBranch,
  body,
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
  editing: boolean;
  onToggleCollapsed: () => void;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommitEdit: (text: string) => void;
  onCancelEdit: () => void;
  onNewBranch: () => void;
  /** v1.2: corpo do nó operacional (null = data + progresso de sempre). */
  body?: ReactNode | null;
}) {
  const task = node.refId ? (actx.taskById.get(node.refId) ?? null) : null;
  const done = isCheckable(node) && isDone(node);
  const editable = isTextEditable(node);
  const synthetic = isSynthetic(node.id);
  return (
    <div
      data-tree-node={node.id}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={box.hasChildren ? !collapsed : undefined}
      aria-label={`${TREE_NODE_KIND_LABELS[node.kind]}: ${node.label}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group bg-card absolute flex flex-col gap-1 rounded-lg border-2 px-2 py-1.5 shadow-sm transition-[opacity,box-shadow]",
        KIND_TONE[node.kind] ?? "border-muted",
        node.goal && "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
        synthetic ? "cursor-default" : "cursor-move",
        selected && "ring-primary ring-2 ring-offset-1",
        onPath && "ring-primary/60 ring-2",
        dropTarget && "ring-2 ring-emerald-500 ring-offset-2",
        dragging && "z-10 opacity-80 shadow-lg",
        // Editando, o card cresce por cima dos vizinhos sem mexer no layout.
        editing && "z-20 shadow-lg",
        dim && !editing && "opacity-35"
      )}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        ...(editing ? { minHeight: box.h } : { height: box.h }),
      }}
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
        {!synthetic ? (
          <button
            type="button"
            data-no-drag
            onClick={onNewBranch}
            aria-label="Nova branch a partir deste nó"
            title="Nova branch a partir deste nó"
            className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[on=true]:opacity-100"
            data-on={selected}
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
        {box.hasChildren ? (
          <button
            type="button"
            data-no-drag
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expandir branch" : "Recolher branch"}
            title={collapsed ? "Expandir branch" : "Recolher branch"}
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
      {editing ? (
        <CardTextarea
          initial={node.kind === "comment" ? (node.body ?? node.label) : node.label}
          onCommit={(text) => (text ? onCommitEdit(text) : onCancelEdit())}
          onCancel={onCancelEdit}
        />
      ) : (
        <button
          type="button"
          onClick={editable ? onStartEdit : onSelect}
          className={cn(
            "line-clamp-2 shrink-0 text-left text-xs leading-snug font-medium",
            editable && "hover:bg-accent/60 cursor-text rounded",
            done && "text-muted-foreground line-through"
          )}
          title={
            editable
              ? "Clique para editar o texto"
              : node.body
                ? `${node.label}\n\n${node.body}`
                : node.label
          }
          // O texto edita (ou seleciona); o resto do cartão arrasta.
          data-no-drag
        >
          {node.label}
        </button>
      )}
      {editing ? null : body ? (
        // v1.2: indicador/plano/ritual trazem o próprio corpo.
        <div className="min-h-0 flex-1 overflow-hidden">
          {body}
        </div>
      ) : (
        <div className="mt-auto flex items-center gap-1.5">
          {node.at || task ? <NodeDate node={node} task={task} /> : null}
          <ProgressBar progress={progress} />
        </div>
      )}
    </div>
  );
}

/**
 * A barra do nó SELECIONADO: o caminho até o Resultado, quanto falta, a
 * direção da branch e as ações de sempre do nó. O TEXTO se edita no próprio
 * card (v1.1) — aqui ficou só o que não cabe nele.
 */
function SelectedBar({
  node,
  parent,
  nodes,
  nodeById,
  geometry,
  direction,
  actx,
  onNewBranch,
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
  actx: NodeActionsContext;
  onNewBranch: () => void;
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
        <span className="min-w-0 flex-1 truncate font-medium" title={node.label}>
          {node.label}
        </span>
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
            <span className="text-muted-foreground ml-1">Branches:</span>
            {(["h", "v"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                variant={direction === d ? "secondary" : "ghost"}
                size="icon"
                className="size-7"
                aria-label={`Branches abrem ${TREE_DIRECTION_LABELS[d].toLowerCase()}`}
                title={`Branches abrem ${TREE_DIRECTION_LABELS[d].toLowerCase()}`}
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
                title="Esta branch deixa de depender da de cima"
                onClick={() => onReparent(node.id, null)}
              >
                <CornerLeftUp className="size-3.5" /> Tornar independente
              </Button>
            ) : null}
            {moved ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                title="Volta a branch para o lugar calculado"
                onClick={() => onMove(node.id, { x: 0, y: 0 })}
              >
                <Undo2 className="size-3.5" /> Voltar ao lugar
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={onNewBranch}
            >
              <Plus className="size-3.5" /> Nova branch
            </Button>
          </>
        ) : null}

        <NodeActions node={node} actx={actx} />
      </div>
    </div>
  );
}
