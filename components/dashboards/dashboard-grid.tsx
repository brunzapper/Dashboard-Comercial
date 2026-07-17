// Versão: 2.8 | Data: 16/07/2026
// Grid drag-and-drop dos widgets (react-grid-layout v2 via wrapper /legacy,
// API v1 familiar). No modo edição persiste o layout via saveLayout.
// v2.8 (16/07/2026): pan extraído para o hook compartilhado lib/use-drag-pan
//   (reusado na tabela de Registros); comportamento idêntico — guardas de
//   drawMode/.react-grid-item/[data-conn-ui] preservadas.
// v2.7 (16/07/2026): menu do clique-direito no vazio ganhou "Inserir ▸" (Nota
//   post-it / Tabela livre) e "Calculadora" (4×9, mais quadrada), criados NA
//   célula clicada via onQuickCreate (criação rápida/otimista no shell);
//   pasteAt guarda a célula CRUA e cada ação clampa pela própria largura;
//   repasse de onWidgetDeleted ao WidgetCard (X da calculadora).
// v2.6 (15/07/2026): modo "desenhar para criar" (Tabela Livre) — overlay de
//   mira sobre o canvas (drawMode/onDrawDone/onDrawCancel), pan/menu/drag
//   suspensos durante o desenho, canvas renderiza mesmo sem widgets; repasse
//   de tableCellsById aos cards.
// v2.5 (15/07/2026): clique nas linhas de conexão destravado — o container do
//   RGL (div transparente sobre o canvas inteiro, acima do SVG dos conectores)
//   engolia o clique nas linhas e armava o pan; agora é pointer-events-none e
//   cada item reabilita com pointer-events-auto.
// v2.4 (15/07/2026): conectores (ConnectorLayer sob os cards; pontas seguem o
//   gesto via onDrag/onResize → apiRef, sem tocar o estado do grid), id de DOM
//   por item (widget-<id>, alvo do focus/atalhos), guarda [data-conn-ui] no
//   pan/menu de colar, e repasse de calcVarsById/noteById/calcExprById.
// v2.3 (15/07/2026): as posições base vêm do estado otimista do shell
//   (layoutById em dashboard-client) em vez da prop do servidor — como
//   saveLayout não revalida, a prop ficava obsoleta e qualquer re-render
//   (ex.: medição tardia do autoSize) devolvia o widget arrastado à posição
//   antiga. Os vizinhos empurrados pelo RGL durante o gesto agora também
//   persistem (delta aplicado à base de cada um); antes só o item manipulado
//   era salvo e os demais "pulavam" de volta. Medições que chegam DURANTE um
//   gesto ficam em buffer e só aplicam no fim (a prop layout não muda no meio
//   do arraste). Alternativa avaliada: preventCollision={true} eliminaria o
//   empurrão, mas o desejado é que os vizinhos se reposicionem — e fiquem lá.
// v2.2 (13/07/2026): dimensões dinâmicas não sobrepõem mais os vizinhos. O layout
//   enviado ao RGL passa por pushApart, que empurra os vizinhos no eixo do
//   crescimento (largura → direita, altura → baixo). Como é função determinística
//   da base, o colapso devolve todos à posição base. A persistência grava sempre a
//   base, para o deslocamento automático não derivar.
// v2.1 (12/07/2026): compactType={null} — sem compactação vertical, então os
//   widgets ficam livres nos dois eixos (X e Y). Ao soltar sobre outro, empurra
//   o vizinho (preventCollision no padrão false).
// v2.0 (12/07/2026): área de trabalho redimensionável. Em vez de WidthProvider
//   (largura travada = tela ÷ colunas), a largura é calculada mantendo o tamanho
//   de célula das 12 colunas, e uma alça de canto (modo edição) aumenta cols/rows
//   do canvas — que ganha rolagem quando passa da tela. Tamanho por dashboard em
//   settings.canvas ({ cols, rows, rowHeight }).
"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  ChevronRight,
  ClipboardPaste,
  Loader2,
  Plus,
  StickyNote,
  Table2,
} from "lucide-react";
import RGL from "react-grid-layout/legacy";
import type { Layout, LayoutItem } from "react-grid-layout/legacy";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { cn } from "@/lib/utils";
import { useDragPan } from "@/lib/use-drag-pan";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type {
  CalcWidgetResult,
  Connector,
  DashboardSettings,
  FieldFilterOptions,
  GridPosition,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import { widgetDomId } from "@/lib/widgets/focus";
import type { DateFormat } from "@/lib/widgets/format";
import type { CurrencyRates } from "@/lib/widgets/currency";
import type { WidgetQuickFilters } from "@/lib/widgets/quick-filters";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import {
  createWidget,
  saveLayout,
  updateDashboardSettings,
  type WidgetInput,
} from "@/app/(app)/dashboards/actions";
import { readCopiedWidget } from "@/lib/widgets/clipboard";
import { posOf } from "@/lib/widgets/grid-placement";
import { defaultQuickTable } from "@/lib/widgets/quick-table/model";
import { useDashboardHistory } from "./history-context";
import { useNavPending } from "./pending-context";
import { FloatingPanel, MenuBtn } from "./appearance-editing";
import { DrawToCreateOverlay } from "./draw-to-create";
import { ConnectorLayer, type ConnectorLayerApi } from "./connector-layer";
import { WidgetCard } from "./widget-card";
import type { ResponsibleOption } from "./charts/record-list-table";

// Margens do grid e limites do canvas (mesmos valores de sempre).
const MX = 12;
const MY = 12;
const DEFAULT_ROW_H = 30;
const MIN_COLS = 12;
const MAX_COLS = 48;
const MIN_ROWS = 8;
const MAX_ROWS = 200;

// Item do resolvedor de colisões: posição/tamanho corrente (x/y/w/h, com w/h já
// inflados) mais a "pegada" base (bx/by/bw/bh, o tamanho mínimo persistido). A base
// serve para decidir o eixo de empurrão a partir de como os dois estavam separados
// ORIGINALMENTE (lado a lado → empurra na horizontal; empilhados → na vertical).
type ResolveItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
};

// Sobreposição de dois retângulos do grid (bordas estritas: encostar não colide).
function collides(a: ResolveItem, b: ResolveItem): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// Resolve as sobreposições criadas pela inflação (dimensões dinâmicas) empurrando
// os vizinhos NO EIXO DO CRESCIMENTO: largura empurra à direita, altura para baixo.
// É uma função pura de (pegadas base + tamanhos inflados) — determinística, então
// ao colapsar (sem inflação → sem colisão) todos voltam exatamente à base.
//
// Cada empurrão só ocorre no eixo em que os dois estavam SEPARADOS na base, para que
// crescer só a altura não empurre ninguém para o lado (e vice-versa). Como no layout
// base nenhum par se sobrepõe, todo par colidente estava separado em ao menos um eixo.
// Dois passos: horizontal (largura), depois vertical (altura), usando os x resolvidos.
function pushApart(items: readonly ResolveItem[]): ResolveItem[] {
  const byI = (a: ResolveItem, b: ResolveItem) =>
    a.i < b.i ? -1 : a.i > b.i ? 1 : 0;
  // p estava totalmente à esquerda / acima de c na base (pegada mínima).
  const leftOf = (p: ResolveItem, c: ResolveItem) => p.bx + p.bw <= c.bx;
  const above = (p: ResolveItem, c: ResolveItem) => p.by + p.bh <= c.by;

  // Passo horizontal: ancora os mais à esquerda; empurra à direita só quem estava
  // à direita na base (crescimento de largura).
  const byX = [...items].sort((a, b) => a.bx - b.bx || a.by - b.by || byI(a, b));
  const placedX: ResolveItem[] = [];
  for (const it of byX) {
    const cur = { ...it };
    let moved = true;
    while (moved) {
      moved = false;
      for (const p of placedX) {
        if (collides(cur, p) && leftOf(p, cur)) {
          cur.x = p.x + p.w;
          moved = true;
        }
      }
    }
    placedX.push(cur);
  }

  // Passo vertical: com os x resolvidos, ancora os mais acima; empurra para baixo só
  // quem estava abaixo na base (crescimento de altura).
  const byY = [...placedX].sort((a, b) => a.by - b.by || a.bx - b.bx || byI(a, b));
  const placedY: ResolveItem[] = [];
  for (const it of byY) {
    const cur = { ...it };
    let moved = true;
    while (moved) {
      moved = false;
      for (const p of placedY) {
        if (collides(cur, p) && above(p, cur)) {
          cur.y = p.y + p.h;
          moved = true;
        }
      }
    }
    placedY.push(cur);
  }

  return placedY;
}

export function DashboardGrid({
  widgets,
  dataById,
  recordListById,
  entityListById,
  calcById,
  fields,
  fkLabels,
  responsibleOptions,
  userRoles,
  canEditValues,
  available,
  availableForBuilder,
  dashboardId,
  dateFormat,
  settings,
  tabs,
  activeTabId,
  canEdit,
  canExport = false,
  canManageFields = false,
  currencyOptions,
  currencyRates = {},
  conversionPeriodById = {},
  editMode,
  filterOptionsById,
  quickFiltersById,
  layoutById,
  applyLayoutPatch,
  calcVarsById = {},
  noteById = {},
  calcExprById = {},
  tableCellsById = {},
  connectors = [],
  saveConnectors,
  connectMode = false,
  drawMode = false,
  onDrawDone,
  onDrawCancel,
  onQuickCreate,
  onWidgetDeleted,
}: {
  widgets: Widget[];
  dataById: Record<string, WidgetData>;
  recordListById: Record<string, RecordRow[]>;
  entityListById: Record<string, EntityListRow[]>;
  calcById: Record<string, CalcWidgetResult>;
  fields: FieldDefinition[];
  fkLabels: Record<string, string>;
  responsibleOptions?: ResponsibleOption[];
  userRoles: string[];
  canEditValues: boolean;
  available: AvailableField[];
  // Lista COMPLETA (`available`) para renderização/filtros visíveis a todos; lista
  // filtrada pelo ACL por papel (`availableForBuilder`) para os seletores de edição.
  availableForBuilder: AvailableField[];
  dashboardId: string;
  dateFormat?: DateFormat;
  settings: DashboardSettings;
  tabs?: { id: string; name: string; color?: string }[];
  activeTabId?: string;
  canEdit: boolean;
  // Exibe "Exportar CSV" no menu ⋮ dos widgets. Fica DESLIGADO por padrão para
  // nunca vazar no viewer público de snapshots (snapshot-client não o passa).
  canExport?: boolean;
  canManageFields?: boolean;
  currencyOptions?: { value: string; label: string }[];
  currencyRates?: CurrencyRates;
  conversionPeriodById?: Record<string, { year: number; quarter: number }>;
  editMode: boolean;
  filterOptionsById?: Record<string, FieldFilterOptions>;
  quickFiltersById?: Record<string, WidgetQuickFilters>;
  // Estado otimista de layout (vive no shell — dashboard-client): posições BASE
  // por widget, fonte de verdade entre um saveLayout (que não revalida) e o
  // próximo refresh real. O grid lê via basePos() e escreve via applyLayoutPatch.
  layoutById: Record<string, GridPosition>;
  applyLayoutPatch: (patch: Record<string, GridPosition>) => void;
  calcVarsById?: Record<string, Record<string, CalcWidgetResult>>;
  noteById?: Record<string, CalcWidgetResult[]>;
  calcExprById?: Record<string, string>;
  // Tabela Livre: células digitadas por widget (rows não reservadas).
  tableCellsById?: Record<
    string,
    { row_key: string; col_key: string; value: number | string | null }[]
  >;
  // Conectores (todas as abas; a camada filtra pela ativa) + persistência
  // otimista no shell. connectMode = criar conexões (submodo da edição).
  connectors?: Connector[];
  saveConnectors?: (next: Connector[]) => void;
  connectMode?: boolean;
  // Modo "desenhar para criar" (Tabela Livre): overlay de mira sobre o canvas;
  // o retângulo desenhado vira grid_position + linhas/colunas da tabela.
  drawMode?: boolean;
  onDrawDone?: (
    rect: GridPosition,
    table: { rows: number; cols: number }
  ) => void;
  onDrawCancel?: () => void;
  // Criação RÁPIDA pelo menu de contexto (Inserir/Calculadora): o shell insere
  // sem revalidar e mostra o widget otimista na hora (ver dashboard-client).
  onQuickCreate?: (input: WidgetInput) => void;
  // Avisa o shell que um widget foi excluído (remove pendente otimista).
  onWidgetDeleted?: (id: string) => void;
}) {
  const { pending } = useNavPending();
  const history = useDashboardHistory();
  const router = useRouter();
  const [, startPaste] = useTransition();

  // Menu de contexto do clique-direito no espaço vazio (Inserir/Calculadora/
  // Colar widget). Guarda a posição do menu (clientX/Y) e a célula-alvo CRUA do
  // grid (gridX/Y, sem clamp — cada ação clampa pela largura do próprio
  // widget). `hasCopy` é lido no momento da abertura para refletir o
  // localStorage (funciona entre abas).
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [pasteAt, setPasteAt] = useState<{
    x: number;
    y: number;
    gridX: number;
    gridY: number;
    hasCopy: boolean;
  } | null>(null);
  // Flyout "Inserir ▸" aberto? Reseta a cada abertura do menu.
  const [insertOpen, setInsertOpen] = useState(false);

  // Dimensões dinâmicas: tamanho medido do conteúdo (unidades do grid), por
  // widget, reportado pelos cards. Só infla a renderização — o `grid_position`
  // gravado segue sendo o mínimo (ver onDragStop/onResizeStop).
  const [measured, setMeasured] = useState<
    Record<string, { w: number; h: number }>
  >({});
  // Histerese anti-oscilação: crescer aplica na hora; encolher só quando a
  // diferença é ≥ 2 unidades. Evita o ping-pong de ±1 unidade quando o chrome
  // do card (título quebrando linha etc.) muda ao inflar/desinflar.
  const applyMeasure = useCallback((id: string, w: number, h: number) => {
    setMeasured((prev) => {
      const cur = prev[id];
      if (!cur) return { ...prev, [id]: { w, h } };
      const nw = w >= cur.w || cur.w - w >= 2 ? w : cur.w;
      const nh = h >= cur.h || cur.h - h >= 2 ? h : cur.h;
      if (nw === cur.w && nh === cur.h) return prev;
      return { ...prev, [id]: { w: nw, h: nh } };
    });
  }, []);
  // Medições que chegam DURANTE um arraste/redimensionamento ficam em buffer e
  // só aplicam quando o gesto termina — trocar a prop `layout` do RGL no meio
  // do gesto faz os widgets saltarem.
  const interactingRef = useRef(false);
  const pendingMeasureRef = useRef<Record<string, { w: number; h: number }>>({});
  const onMeasure = useCallback(
    (id: string, w: number, h: number) => {
      if (interactingRef.current) {
        pendingMeasureRef.current[id] = { w, h };
        return;
      }
      applyMeasure(id, w, h);
    },
    [applyMeasure]
  );
  const flushPendingMeasures = useCallback(() => {
    const pend = pendingMeasureRef.current;
    pendingMeasureRef.current = {};
    for (const [id, m] of Object.entries(pend)) applyMeasure(id, m.w, m.h);
  }, [applyMeasure]);

  // Posição base efetiva: o estado otimista do shell quando existe (sempre, fora
  // de corridas de montagem); fallback na prop do servidor.
  const basePos = useCallback(
    (w: Widget, i: number): GridPosition => layoutById[w.id] ?? posOf(w, i),
    [layoutById]
  );

  // Layout efetivo (o que vai pro RGL): max(mínimo, medido) no eixo habilitado, e
  // então um passo de resolução de colisões que empurra os vizinhos no eixo do
  // crescimento (largura → direita, altura → baixo). Determinístico: ao colapsar,
  // some a inflação, some a colisão e todos voltam à base.
  const inflated: ResolveItem[] = widgets.map((w, i) => {
    const p = basePos(w, i);
    const a = w.settings?.autoSize;
    const m = measured[w.id];
    const ew = a?.width && m ? Math.max(p.w, m.w) : p.w;
    const eh = a?.height && m ? Math.max(p.h, m.h) : p.h;
    return { i: w.id, x: p.x, y: p.y, w: ew, h: eh, bx: p.x, by: p.y, bw: p.w, bh: p.h };
  });
  const layout: Layout = pushApart(inflated).map(({ i, x, y, w, h }) => ({
    i,
    x,
    y,
    w,
    h,
  }));

  // Extensão do conteúdo — pisos para não cortar widgets ao encolher a área.
  const contentRight = layout.reduce((m, l) => Math.max(m, l.x + l.w), MIN_COLS);
  const contentBottom = layout.reduce((m, l) => Math.max(m, l.y + l.h), MIN_ROWS);
  const ROW_H = settings.canvas?.rowHeight ?? DEFAULT_ROW_H;

  // Tamanho efetivo do canvas (vindo das settings): nunca abaixo do conteúdo,
  // nunca além dos limites.
  const propCols = Math.min(MAX_COLS, Math.max(contentRight, settings.canvas?.cols ?? MIN_COLS));
  const propRows = Math.min(MAX_ROWS, Math.max(contentBottom, settings.canvas?.rows ?? contentBottom));
  // Override transitório durante o arraste da alça (null fora do arraste → segue
  // as settings, então mudanças pelo menu refletem na hora).
  const [drag, setDrag] = useState<{ cols: number; rows: number } | null>(null);
  const cols = drag ? drag.cols : propCols;
  const rows = drag ? drag.rows : propRows;
  // Limpa o override assim que as settings do servidor alcançam o valor arrastado
  // (evita "piscar" de volta ao tamanho antigo enquanto revalida). Padrão do React
  // de ajustar estado no render — sem useEffect.
  if (drag && propCols === drag.cols && propRows === drag.rows) setDrag(null);

  // Largura visível (base das 12 colunas) medida do container de rolagem. Usamos
  // um callback ref (não um useEffect com deps []) porque o container do scroll é
  // DESMONTADO quando a aba fica sem widgets (early-return do estado vazio). Com o
  // effect de mount único, ao voltar para uma aba populada o novo nó nunca era
  // re-medido e `baseWidth` ficava em 0 → grid renderizava vazio. O callback ref
  // re-liga o ResizeObserver a cada remontagem; a guarda `w > 0` evita zerar
  // quando o nó é destacado (clientWidth 0).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [baseWidth, setBaseWidth] = useState(0);
  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setBaseWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => roRef.current?.disconnect(), []);

  // Pan ("mãozinha"): arrastar o espaço vazio com o botão esquerdo rola o
  // dashboard nos dois eixos — horizontal no container do grid (scrollRef) e
  // vertical no ancestral rolável (<main>). Lógica compartilhada em
  // lib/use-drag-pan (limiar de ~4px, listeners no window, sem
  // setPointerCapture). Sobre um widget (`.react-grid-item`) ou na UI dos
  // conectores (âncoras/linhas/painel, `[data-conn-ui]`) não pega.
  const { panning, onPointerDown: panPointerDown } = useDragPan(scrollRef, {
    ignore: (t) => !!t.closest(".react-grid-item, [data-conn-ui]"),
  });

  // Célula constante: 12 colunas preenchem a largura visível (fórmula do RGL:
  // colWidth = (width - MX*(cols+1))/cols), então widgets não mudam de tamanho.
  const cellW = baseWidth > 0 ? (baseWidth - MX * (MIN_COLS + 1)) / MIN_COLS : 0;
  const gridW = (c: number) => c * cellW + MX * (c + 1);
  const gridH = (r: number) => r * ROW_H + MY * (r + 1);

  // Botão esquerdo no espaço vazio arma o pan (useDragPan). Durante o desenho
  // de criação o overlay é dono do gesto.
  function onCanvasPointerDown(e: React.PointerEvent) {
    if (drawMode) return; // o overlay de desenho é dono do gesto
    panPointerDown(e);
  }

  // Clique-direito no espaço vazio do grid → menu "Colar widget". Sobre um widget
  // (`.react-grid-item`) deixamos o menu nativo. A célula-alvo vem da posição do
  // clique via a mesma fórmula do RGL; o x é preso ao canvas (0..cols-w).
  function onCanvasContextMenu(e: React.MouseEvent) {
    if (!canEdit || drawMode) return;
    if ((e.target as HTMLElement).closest(".react-grid-item")) return;
    if ((e.target as HTMLElement).closest("[data-conn-ui]")) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || cellW <= 0) return;
    e.preventDefault();
    const gx = Math.max(0, Math.floor((e.clientX - rect.left - MX) / (cellW + MX)));
    const gy = Math.max(0, Math.floor((e.clientY - rect.top - MY) / (ROW_H + MY)));
    setInsertOpen(false);
    setPasteAt({
      x: e.clientX,
      y: e.clientY,
      gridX: gx,
      gridY: gy,
      hasCopy: !!readCopiedWidget(),
    });
  }

  function onPaste() {
    const copied = readCopiedWidget();
    const at = pasteAt;
    setPasteAt(null);
    if (!copied || !at) return;
    const input: WidgetInput = {
      title: copied.title,
      visual_type: copied.visual_type,
      sources: copied.sources,
      splitBySource: copied.splitBySource,
      dimensions: copied.dimensions,
      metrics: copied.metrics,
      filters: copied.filters,
      settings: { ...(copied.settings ?? {}), tab: activeTabId || undefined },
      grid_position: {
        x: Math.min(at.gridX, Math.max(0, cols - copied.w)),
        y: at.gridY,
        w: copied.w,
        h: copied.h,
      },
    };
    startPaste(async () => {
      await createWidget(dashboardId, input);
      router.refresh();
    });
  }

  // "Inserir ▸ Nota/Tabela livre" e "Calculadora": cria NA célula clicada, com
  // os mesmos defaults do builder. A calculadora nasce mais "quadrada" (4×9 ≈
  // 416×366px com célula ~92px/linha 42px) que o padrão 6×8, e já com título.
  function insertAt(kind: "nota" | "tabela_editavel" | "calculadora") {
    const at = pasteAt;
    setPasteAt(null);
    if (!at || !onQuickCreate) return;
    const w = kind === "calculadora" ? 4 : 6;
    const h = kind === "calculadora" ? 9 : 8;
    const title =
      kind === "nota"
        ? "Nota"
        : kind === "tabela_editavel"
          ? "Tabela Livre"
          : "Calculadora";
    onQuickCreate({
      title,
      visual_type: kind,
      sources: [],
      splitBySource: false,
      dimensions: [],
      metrics: [],
      filters: [],
      settings: {
        ...(activeTabId ? { tab: activeTabId } : {}),
        ...(kind === "tabela_editavel"
          ? { quickTable: defaultQuickTable(3, 3) }
          : {}),
        ...(kind === "calculadora" ? { calculator: { variables: [] } } : {}),
      },
      grid_position: {
        x: Math.min(at.gridX, Math.max(0, cols - w)),
        y: at.gridY,
        w,
        h,
      },
    });
  }

  // Persistência do layout: só em interações do usuário (arrastar/redimensionar),
  // e sempre gravando o tamanho/posição BASE, nunca o offset de inflação/pushApart
  // (que é derivado a cada render e sumiria/derivaria se fosse "assado" na base).
  //   • item manipulado: arraste → nova x/y + w/h da base; redimensiona → novo
  //     w/h + x/y da base (o handle é inferior/direito);
  //   • vizinhos empurrados pelo RGL durante o gesto: delta entre o layout final
  //     (next) e o que entregamos ao RGL (layout do render) aplicado à base de
  //     cada um — o empurrão do usuário persiste, o automático não.
  // O patch aplica no estado otimista do shell (applyLayoutPatch) na hora — como
  // saveLayout não revalida (edição fluida), a prop do servidor fica obsoleta e
  // era ela que fazia os widgets "voltarem" no próximo re-render. Após persistir,
  // registra no histórico. Obs.: widgets com autoSize podem "assentar" um render
  // depois do drop (a base nova repassa por inflação+pushApart) — determinístico.
  function persist(
    next: Layout,
    changed: LayoutItem | null,
    kind: "drag" | "resize"
  ) {
    if (!editMode) return;
    const patch: Record<string, GridPosition> = {};
    widgets.forEach((w, i) => {
      const base = basePos(w, i);
      let nb: GridPosition | null = null;
      if (changed && changed.i === w.id) {
        nb =
          kind === "resize"
            ? { x: base.x, y: base.y, w: changed.w, h: changed.h }
            : { x: changed.x, y: changed.y, w: base.w, h: base.h };
      } else {
        const given = layout.find((l) => l.i === w.id);
        const nl = next.find((l) => l.i === w.id);
        if (given && nl) {
          const dx = nl.x - given.x;
          const dy = nl.y - given.y;
          if (dx !== 0 || dy !== 0) {
            nb = {
              x: Math.max(0, base.x + dx),
              y: Math.max(0, base.y + dy),
              w: base.w,
              h: base.h,
            };
          }
        }
      }
      if (
        nb &&
        (nb.x !== base.x || nb.y !== base.y || nb.w !== base.w || nb.h !== base.h)
      ) {
        patch[w.id] = nb;
      }
    });
    if (Object.keys(patch).length === 0) return;
    applyLayoutPatch(patch);
    void saveLayout(
      dashboardId,
      Object.entries(patch).map(([id, p]) => ({
        id,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
      }))
    ).then(() => history.captureNow());
  }
  // Pontas dos conectores acompanham o gesto AO VIVO: onDrag/onResize entregam
  // o layout transitório só à camada de conectores (via apiRef) — nunca ao
  // estado do grid (trocar a prop `layout` do RGL no meio do gesto faz os
  // widgets saltarem; ver v2.3).
  const connApiRef = useRef<ConnectorLayerApi | null>(null);
  function onDragStart() {
    interactingRef.current = true;
  }
  function onResizeStart() {
    interactingRef.current = true;
  }
  function onLiveLayout(next: Layout) {
    connApiRef.current?.setLive(next);
  }
  function onDragStop(
    next: Layout,
    _old: LayoutItem | null,
    item: LayoutItem | null
  ) {
    interactingRef.current = false;
    connApiRef.current?.setLive(null);
    persist(next, item, "drag");
    flushPendingMeasures();
  }
  function onResizeStop(
    next: Layout,
    _old: LayoutItem | null,
    item: LayoutItem | null
  ) {
    interactingRef.current = false;
    connApiRef.current?.setLive(null);
    persist(next, item, "resize");
    flushPendingMeasures();
  }

  // Alças de borda: a barra inferior arrasta a ALTURA (rows), a barra direita a
  // LARGURA (cols). Persiste ao soltar, preservando as demais settings (rowHeight,
  // background, abas, …).
  const dragRef = useRef<
    { x: number; y: number; cols: number; rows: number; axis: "row" | "col" } | null
  >(null);
  const lastRef = useRef<{ cols: number; rows: number } | null>(null);
  function onHandleDown(e: React.PointerEvent, axis: "row" | "col") {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { x: e.clientX, y: e.clientY, cols, rows, axis };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onHandleMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || cellW <= 0) return;
    const nextCols =
      d.axis === "col"
        ? Math.min(MAX_COLS, Math.max(contentRight, d.cols + Math.round((e.clientX - d.x) / (cellW + MX))))
        : d.cols;
    const nextRows =
      d.axis === "row"
        ? Math.min(MAX_ROWS, Math.max(contentBottom, d.rows + Math.round((e.clientY - d.y) / (ROW_H + MY))))
        : d.rows;
    const next = { cols: nextCols, rows: nextRows };
    lastRef.current = next;
    setDrag(next);
  }
  function onHandleUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture pode já ter sido liberada
    }
    const last = lastRef.current;
    if (!last) return;
    void updateDashboardSettings(dashboardId, {
      ...settings,
      canvas: { ...settings.canvas, cols: last.cols, rows: last.rows },
    });
  }

  // Menu flutuante do clique-direito (compartilhado entre o estado vazio e o
  // grid): Inserir ▸ (Nota/Tabela livre), Calculadora e Colar widget.
  // Reaproveita FloatingPanel (posiciona no clique, fecha ao clicar fora).
  const pasteMenu = pasteAt ? (
    <FloatingPanel x={pasteAt.x} y={pasteAt.y} onClose={() => setPasteAt(null)} className="w-48">
      {onQuickCreate ? (
        <>
          <div
            className="relative"
            onMouseEnter={() => setInsertOpen(true)}
            onMouseLeave={() => setInsertOpen(false)}
          >
            <MenuBtn onClick={() => setInsertOpen((v) => !v)}>
              <Plus />
              <span className="flex-1">Inserir</span>
              <ChevronRight />
            </MenuBtn>
            {insertOpen ? (
              <div
                className={cn(
                  "bg-popover text-popover-foreground absolute top-0 z-50 w-44 rounded-md border p-2 shadow-md",
                  // Flip para a esquerda quando o menu está colado na borda
                  // direita da viewport (o flyout estouraria a tela).
                  pasteAt.x > window.innerWidth - 400
                    ? "right-full mr-1"
                    : "left-full ml-1"
                )}
              >
                <MenuBtn onClick={() => insertAt("nota")}>
                  <StickyNote />
                  <span className="flex-1">Nota (Post-it)</span>
                </MenuBtn>
                <MenuBtn onClick={() => insertAt("tabela_editavel")}>
                  <Table2 />
                  <span className="flex-1">Tabela livre</span>
                </MenuBtn>
              </div>
            ) : null}
          </div>
          <MenuBtn onClick={() => insertAt("calculadora")}>
            <Calculator />
            <span className="flex-1">Calculadora</span>
          </MenuBtn>
          <div className="bg-border my-1 h-px" />
        </>
      ) : null}
      <button
        type="button"
        disabled={!pasteAt.hasCopy}
        onClick={onPaste}
        className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4"
      >
        <ClipboardPaste />
        <span className="flex-1">Colar widget</span>
      </button>
      {!pasteAt.hasCopy ? (
        <p className="text-muted-foreground px-2 pt-1 text-xs">Nada copiado</p>
      ) : null}
    </FloatingPanel>
  ) : null;

  // Em drawMode o canvas renderiza mesmo vazio (é onde se desenha a tabela).
  if (widgets.length === 0 && !drawMode) {
    return (
      <>
        <div
          onContextMenu={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            setInsertOpen(false);
            setPasteAt({
              x: e.clientX,
              y: e.clientY,
              gridX: 0,
              gridY: 0,
              hasCopy: !!readCopiedWidget(),
            });
          }}
          className="text-muted-foreground rounded-lg border p-8 text-center text-sm"
        >
          Nenhum widget ainda. {canEdit ? "Adicione o primeiro." : ""}
        </div>
        {pasteMenu}
      </>
    );
  }

  return (
    <div className="relative">
      {/* Overlay de recarregamento: aparece enquanto o servidor recomputa os
          widgets após uma mudança de período/filtro. */}
      {pending ? (
        <div className="bg-background/50 absolute inset-0 z-20 flex items-start justify-center rounded-lg backdrop-blur-[1px]">
          <div className="bg-background text-muted-foreground mt-6 flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-sm">
            <Loader2 className="size-4 animate-spin" />
            Carregando…
          </div>
        </div>
      ) : null}
      {/* Container de rolagem: a largura do grid pode passar da tela → rolagem
          horizontal; a altura é explícita, então a página cresce normalmente. */}
      <div ref={setScrollEl} className="overflow-x-auto overflow-y-hidden">
        {baseWidth > 0 ? (
          <div
            ref={canvasRef}
            onContextMenu={onCanvasContextMenu}
            onPointerDown={onCanvasPointerDown}
            className={cn(
              "relative",
              panning ? "cursor-grabbing" : "cursor-grab",
              editMode &&
                "rounded-md border border-dashed border-primary/40 bg-primary/[0.02]"
            )}
            style={{ width: gridW(cols), height: gridH(rows) }}
          >
            {/* Linhas entre widgets: antes do RGL no DOM = pintam SOB os cards
                (as âncoras de criação têm z próprio, acima). */}
            {saveConnectors ? (
              <ConnectorLayer
                connectors={connectors}
                layout={layout}
                widgets={widgets}
                metrics={{ cellW, rowH: ROW_H, mx: MX, my: MY }}
                tabs={tabs}
                activeTabId={activeTabId ?? ""}
                editMode={editMode}
                connectMode={connectMode}
                onChange={saveConnectors}
                apiRef={connApiRef}
              />
            ) : null}
            <RGL
              className={cn(
                // pointer-events-none: o container do RGL é um div transparente
                // que cobre o canvas INTEIRO por cima da camada de conectores
                // (vem depois no DOM) — sem isso ele engole o clique nas linhas
                // (e o pan armava no lugar). Os itens reabilitam abaixo.
                "layout transition-opacity pointer-events-none",
                pending && "opacity-60"
              )}
              layout={layout}
              cols={cols}
              width={gridW(cols)}
              maxRows={rows}
              rowHeight={ROW_H}
              compactType={null}
              margin={[MX, MY]}
              containerPadding={[MX, MY]}
              autoSize={false}
              style={{ height: gridH(rows) }}
              isDraggable={editMode && !drawMode}
              isResizable={editMode && !drawMode}
              draggableHandle=".widget-drag"
              onDragStart={onDragStart}
              onResizeStart={onResizeStart}
              onDrag={onLiveLayout}
              onResize={onLiveLayout}
              onDragStop={onDragStop}
              onResizeStop={onResizeStop}
            >
              {widgets.map((w) => (
                <div
                  key={w.id}
                  id={widgetDomId(w.id)}
                  className="pointer-events-auto cursor-auto"
                >
                  <WidgetCard
                    widget={w}
                    data={dataById[w.id] ?? { rows: [], dimensions: [], metrics: [] }}
                    recordList={recordListById[w.id] ?? []}
                    entityList={entityListById[w.id] ?? []}
                    calcValue={calcById[w.id] ?? null}
                    calcVars={calcVarsById[w.id]}
                    noteValues={noteById[w.id]}
                    calcExpr={calcExprById[w.id]}
                    tableCells={tableCellsById[w.id]}
                    fields={fields}
                    currencyOptions={currencyOptions}
                    currencyRates={currencyRates}
                    conversionPeriod={conversionPeriodById[w.id]}
                    fkLabels={fkLabels}
                    responsibleOptions={responsibleOptions}
                    userRoles={userRoles}
                    canEditValues={canEditValues}
                    available={available}
                    availableForBuilder={availableForBuilder}
                    dashboardId={dashboardId}
                    dateFormat={dateFormat}
                    siblings={widgets}
                    tabs={tabs}
                    canEdit={canEdit}
                    canExport={canExport}
                    canManageFields={canManageFields}
                    editMode={editMode}
                    filterOptions={filterOptionsById?.[w.id]}
                    quickFilters={quickFiltersById?.[w.id]}
                    autoSize={w.settings?.autoSize}
                    cellW={cellW}
                    rowH={ROW_H}
                    mx={MX}
                    my={MY}
                    onMeasure={onMeasure}
                    onWidgetDeleted={onWidgetDeleted}
                  />
                </div>
              ))}
            </RGL>
            {drawMode && onDrawDone && onDrawCancel ? (
              <DrawToCreateOverlay
                cellW={cellW}
                rowH={ROW_H}
                mx={MX}
                my={MY}
                cols={cols}
                rows={rows}
                onDone={onDrawDone}
                onCancel={onDrawCancel}
              />
            ) : null}
            {editMode && !drawMode ? (
              <>
                {/* Barra inferior: arrasta a ALTURA (adiciona linhas vazias). */}
                <span
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Arraste para aumentar a altura da área"
                  title="Arraste para aumentar a altura da área"
                  onPointerDown={(e) => onHandleDown(e, "row")}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  className={cn(
                    "absolute bottom-0 left-0 z-20 flex h-3 w-full items-center justify-center",
                    "cursor-ns-resize touch-none rounded-b-md bg-primary/15 hover:bg-primary/30",
                    "before:h-0.5 before:w-8 before:rounded-full before:bg-primary/60 before:content-['']"
                  )}
                />
                {/* Barra direita: arrasta a LARGURA. */}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Arraste para aumentar a largura da área"
                  title="Arraste para aumentar a largura da área"
                  onPointerDown={(e) => onHandleDown(e, "col")}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  className={cn(
                    "absolute top-0 right-0 z-20 flex h-full w-3 items-center justify-center",
                    "cursor-ew-resize touch-none rounded-r-md bg-primary/15 hover:bg-primary/30",
                    "before:h-8 before:w-0.5 before:rounded-full before:bg-primary/60 before:content-['']"
                  )}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {pasteMenu}
    </div>
  );
}
