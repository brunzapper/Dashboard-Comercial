// Versão: 2.20 | Data: 03/08/2026
// v2.20 (03/08/2026): Ponteiro Laser (modo apresentação) — clique-direito
//   SOBRE um widget abre o menu do apresentador (ativar/desativar o laser —
//   disponível a qualquer usuário — e "Editar layout"/"Concluir edição" para
//   canEdit, via onToggleEditMode). Com o modo ativo, LaserPointerOverlay
//   cobre o canvas (pan/menus suspensos, como drawMode/placing); props
//   opcionais — o viewer de snapshots não as passa e nada muda lá.
// v2.19 (03/08/2026): prop boardWidgets (TODAS as abas) repassada a
//   WidgetCard/LineLayer → WidgetBuilder (listas "Aplicar a" dos filtros);
//   `widgets` segue sendo só a aba visível.
// v2.18 (26/07/2026): engine deferido — repassa deferredPendingIds →
//   WidgetCard.deferredPending (overlay "Atualizando…" por card).
// v2.17 (26/07/2026): repassa recordListWindowTotalById → WidgetCard
//   (janela incremental do modo lista full-fetch; record-list v2.0).
// Grid drag-and-drop dos widgets (react-grid-layout v2 via wrapper /legacy,
// API v1 familiar). No modo edição persiste o layout via saveLayout.
// v2.16 (25/07/2026): mescla com efeito IMEDIATO — pendingMerges/effWidgets
//   aplicam a mescla otimista no cliente (membro some, pager aparece) antes do
//   router.refresh aterrissar; performMerge compartilhado pelo diálogo do drop
//   e pelo ⋮ → "Adicionar página" (prop onMergePages do WidgetCard); falha da
//   action faz rollback.
// v2.15 (25/07/2026): PÁGINAS de widget (mescla — lib/widgets/pages): membros
//   (settings.pages de um host) saem de gridWidgets (ocultos em TODOS os
//   consumidores — layout/persist/children/conectores/extensão); o host
//   renderiza a página ativa (estado efêmero pageIndexByHost + WidgetPager
//   acima do card, também no viewer de snapshot); drop quase-em-cima de outro
//   widget de tamanho parecido abre o diálogo "Adicionar página?"
//   (findMergeTarget em persist → mergeWidgetPages) — confirmar mescla,
//   cancelar DESFAZE o arraste (a posição solta nunca persiste).
// v2.14 (25/07/2026): grade FINA (espaço v2 — lib/widgets/grid-space): célula
//   ancorada em canvas.baseCols (default 120, 10× as 12 de antes), SEM margens
//   (MX/MY = 0 — as fórmulas paramétricas seguem valendo) e linha default
//   QUADRADA (ROW_H = canvas.rowHeight ?? cellW — por isso ROW_H é computado
//   após cellW). Limites do canvas em unidades finas (480×800, mín. 32
//   linhas). As settings/widgets chegam aqui JÁ normalizados para o espaço
//   fino (normalizeGridSpace na page/viewer) — o grid não converte nada.
// v2.13 (25/07/2026): paste da linha divisória via isLineShapeWidget — cobre
//   o tipo novo ('linha_divisoria', 0100) e payloads antigos de clipboard.
// v2.12 (22/07/2026): NADA se move durante o gesto — allowOverlap no RGL (o
//   moveElement interno retorna cedo em colisão: só o item manipulado anda; o
//   placeholder segue o cursor). O "abrir espaço" acontece SÓ ao soltar:
//   resolveDropCollisions (novo, ao lado de pushApart) move cada vizinho
//   sobreposto o MÍNIMO necessário (direção de menor custo, desempate
//   baixo→direita→esquerda→cima; cascata determinística), e persist() grava o
//   item solto + esses vizinhos. Substitui o empurrão ao vivo do RGL (delta de
//   vizinhos do v2.3) que espalhava widgets além do necessário.
// v2.11 (18/07/2026): fontes por métrica — recordListExtraById repassado ao
//   WidgetCard (extras p/ basis de subtotais; ver runRecordListWithExtras).
// v2.10 (17/07/2026): arraste das alças da área de trabalho fluido — guard de
//   igualdade no onHandleMove (re-render só ao cruzar limite de célula, antes
//   era a cada pointermove), transition de width/height durante o arraste,
//   chip "cols × linhas" ao vivo na alça ativa e clique parado não persiste.
// v2.9 (17/07/2026): modo Posicionar (PlaceWidgetOverlay — ghost centrado no
//   cursor; pan/menu/drag suspensos como no drawMode; canvas renderiza mesmo
//   vazio) e "Inserir ▸" com TODOS os tipos + busca (InsertTypeMenu; insertAt
//   generalizado com defaults de lib/widgets/widget-defaults e posição com o
//   centro na célula clicada via centerAnchored; tipos que exigem config abrem
//   o editor na sequência — autoEditWidgetId repassado ao WidgetCard).
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronRight,
  ClipboardPaste,
  Loader2,
  Pencil,
  Plus,
  Presentation,
} from "lucide-react";
import RGL from "react-grid-layout/legacy";
import type { Layout, LayoutItem } from "react-grid-layout/legacy";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { cn } from "@/lib/utils";
import { notifyOnError } from "@/lib/feedback/notify";
import { useDragPan } from "@/lib/use-drag-pan";
import { DEFAULT_LASER } from "@/lib/theme";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type {
  CalcWidgetResult,
  Connector,
  DashboardSettings,
  FieldFilterOptions,
  GridPosition,
  ShapeLine,
  VisualType,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import { widgetDomId } from "@/lib/widgets/focus";
import type { DateFormat } from "@/lib/widgets/format";
import type { CurrencyRates } from "@/lib/widgets/currency";
import type { WidgetQuickFilters } from "@/lib/widgets/quick-filters";
import type { WidgetPeriodWindowState } from "./period-window-control";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import {
  createWidget,
  mergeWidgetPages,
  saveLayout,
  saveShapeLine,
  updateDashboardSettings,
  type WidgetInput,
} from "@/app/(app)/dashboards/actions";
import {
  collectPageMembers,
  findMergeTarget,
  pageMembersOf,
} from "@/lib/widgets/pages";
import { MergePromptDialog, WidgetPager } from "./widget-pages";
import { readCopiedWidget } from "@/lib/widgets/clipboard";
import {
  BASE_COLS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  GRID_MIN_ROWS,
} from "@/lib/widgets/grid-space";
import { centerAnchored, posOf } from "@/lib/widgets/grid-placement";
import {
  axisLock,
  clampLine,
  isLineShapeWidget,
  lineAtCell,
  lineGridBBox,
  lineOf,
  roundLine,
} from "@/lib/widgets/lines";
import {
  DEFAULT_WIDGET_SIZE,
  defaultWidgetSeed,
  WIDGET_NEEDS_CONFIG,
} from "@/lib/widgets/widget-defaults";
import { useDashboardHistory } from "./history-context";
import { useNavPending } from "./pending-context";
import { FloatingPanel, MenuBtn } from "./appearance-editing";
import { DrawToCreateOverlay } from "./draw-to-create";
import { PlaceWidgetOverlay } from "./place-widget-overlay";
import { LaserPointerOverlay } from "./laser-pointer-overlay";
import { InsertTypeMenu } from "./insert-type-menu";
import { ConnectorLayer, type ConnectorLayerApi } from "./connector-layer";
import { LineLayer } from "./line-layer";
import { FontScaleProvider } from "./font-scale-context";
import { BoardChromeProvider } from "./board-chrome-context";
import { WidgetCard } from "./widget-card";
import type { ResponsibleOption } from "./charts/record-list-table";

// Grade fina (espaço v2): SEM margens entre células — o respiro entre widgets
// vem das próprias posições (a conversão de layouts legados deixa 1 célula de
// vão; ver lib/widgets/grid-space). MX/MY ficam como constantes 0 porque todas
// as fórmulas px↔célula daqui e dos overlays são paramétricas nelas.
const MX = 0;
const MY = 0;

// Fallbacks ESTÁVEIS para os cards sem dados: um literal novo por render
// derrotaria o React.memo do WidgetCard (props sempre "diferentes").
const EMPTY_WIDGET_DATA: WidgetData = { rows: [], dimensions: [], metrics: [] };
const EMPTY_RECORD_LIST: RecordRow[] = [];
const EMPTY_ENTITY_LIST: EntityListRow[] = [];
const MAX_COLS = GRID_MAX_COLS;
const MIN_ROWS = GRID_MIN_ROWS;
const MAX_ROWS = GRID_MAX_ROWS;

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

// Retângulo simples do resolvedor de DROP (sem pegada base: aqui tudo opera
// sobre as bases persistidas — a inflação fica com o pushApart acima).
type DropRect = { i: string; x: number; y: number; w: number; h: number };

function rectsOverlap(a: DropRect, b: DropRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Resolve as sobreposições criadas por um DROP (arraste/resize solto sobre
// vizinhos, com allowOverlap ligado): o item solto fica EXATAMENTE onde foi
// solto (âncora) e cada vizinho sobreposto move o MÍNIMO necessário — a
// distância para liberar todos os bloqueadores é medida nas 4 direções e vence
// a de menor custo dentro dos limites (empate: baixo → direita → esquerda →
// cima). Vizinho movido vira âncora e a cascata segue transitivamente (fila em
// ordem de leitura) — determinística. Limites: X preso às colunas atuais
// (largura do canvas estável); Y até maxRows — empurrar além das linhas atuais
// é permitido de propósito: o canvas auto-cresce (propRows pisa em
// contentBottom). Grade cheia (sem direção válida): desce clampado, podendo
// restar sobreposição (caso patológico; o próximo gesto resolve).
function resolveDropCollisions(
  rects: readonly DropRect[],
  fixedId: string,
  cols: number,
  maxRows: number
): Map<string, { x: number; y: number }> {
  const byId = new Map(rects.map((r) => [r.i, { ...r }]));
  const fixed = byId.get(fixedId);
  const moved = new Map<string, { x: number; y: number }>();
  if (!fixed) return moved;

  const reading = (a: DropRect, b: DropRect) =>
    a.y - b.y || a.x - b.x || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0);

  const anchored = new Set<string>([fixedId]);
  const queue = rects
    .map((r) => byId.get(r.i)!)
    .filter((r) => r.i !== fixedId && rectsOverlap(r, fixed))
    .sort(reading)
    .map((r) => r.i);
  const queued = new Set(queue);

  const n = rects.length;
  let guard = 0;
  while (queue.length > 0 && guard++ < 4 * n * n + 16) {
    const id = queue.shift()!;
    queued.delete(id);
    const r = byId.get(id)!;
    const from = { x: r.x, y: r.y };

    // Liberar um bloqueador âncora pode revelar outro — repete até limpar
    // (bounded: cada âncora força no máximo um passo extra).
    for (let inner = 0; inner <= n; inner++) {
      const blockers = [...anchored]
        .map((a) => byId.get(a)!)
        .filter((b) => rectsOverlap(r, b));
      if (blockers.length === 0) break;
      let dRight = 0;
      let dLeft = 0;
      let dDown = 0;
      let dUp = 0;
      for (const b of blockers) {
        dRight = Math.max(dRight, b.x + b.w - r.x);
        dLeft = Math.max(dLeft, r.x + r.w - b.x);
        dDown = Math.max(dDown, b.y + b.h - r.y);
        dUp = Math.max(dUp, r.y + r.h - b.y);
      }
      const candidates = [
        { x: r.x, y: r.y + dDown, cost: dDown, ok: r.y + dDown + r.h <= maxRows },
        { x: r.x + dRight, y: r.y, cost: dRight, ok: r.x + dRight + r.w <= cols },
        { x: r.x - dLeft, y: r.y, cost: dLeft, ok: r.x - dLeft >= 0 },
        { x: r.x, y: r.y - dUp, cost: dUp, ok: r.y - dUp >= 0 },
      ].filter((c) => c.ok);
      // sort estável: empate de custo mantém a prioridade da ordem acima.
      candidates.sort((a, b) => a.cost - b.cost);
      const best =
        candidates[0] ??
        { x: r.x, y: Math.min(r.y + dDown, Math.max(0, maxRows - r.h)) };
      r.x = best.x;
      r.y = best.y;
    }

    if (r.x !== from.x || r.y !== from.y) moved.set(id, { x: r.x, y: r.y });
    anchored.add(id);

    // Cascata: quem o recém-ancorado passou a sobrepor entra na fila.
    const hit = rects
      .map((o) => byId.get(o.i)!)
      .filter(
        (o) => !anchored.has(o.i) && !queued.has(o.i) && rectsOverlap(o, r)
      )
      .sort(reading);
    for (const o of hit) {
      queue.push(o.i);
      queued.add(o.i);
    }
  }
  return moved;
}

export function DashboardGrid({
  widgets,
  boardWidgets,
  dataById,
  recordListById,
  recordListExtraById,
  recordListTotalById,
  recordListWindowTotalById,
  entityListById,
  calcById,
  fields,
  fkLabels,
  respCanon = {},
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
  fieldFilterSeedById,
  quickFiltersById,
  periodWindowById,
  deferredScopeById,
  deferredPendingIds,
  layoutById,
  applyLayoutPatch,
  lineById = {},
  applyLinePatch,
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
  placing = null,
  onPlace,
  onPlaceCancel,
  laserMode = false,
  onLaserModeChange,
  laserColor,
  onToggleEditMode,
  autoEditWidgetId = null,
  onAutoEditConsumed,
  onQuickCreate,
  onWidgetDeleted,
}: {
  widgets: Widget[];
  // TODOS os widgets do board (todas as abas) — alimenta só as listas
  // "Aplicar a" do WidgetBuilder; `widgets` segue sendo a aba visível.
  boardWidgets?: Widget[];
  dataById: Record<string, WidgetData>;
  recordListById: Record<string, RecordRow[]>;
  // Registros EXTRAS por widget (fontes de Metric.sources fora das do widget):
  // alimentam SÓ a basis dos subtotais da tabela de registros (nunca linhas).
  recordListExtraById?: Record<string, RecordRow[]>;
  // Total dos widgets-lista paginados no servidor (chave ausente = full fetch;
  // opcional — o viewer de snapshots nunca pagina, dataset congelado).
  recordListTotalById?: Record<string, number>;
  // Total do recorte quando a 1ª carga do full fetch foi TRUNCADA na janela
  // incremental (record-list v2.0). Chave ausente = conjunto completo.
  recordListWindowTotalById?: Record<string, number>;
  entityListById: Record<string, EntityListRow[]>;
  calcById: Record<string, CalcWidgetResult>;
  fields: FieldDefinition[];
  fkLabels: Record<string, string>;
  // Agrupamento de responsáveis (0101): apelido → principal.
  respCanon?: Record<string, string>;
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
  // Seed dos controles "Filtro por campo" quando a URL não traz o ff_: valor
  // salvo do usuário (lastFieldFilters). URL sempre vence.
  fieldFilterSeedById?: Record<string, string>;
  quickFiltersById?: Record<string, WidgetQuickFilters>;
  // Janela de períodos (settings.periodWindow): estado efetivo do dropdown do
  // card, resolvido no servidor (__pw__ ?? default). Ausente = sem dropdown.
  periodWindowById?: Record<string, WidgetPeriodWindowState>;
  // Fingerprint do escopo efetivo dos widgets DEFERIDOS (Tabela Livre/kanban):
  // muda → o widget re-busca. Ausente no viewer de snapshot (precomputado).
  deferredScopeById?: Record<string, string>;
  // Widgets de ENGINE deferidos com lote em voo (DashboardClient): o card
  // exibe o overlay "Atualizando…" enquanto o id estiver no conjunto.
  deferredPendingIds?: Set<string>;
  // Estado otimista de layout (vive no shell — dashboard-client): posições BASE
  // por widget, fonte de verdade entre um saveLayout (que não revalida) e o
  // próximo refresh real. O grid lê via basePos() e escreve via applyLayoutPatch.
  layoutById: Record<string, GridPosition>;
  applyLayoutPatch: (patch: Record<string, GridPosition>) => void;
  // Traçado otimista das Formas "linha" (shell — dashboard-client), par do
  // layoutById: saveShapeLine não revalida. Opcionais — o viewer de snapshots
  // não os passa (read-only, o traçado vem congelado nos settings).
  lineById?: Record<string, ShapeLine>;
  applyLinePatch?: (patch: Record<string, ShapeLine>) => void;
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
  // Modo Posicionar: overlay com ghost w×h seguindo o cursor; o clique entrega
  // a posição (centro ancorado) ao shell; Esc cai no onPlaceCancel (fallback).
  placing?: { w: number; h: number } | null;
  onPlace?: (pos: GridPosition) => void;
  onPlaceCancel?: () => void;
  // Ponteiro Laser (modo apresentação): clique-direito sobre um widget abre o
  // menu do apresentador. Opcionais — o viewer de snapshots não os passa
  // (menu/overlay ficam estruturalmente desligados lá).
  laserMode?: boolean;
  onLaserModeChange?: (on: boolean) => void;
  laserColor?: string;
  // Alterna o modo edição a partir do menu (mesmo efeito do botão do topo).
  onToggleEditMode?: () => void;
  // Abertura automática do editor de um widget recém-criado pelo Inserir
  // (tipos que exigem configuração). Consumo one-shot avisado ao shell.
  autoEditWidgetId?: string | null;
  onAutoEditConsumed?: (id: string) => void;
  // Criação RÁPIDA pelo menu de contexto (Inserir ▸ tipo): o shell insere sem
  // revalidar e mostra o widget otimista na hora (ver dashboard-client);
  // autoEdit abre o editor do widget novo assim que ele monta.
  onQuickCreate?: (input: WidgetInput, opts?: { autoEdit?: boolean }) => void;
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
  // Menu do APRESENTADOR (clique-direito SOBRE um widget): Ponteiro Laser +
  // Editar layout. Só a posição do clique — não há célula-alvo.
  const [laserMenuAt, setLaserMenuAt] = useState<{
    x: number;
    y: number;
  } | null>(null);

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

  // MESCLA OTIMISTA: pares host→membros confirmados no cliente e ainda não
  // refletidos pelas props do servidor. Sem isto, confirmar a mescla devolvia
  // o membro à posição original até o router.refresh aterrissar (a page
  // recomputa TODOS os widgets — segundos num dashboard grande) e a mescla
  // "só aparecia no F5". O efeito entra em `effWidgets` (o settings.pages do
  // host ganha os pendentes) e a limpeza acontece no render quando o servidor
  // alcança (padrão de ajustar estado no render, como o `drag` das alças);
  // falha da action faz rollback (o membro reaparece onde estava).
  const [pendingMerges, setPendingMerges] = useState<Record<string, string[]>>(
    {}
  );
  const effWidgets = useMemo(() => {
    if (Object.keys(pendingMerges).length === 0) return widgets;
    return widgets.map((w) => {
      const add = pendingMerges[w.id];
      if (!add || add.length === 0) return w;
      const cur = pageMembersOf(w);
      return {
        ...w,
        settings: {
          ...(w.settings ?? {}),
          pages: [...cur, ...add.filter((id) => !cur.includes(id))],
        },
      };
    });
  }, [widgets, pendingMerges]);
  const stalePending = Object.entries(pendingMerges).filter(([hostId, ids]) => {
    const host = widgets.find((w) => w.id === hostId);
    if (!host) return true; // host sumiu (excluído/movido de aba)
    const cur = pageMembersOf(host);
    return ids.every((id) => cur.includes(id));
  });
  if (stalePending.length > 0) {
    setPendingMerges((prev) => {
      const next = { ...prev };
      for (const [k] of stalePending) delete next[k];
      return next;
    });
  }

  // Partição: Formas "linha" ficam FORA do RGL (camada livre — movimento sem
  // prender às colunas) e fora das colisões/conectores; widgets-MEMBRO de uma
  // mescla (settings.pages de um host — lib/widgets/pages, incluindo os
  // pendentes acima) ficam OCULTOS (o host renderiza a página ativa no espaço
  // dele); todo o resto segue no grid. A troca widgets→gridWidgets tem que ser
  // CONSISTENTE (layout memo, persist, children do RGL, ConnectorLayer) —
  // parcial dessincroniza o layout↔children do RGL.
  const pageMemberIds = useMemo(
    () => collectPageMembers(effWidgets),
    [effWidgets]
  );
  const widgetById = useMemo(
    () => new Map(effWidgets.map((w) => [w.id, w])),
    [effWidgets]
  );
  const gridWidgets = useMemo(
    () =>
      effWidgets.filter(
        (w) => !isLineShapeWidget(w) && !pageMemberIds.has(w.id)
      ),
    [effWidgets, pageMemberIds]
  );
  const lineWidgets = useMemo(
    () => effWidgets.filter((w) => isLineShapeWidget(w)),
    [effWidgets]
  );
  // Traçado efetivo de uma linha: otimista ?? settings ?? derivado do rect
  // (linha recém-criada ainda sem shape.line).
  const lineFor = useCallback(
    (w: Widget, i: number): ShapeLine =>
      lineById[w.id] ?? lineOf(w, basePos(w, i)),
    [lineById, basePos]
  );

  // Página ativa por host (EFÊMERO — trocar de página nunca persiste). Clamp
  // na leitura: se `pages` encolher, o índice cai para a última válida.
  const [pageIndexByHost, setPageIndexByHost] = useState<
    Record<string, number>
  >({});
  // Medição de página de mescla: o PRÓPRIO WidgetCard reporta sob o id do
  // host (pageHostId ?? widget.id) — o layout do RGL é keyado pelo slot.
  // Diálogo "Adicionar página?" do drop quase-em-cima (persist →
  // findMergeTarget). Enquanto aberto, o card fica NA POSIÇÃO SOLTA (patch
  // otimista, sem saveLayout); confirmar mescla e cancelar DESFAZ o arraste.
  const [mergePrompt, setMergePrompt] = useState<{
    hostId: string;
    draggedId: string;
    base: GridPosition;
  } | null>(null);
  const [mergePending, startMerge] = useTransition();

  // Mescla com efeito IMEDIATO: registra a pendência (o membro some e o pager
  // aparece na hora — os dados da página oculta já estão nas props, a page
  // computa todos os widgets), mostra a página recém-adicionada (índice alto,
  // o clamp da leitura cai na última) e só então persiste; falha desfaz.
  // Compartilhada pelo diálogo do drop e pelo "Adicionar página" do ⋮ (via
  // prop onMergePages do WidgetCard).
  const performMerge = useCallback(
    async (hostId: string, memberIds: string[]) => {
      setPendingMerges((prev) => {
        const cur = prev[hostId] ?? [];
        return {
          ...prev,
          [hostId]: [...cur, ...memberIds.filter((id) => !cur.includes(id))],
        };
      });
      setPageIndexByHost((prev) => ({
        ...prev,
        [hostId]: Number.MAX_SAFE_INTEGER,
      }));
      const res = await mergeWidgetPages(dashboardId, hostId, memberIds);
      if (!res.ok) {
        setPendingMerges((prev) => {
          const rest = (prev[hostId] ?? []).filter(
            (id) => !memberIds.includes(id)
          );
          const next = { ...prev };
          if (rest.length > 0) next[hostId] = rest;
          else delete next[hostId];
          return next;
        });
        return res;
      }
      router.refresh();
      void history.captureNow();
      return res;
    },
    [dashboardId, router, history]
  );

  // Layout efetivo (o que vai pro RGL): max(mínimo, medido) no eixo habilitado, e
  // então um passo de resolução de colisões que empurra os vizinhos no eixo do
  // crescimento (largura → direita, altura → baixo). Determinístico: ao colapsar,
  // some a inflação, some a colisão e todos voltam à base.
  // useMemo: pushApart é O(n²) e rodava a CADA render do grid (medições,
  // baseWidth, drag da alça) — só recomputa quando widgets/base/medidas mudam.
  const layout: Layout = useMemo(() => {
    const inflated: ResolveItem[] = gridWidgets.map((w, i) => {
      const p = basePos(w, i);
      const a = w.settings?.autoSize;
      const m = measured[w.id];
      const ew = a?.width && m ? Math.max(p.w, m.w) : p.w;
      const eh = a?.height && m ? Math.max(p.h, m.h) : p.h;
      return { i: w.id, x: p.x, y: p.y, w: ew, h: eh, bx: p.x, by: p.y, bw: p.w, bh: p.h };
    });
    return pushApart(inflated).map(({ i, x, y, w, h }) => ({
      i,
      x,
      y,
      w,
      h,
    }));
  }, [gridWidgets, basePos, measured]);

  // Densidade da célula: quantas colunas preenchem a largura VISÍVEL (controle
  // "Largura da coluna" do sheet Área de trabalho). Clamp de sanidade — valores
  // fora da faixa do controle não quebram a geometria.
  const baseCols = Math.max(
    12,
    Math.min(240, Math.round(settings.canvas?.baseCols ?? BASE_COLS))
  );

  // Extensão do conteúdo — pisos para não cortar widgets ao encolher a área.
  // As linhas (fora do layout do RGL) entram pelo bounding box do traçado.
  let contentRight = layout.reduce((m, l) => Math.max(m, l.x + l.w), baseCols);
  let contentBottom = layout.reduce((m, l) => Math.max(m, l.y + l.h), MIN_ROWS);
  lineWidgets.forEach((w, i) => {
    const b = lineGridBBox(lineFor(w, i));
    contentRight = Math.max(contentRight, b.x + b.w);
    contentBottom = Math.max(contentBottom, b.y + b.h);
  });

  // Tamanho efetivo do canvas (vindo das settings): nunca abaixo do conteúdo,
  // nunca além dos limites.
  const propCols = Math.min(MAX_COLS, Math.max(contentRight, settings.canvas?.cols ?? baseCols));
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

  // Largura visível (base das `baseCols` colunas) medida do container de rolagem. Usamos
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
    ignore: (t) =>
      !!t.closest(".react-grid-item, [data-conn-ui], [data-line-ui]"),
  });

  // Célula constante: `baseCols` colunas preenchem a largura visível (sem
  // margens), então widgets não mudam de tamanho quando o canvas cresce.
  const cellW = baseWidth > 0 ? baseWidth / baseCols : 0;
  // Linha default QUADRADA: altura = largura da célula (responsiva). Override
  // por dashboard em canvas.rowHeight (a conversão de board legado grava 10.5
  // explícito — fidelidade vertical do layout antigo de px fixos).
  const ROW_H = settings.canvas?.rowHeight ?? cellW;
  const gridW = (c: number) => c * cellW + MX * (c + 1);
  const gridH = (r: number) => r * ROW_H + MY * (r + 1);
  // Métricas do ConnectorLayer com referência estável (objeto novo por render
  // re-renderizava a camada de conectores a cada medição/hover).
  const connMetrics = useMemo(
    () => ({ cellW, rowH: ROW_H, mx: MX, my: MY }),
    [cellW, ROW_H]
  );

  // Botão esquerdo no espaço vazio arma o pan (useDragPan). Durante o desenho
  // de criação (ou com o Ponteiro Laser ativo) o overlay é dono do gesto — o
  // pointerdown do laser BORBULHA até aqui e armaria o pan sem a guarda.
  function onCanvasPointerDown(e: React.PointerEvent) {
    if (drawMode || placing || laserMode) return; // o overlay ativo é dono do gesto
    panPointerDown(e);
  }

  // Clique-direito no grid: SOBRE um widget (`.react-grid-item`) abre o menu
  // do APRESENTADOR (Ponteiro Laser — qualquer usuário — + Editar layout p/
  // canEdit); no espaço vazio, o menu "Inserir/Colar widget" (só canEdit; sem
  // edição o menu nativo segue valendo). A célula-alvo do colar vem da posição
  // do clique via a mesma fórmula do RGL; o x é preso ao canvas (0..cols-w).
  function onCanvasContextMenu(e: React.MouseEvent) {
    if (drawMode || placing || laserMode) return; // c/ laser o overlay é o dono
    // Menus internos dos widgets (quick-table/charts em edição/aparência) já
    // trataram o clique com preventDefault (sem stopPropagation) — não abre
    // um segundo menu por cima.
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-conn-ui]")) return;
    if (t.closest("[data-line-ui]")) return;
    if (t.closest(".react-grid-item")) {
      if (!onLaserModeChange) return; // snapshot viewer: menu nativo
      e.preventDefault();
      setInsertOpen(false);
      setPasteAt(null);
      setLaserMenuAt({ x: e.clientX, y: e.clientY });
      return;
    }
    if (!canEdit) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || cellW <= 0) return;
    e.preventDefault();
    const gx = Math.max(0, Math.floor((e.clientX - rect.left - MX) / (cellW + MX)));
    const gy = Math.max(0, Math.floor((e.clientY - rect.top - MY) / (ROW_H + MY)));
    setInsertOpen(false);
    setLaserMenuAt(null);
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
    let settings = {
      ...(copied.settings ?? {}),
      tab: activeTabId || undefined,
    };
    let position: GridPosition = {
      x: Math.min(at.gridX, Math.max(0, cols - copied.w)),
      y: at.gridY,
      w: copied.w,
      h: copied.h,
    };
    // Linha divisória: o traçado viaja nos settings — translada as PONTAS para
    // a célula clicada (preserva o desenho) e deriva o bbox; o clamp genérico
    // por largura acima não serve (encalharia o traçado antigo em outro lugar).
    // isLineShapeWidget cobre payloads novos ('linha_divisoria') e antigos de
    // clipboard (forma + shape.kind "linha").
    if (isLineShapeWidget(copied)) {
      const src = lineOf(
        { settings: copied.settings },
        { x: 0, y: 0, w: copied.w, h: copied.h }
      );
      const nl = roundLine(
        clampLine(lineAtCell(src, Math.max(0, at.gridX), at.gridY), cols, rows)
      );
      settings = {
        ...settings,
        shape: { ...copied.settings?.shape, line: nl },
      };
      position = lineGridBBox(nl);
    }
    const input: WidgetInput = {
      title: copied.title,
      visual_type: copied.visual_type,
      sources: copied.sources,
      splitBySource: copied.splitBySource,
      dimensions: copied.dimensions,
      metrics: copied.metrics,
      filters: copied.filters,
      settings,
      grid_position: position,
    };
    startPaste(async () => {
      await createWidget(dashboardId, input);
      router.refresh();
    });
  }

  // "Inserir ▸ <tipo>": cria NA célula clicada (centro do widget ancorado
  // nela), com os defaults centralizados em lib/widgets/widget-defaults. Tipos
  // que exigem configuração (WIDGET_NEEDS_CONFIG) abrem o editor na sequência.
  function insertAt(kind: VisualType) {
    const at = pasteAt;
    setPasteAt(null);
    if (!at || !onQuickCreate) return;
    const { w, h } = DEFAULT_WIDGET_SIZE[kind];
    onQuickCreate(
      {
        ...defaultWidgetSeed(kind, activeTabId || undefined),
        grid_position: centerAnchored(at.gridX, at.gridY, w, h, cols),
      },
      { autoEdit: WIDGET_NEEDS_CONFIG[kind] }
    );
  }

  // Persistência do layout: só em interações do usuário (arrastar/redimensionar),
  // e sempre gravando o tamanho/posição BASE, nunca o offset de inflação/pushApart
  // (que é derivado a cada render e sumiria/derivaria se fosse "assado" na base).
  //   • item manipulado: arraste → nova x/y + w/h da base; redimensiona → novo
  //     w/h + x/y da base (o handle é inferior/direito);
  //   • vizinhos: com allowOverlap o RGL NÃO empurra ninguém durante o gesto
  //     (`next` chega com só o item manipulado alterado) — quem abre espaço é o
  //     resolveDropCollisions AQUI, no drop: cada vizinho sobreposto move o
  //     mínimo necessário, em cascata determinística sobre as bases.
  // O patch aplica no estado otimista do shell (applyLayoutPatch) na hora — como
  // saveLayout não revalida (edição fluida), a prop do servidor fica obsoleta e
  // era ela que fazia os widgets "voltarem" no próximo re-render. Após persistir,
  // registra no histórico. Obs.: widgets com autoSize podem "assentar" um render
  // depois do drop (a base nova repassa por inflação+pushApart) — determinístico.
  // Cauda comum do drop: abre espaço (resolveDropCollisions), aplica o patch
  // otimista e persiste + histórico.
  function commitDrop(
    changedId: string,
    dropped: GridPosition,
    base: GridPosition
  ) {
    // Bases + item solto na posição do drop → deslocamento mínimo dos vizinhos.
    // Linhas ficam de fora de propósito: uma divisória decorativa não empurra
    // nem é empurrada por widgets.
    const rects: DropRect[] = gridWidgets.map((w, i) =>
      w.id === changedId
        ? { i: w.id, ...dropped }
        : { i: w.id, ...basePos(w, i) }
    );
    const movedNeighbors = resolveDropCollisions(
      rects,
      changedId,
      cols,
      MAX_ROWS
    );

    const patch: Record<string, GridPosition> = {};
    if (
      dropped.x !== base.x ||
      dropped.y !== base.y ||
      dropped.w !== base.w ||
      dropped.h !== base.h
    ) {
      patch[changedId] = dropped;
    }
    for (const [id, p] of movedNeighbors) {
      const i = gridWidgets.findIndex((w) => w.id === id);
      if (i < 0) continue;
      const b = basePos(gridWidgets[i], i);
      patch[id] = { x: p.x, y: p.y, w: b.w, h: b.h };
    }
    if (Object.keys(patch).length === 0) return;
    applyLayoutPatch(patch);
    // Falha (RLS/rede) vira toast — antes era silenciosa e o layout "voltava"
    // no F5. Histórico só captura quando a gravação de fato aconteceu.
    void notifyOnError(
      saveLayout(
        dashboardId,
        Object.entries(patch).map(([id, p]) => ({
          id,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
        }))
      ),
      "Não foi possível salvar o layout"
    ).then((res) => {
      if (res?.ok) void history.captureNow();
    });
  }

  function persist(
    _next: Layout,
    changed: LayoutItem | null,
    kind: "drag" | "resize"
  ) {
    if (!editMode || !changed) return;
    const idx = gridWidgets.findIndex((w) => w.id === changed.i);
    if (idx < 0) return;
    const dragged = gridWidgets[idx];
    const base = basePos(dragged, idx);
    const dropped: GridPosition =
      kind === "resize"
        ? { x: base.x, y: base.y, w: changed.w, h: changed.h }
        : { x: changed.x, y: changed.y, w: base.w, h: base.h };

    // Mescla por drop (páginas de widget): arraste que TERMINA quase
    // exatamente sobre outro widget de tamanho parecido pergunta "Adicionar
    // página?" ANTES de abrir espaço. O card fica na posição solta sob o
    // diálogo (patch otimista, SEM saveLayout); cancelar desfaz o arraste.
    if (
      kind === "drag" &&
      canEdit &&
      (dropped.x !== base.x || dropped.y !== base.y)
    ) {
      const target = findMergeTarget(
        dropped,
        dragged,
        gridWidgets
          .map((w, i) => ({ widget: w, pos: basePos(w, i) }))
          .filter((c) => c.widget.id !== dragged.id)
      );
      if (target) {
        applyLayoutPatch({ [dragged.id]: dropped });
        setMergePrompt({ hostId: target, draggedId: dragged.id, base });
        return;
      }
    }
    commitDrop(changed.i, dropped, base);
  }

  // Persistência do traçado de uma Forma "linha" (espelho do persist acima,
  // único escritor): normaliza (trava de eixo + clamp ao canvas + round
  // determinístico), aplica o otimista (traçado + bbox no layout) e grava —
  // saveShapeLine deriva o MESMO bbox no servidor. Histórico após persistir,
  // como no saveLayout.
  function persistLine(id: string, next: ShapeLine) {
    if (!editMode) return;
    const line = roundLine(clampLine(axisLock(next), cols, rows));
    applyLinePatch?.({ [id]: line });
    applyLayoutPatch({ [id]: lineGridBBox(line) });
    void notifyOnError(
      saveShapeLine(dashboardId, id, line),
      "Não foi possível salvar a linha"
    ).then((res) => {
      if (res?.ok) void history.captureNow();
    });
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
  // Eixo em arraste: liga o chip "cols × linhas" e a transition de tamanho.
  const [dragAxis, setDragAxis] = useState<"row" | "col" | null>(null);
  function onHandleDown(e: React.PointerEvent, axis: "row" | "col") {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { x: e.clientX, y: e.clientY, cols, rows, axis };
    lastRef.current = { cols, rows };
    setDragAxis(axis);
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
    // Só re-renderiza ao cruzar um limite de célula — sem isso, cada pointermove
    // reflowia o grid inteiro e o arraste ficava travado.
    const prev = lastRef.current;
    if (prev && prev.cols === nextCols && prev.rows === nextRows) return;
    const next = { cols: nextCols, rows: nextRows };
    lastRef.current = next;
    setDrag(next);
  }
  function onHandleUp(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDragAxis(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture pode já ter sido liberada
    }
    const last = lastRef.current;
    // Clique sem mudança de tamanho não persiste nada.
    if (!last || (last.cols === d.cols && last.rows === d.rows)) return;
    void notifyOnError(
      updateDashboardSettings(dashboardId, {
        ...settings,
        canvas: { ...settings.canvas, cols: last.cols, rows: last.rows },
      }),
      "Não foi possível redimensionar o canvas"
    );
  }

  // Menu flutuante do clique-direito (compartilhado entre o estado vazio e o
  // grid): Inserir ▸ (todos os tipos, com busca) e Colar widget. Reaproveita
  // FloatingPanel (posiciona no clique, fecha ao clicar fora). O flyout NÃO
  // fecha no mouse-leave — tem input de busca dentro; fecha com o menu ou Esc.
  const pasteMenu = pasteAt ? (
    <FloatingPanel x={pasteAt.x} y={pasteAt.y} onClose={() => setPasteAt(null)} className="w-48">
      {onQuickCreate ? (
        <>
          <div className="relative" onMouseEnter={() => setInsertOpen(true)}>
            <MenuBtn onClick={() => setInsertOpen((v) => !v)}>
              <Plus />
              <span className="flex-1">Inserir</span>
              <ChevronRight />
            </MenuBtn>
            {insertOpen ? (
              <InsertTypeMenu
                // Flip para a esquerda quando o menu está colado na borda
                // direita da viewport (o flyout estouraria a tela).
                alignLeft={pasteAt.x > window.innerWidth - 400}
                onPick={insertAt}
                onClose={() => setInsertOpen(false)}
              />
            ) : null}
          </div>
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

  // Menu do APRESENTADOR (clique-direito sobre um widget): ativar/desativar o
  // Ponteiro Laser (qualquer usuário) e alternar o modo edição (só canEdit —
  // mesmo efeito do botão do topo, via onToggleEditMode do shell). Também é
  // reaberto pelo clique-direito com o laser ATIVO (onOpenMenu do overlay).
  const laserMenu =
    laserMenuAt && onLaserModeChange ? (
      <FloatingPanel
        x={laserMenuAt.x}
        y={laserMenuAt.y}
        onClose={() => setLaserMenuAt(null)}
        className="w-56"
      >
        <MenuBtn
          onClick={() => {
            setLaserMenuAt(null);
            onLaserModeChange(!laserMode);
          }}
        >
          <Presentation />
          <span className="flex-1">
            {laserMode ? "Desativar Ponteiro Laser" : "Ponteiro Laser"}
          </span>
        </MenuBtn>
        {canEdit && onToggleEditMode ? (
          <MenuBtn
            onClick={() => {
              setLaserMenuAt(null);
              onToggleEditMode();
            }}
          >
            {editMode ? <Check /> : <Pencil />}
            <span className="flex-1">
              {editMode ? "Concluir edição" : "Editar layout"}
            </span>
          </MenuBtn>
        ) : null}
      </FloatingPanel>
    ) : null;

  // Diálogo "Adicionar página?" (mescla por drop). Confirmar fecha NA HORA e
  // aplica o efeito otimista (performMerge: membro some, pager aparece, card
  // volta à base — a posição solta nunca persiste) enquanto a action corre por
  // trás; Cancelar/Esc só desfaz o arraste (o banco nunca foi tocado).
  const mergeDialog = mergePrompt ? (
    <MergePromptDialog
      open
      pending={mergePending}
      draggedTitle={
        widgetById.get(mergePrompt.draggedId)?.title?.trim() || "Sem título"
      }
      hostTitle={
        widgetById.get(mergePrompt.hostId)?.title?.trim() || "Sem título"
      }
      onConfirm={() => {
        const prompt = mergePrompt;
        applyLayoutPatch({ [prompt.draggedId]: prompt.base });
        setMergePrompt(null);
        startMerge(async () => {
          await performMerge(prompt.hostId, [prompt.draggedId]);
        });
      }}
      onCancel={() => {
        applyLayoutPatch({ [mergePrompt.draggedId]: mergePrompt.base });
        setMergePrompt(null);
      }}
    />
  ) : null;

  // Cromo dos cards (26/07/2026): padrões do dashboard p/ o texto de
  // comparação e o selo "Nº dia útil" (ver board-chrome-context).
  const boardChrome = useMemo(
    () => ({
      hideComparisonLabels: settings.hideComparisonLabels ?? false,
      hideBusinessDayBadges: settings.hideBusinessDayBadges ?? false,
    }),
    [settings.hideComparisonLabels, settings.hideBusinessDayBadges]
  );

  // Em drawMode/placing o canvas renderiza mesmo vazio (é onde se desenha a
  // tabela / se clica para posicionar o widget novo).
  if (widgets.length === 0 && !drawMode && !placing) {
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
                "rounded-md border border-dashed border-brand/40 bg-brand/[0.02]",
              // Só durante o arraste da alça: a borda desliza entre os degraus
              // de célula (fora dele, resize de janela/menu fica instantâneo).
              dragAxis && "transition-[width,height] duration-150 ease-out"
            )}
            style={{ width: gridW(cols), height: gridH(rows) }}
          >
            {/* Linhas entre widgets: antes do RGL no DOM = pintam SOB os cards
                (as âncoras de criação têm z próprio, acima). */}
            {saveConnectors ? (
              <ConnectorLayer
                connectors={connectors}
                layout={layout}
                widgets={gridWidgets}
                metrics={connMetrics}
                tabs={tabs}
                activeTabId={activeTabId ?? ""}
                editMode={editMode}
                connectMode={connectMode}
                onChange={saveConnectors}
                apiRef={connApiRef}
              />
            ) : null}
            {/* Formas "linha": camada livre (sem prender às colunas), também
                antes do RGL no DOM = sob os cards. */}
            {lineWidgets.length > 0 ? (
              <LineLayer
                widgets={lineWidgets}
                lineFor={lineFor}
                metrics={connMetrics}
                cols={cols}
                maxRows={rows}
                editMode={editMode && !drawMode && !placing && !connectMode}
                canEdit={canEdit}
                dashboardId={dashboardId}
                onCommit={persistLine}
                onWidgetDeleted={onWidgetDeleted}
                availableForBuilder={availableForBuilder}
                fields={fields}
                currencyOptions={currencyOptions}
                tabs={tabs}
                siblings={widgets}
                boardWidgets={boardWidgets}
                canManageFields={canManageFields}
              />
            ) : null}
            <RGL
              className={cn(
                // pointer-events-none: o container do RGL é um div transparente
                // que cobre o canvas INTEIRO por cima da camada de conectores
                // (vem depois no DOM) — sem isso ele engole o clique nas linhas
                // (e o pan armava no lugar). Os itens reabilitam abaixo.
                "layout transition-opacity pointer-events-none",
                pending && "opacity-60",
                dragAxis && "transition-[width,height,opacity] duration-150 ease-out"
              )}
              layout={layout}
              cols={cols}
              width={gridW(cols)}
              maxRows={rows}
              rowHeight={ROW_H}
              compactType={null}
              // Nada se move durante o gesto: em colisão o moveElement interno
              // retorna cedo (só o item manipulado anda; placeholder segue o
              // cursor) e o compactor vira identidade. O espaço é aberto SÓ no
              // drop, por resolveDropCollisions (persist). NÃO trocar por
              // preventCollision: ele impede o placeholder de ENTRAR em área
              // ocupada (soltar no meio de um grupo ficaria impossível).
              allowOverlap
              margin={[MX, MY]}
              containerPadding={[MX, MY]}
              autoSize={false}
              style={{ height: gridH(rows) }}
              isDraggable={editMode && !drawMode && !placing}
              isResizable={editMode && !drawMode && !placing}
              draggableHandle=".widget-drag"
              onDragStart={onDragStart}
              onResizeStart={onResizeStart}
              onDrag={onLiveLayout}
              onResize={onLiveLayout}
              onDragStop={onDragStop}
              onResizeStop={onResizeStop}
            >
              {gridWidgets.map((w, gi) => {
                // Páginas de widget: o HOST renderiza a página ativa no espaço
                // dele (ids mortos em `pages` são pulados — membro excluído/
                // movido não quebra o pager). O key do card = widget EXIBIDO:
                // trocar de página REMONTA o card, e os deferidos (kanban/
                // Tabela Livre/agenda) disparam o próprio fetch ao montar.
                const memberIdsOf = pageMembersOf(w);
                const pagesOf =
                  memberIdsOf.length > 0
                    ? [
                        w,
                        ...memberIdsOf
                          .map((id) => widgetById.get(id))
                          .filter((x): x is Widget => !!x),
                      ]
                    : null;
                const pageIdx = pagesOf
                  ? Math.min(pageIndexByHost[w.id] ?? 0, pagesOf.length - 1)
                  : 0;
                const shown = pagesOf ? pagesOf[pageIdx] : w;
                return (
                  <div
                    key={w.id}
                    id={widgetDomId(w.id)}
                    className="pointer-events-auto cursor-auto"
                  >
                    {pagesOf && pagesOf.length > 1 ? (
                      <WidgetPager
                        count={pagesOf.length}
                        index={pageIdx}
                        inset={basePos(w, gi).y <= 0}
                        onChange={(i) =>
                          setPageIndexByHost((prev) => ({
                            ...prev,
                            [w.id]: i,
                          }))
                        }
                      />
                    ) : null}
                    {/* Escala de fonte do dashboard: só o conteúdo dos widgets
                      escala (o cromo do canvas — chips, overlays — não). */}
                    <FontScaleProvider value={settings.fontScale ?? 1}>
                      <BoardChromeProvider value={boardChrome}>
                        <WidgetCard
                        key={shown.id}
                        widget={shown}
                        data={dataById[shown.id] ?? EMPTY_WIDGET_DATA}
                        recordList={
                          recordListById[shown.id] ?? EMPTY_RECORD_LIST
                        }
                        recordListExtra={recordListExtraById?.[shown.id]}
                        recordListTotal={recordListTotalById?.[shown.id]}
                        recordListWindowTotal={recordListWindowTotalById?.[shown.id]}
                        entityList={
                          entityListById[shown.id] ?? EMPTY_ENTITY_LIST
                        }
                        calcValue={calcById[shown.id] ?? null}
                        calcVars={calcVarsById[shown.id]}
                        noteValues={noteById[shown.id]}
                        calcExpr={calcExprById[shown.id]}
                        tableCells={tableCellsById[shown.id]}
                        fields={fields}
                        currencyOptions={currencyOptions}
                        currencyRates={currencyRates}
                        conversionPeriod={conversionPeriodById[shown.id]}
                        fkLabels={fkLabels}
                        respCanon={respCanon}
                        responsibleOptions={responsibleOptions}
                        userRoles={userRoles}
                        canEditValues={canEditValues}
                        available={available}
                        availableForBuilder={availableForBuilder}
                        dashboardId={dashboardId}
                        dateFormat={dateFormat}
                        siblings={effWidgets}
                        boardWidgets={boardWidgets}
                        tabs={tabs}
                        canEdit={canEdit}
                        canExport={canExport}
                        canManageFields={canManageFields}
                        editMode={editMode}
                        filterOptions={filterOptionsById?.[shown.id]}
                        fieldFilterSeed={fieldFilterSeedById?.[shown.id]}
                        quickFilters={quickFiltersById?.[shown.id]}
                        periodWindow={periodWindowById?.[shown.id]}
                        deferredScopeKey={deferredScopeById?.[shown.id]}
                        deferredPending={deferredPendingIds?.has(shown.id)}
                        autoSize={shown.settings?.autoSize}
                        cellW={cellW}
                        rowH={ROW_H}
                        mx={MX}
                        my={MY}
                        onMeasure={onMeasure}
                        pageHostId={pagesOf ? w.id : undefined}
                        pageCount={pagesOf?.length}
                        onMergePages={performMerge}
                        onWidgetDeleted={onWidgetDeleted}
                          autoOpenEditor={shown.id === autoEditWidgetId}
                          onAutoEditConsumed={onAutoEditConsumed}
                        />
                      </BoardChromeProvider>
                    </FontScaleProvider>
                  </div>
                );
              })}
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
            {placing && onPlace && onPlaceCancel ? (
              <PlaceWidgetOverlay
                cellW={cellW}
                rowH={ROW_H}
                mx={MX}
                my={MY}
                cols={cols}
                rows={rows}
                w={placing.w}
                h={placing.h}
                onPlace={onPlace}
                onCancel={onPlaceCancel}
              />
            ) : null}
            {laserMode && !editMode && onLaserModeChange ? (
              <LaserPointerOverlay
                color={laserColor ?? DEFAULT_LASER}
                onExit={() => onLaserModeChange(false)}
                onOpenMenu={(x, y) => setLaserMenuAt({ x, y })}
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
                    "cursor-ns-resize touch-none rounded-b-md bg-brand/15 hover:bg-brand/30",
                    "before:h-0.5 before:w-8 before:rounded-full before:bg-brand/60 before:content-['']"
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
                    "cursor-ew-resize touch-none rounded-r-md bg-brand/15 hover:bg-brand/30",
                    "before:h-8 before:w-0.5 before:rounded-full before:bg-brand/60 before:content-['']"
                  )}
                />
                {/* Chip com o tamanho ao vivo, junto da alça em arraste. */}
                {dragAxis ? (
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute z-30 rounded-md bg-brand px-2 py-0.5",
                      "text-xs font-medium text-brand-foreground tabular-nums shadow-sm",
                      dragAxis === "row"
                        ? "bottom-4 left-1/2 -translate-x-1/2"
                        : "top-1/2 right-4 -translate-y-1/2"
                    )}
                  >
                    {cols} × {rows}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {pasteMenu}
      {laserMenu}
      {mergeDialog}
    </div>
  );
}
