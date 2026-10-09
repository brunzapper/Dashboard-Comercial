// Versão: 1.15 | Data: 09/10/2026
// v1.15 (09/10/2026): aviso "Carregando atividades do Bitrix…" enquanto a
//   carga inicial de um Tree recém-ligado roda (`data.inboundLoading`) — faixa
//   discreta, sem overlay; re-busca SILENCIOSA a cada 5 s até terminar (a
//   troca de estado da carga não passa pelo event bus).
// v1.14 (02/10/2026): o widget deixa de depender de escolhas fixas do preset.
//   (a) MODO APRESENTAR: rótulo de tipo, "+", concluir etapa, "Agendar
//       próxima", avisos e o cabeçalho "Mapa · …" somem por padrão
//       (`settings.presentation` liga de volta; o cartão força o rótulo);
//   (b) cartões REDIMENSIONÁVEIS (0150) e em DESTAQUE no duplo-clique;
//   (c) anotação com descrição e data próprias (editor completo) e
//       conversão em indicador/Multi-fatores/ritual; Resultado em qualquer
//       nó desenhado;
//   (d) nó de indicador pedido POR NÓ (o servidor lê a fonte do realizado no
//       banco); o editor recebe o catálogo de fórmulas do painel e grava a
//       meta do mês no próprio nó.
// v1.13 (02/10/2026): repassa `settings.canvas` (fundo do canvas da Root) ao
//   TreeRootView.
// Versão: 1.12 | Data: 01/10/2026
// v1.12 (01/10/2026): (a) avisa prontidão ao pré-render do modo Apresentar
//   (`useWarmupReady`): pronta quando a árvore E os números dos indicadores
//   chegaram; (b) `settings.months` — meses FIXOS dos nós de indicador (o
//   slide não depende da barra de período), aplicados pela action.
// v1.11 (01/10/2026): a Tree DESDOBRA METAS (0149).
//   (a) nós operacionais no mapa livre — Indicador (meta × realizado ×
//       atingimento por mês do período do painel, e o projetado dos filhos),
//       Plano de ação (5W2H) e Ritual ("Agendar próxima" / automático). Os
//       números vêm de `loadTreeIndicatorValues` (widget-scope + o MESMO dono
//       da Tabela de metas); o corpo e o editor moram em `tree-op-nodes.tsx`;
//   (b) `settings.rootRef`: o widget mostra só o GALHO a partir de um nó —
//       uma árvore, várias vistas (cada slide, o galho dele);
//   (c) o widget recebe dashboardId/widgetId/scopeKey do card: os valores
//       re-buscam quando o período do painel muda, e o tick do event bus
//       re-busca em silêncio (§4.10).
// v1.10 (01/10/2026): (a) o filtro "O que exibir" NUNCA esconde anotação —
//   era o "+ Galho na raiz não faz nada": a branch nascia e o filtro a sumia
//   na hora (o widget real tinha showKinds sem "note"). Tarefa e comentário
//   criados com o tipo filtrado avisam por toast em vez de sumir calados.
//   (b) na Root a criação mora DENTRO do canvas (rascunho, clique direito,
//   conversão de anotação em comentário/tarefa, edição no card) — o
//   compositor deste widget ficava FORA do portal da tela cheia, atrás do
//   canvas. Ele segue só na Lista. (c) vocabulário "branch".
// v1.9 (30/09/2026): visualização ROOT e mapa LIVRE.
//   (a) `settings.view === "root"` desenha a MESMA árvore no canvas da Root
//       (`tree-root-view.tsx`): galhos arrastáveis, colapsáveis, que abrem
//       para o lado ou para baixo, e o caminho até o Resultado esperado;
//   (b) a fonte LIVRE passou a existir — o mapa por chave, sem registro
//       (`loadMapTree`). Antes escolhê-la mostrava o vazio para sempre;
//   (c) de QUALQUER nó sai um galho novo — anotação (da Tree), tarefa (o
//       editor de sempre, pendurada no nó) ou comentário (feed do registro),
//       nas duas visualizações;
//   (d) as peças do nó (ações, data, controles da série) saíram para
//       `tree-node-parts.tsx`, compartilhadas com a Root — uma segunda cópia
//       seria a régua paralela da invariante 25.
// v1.8 (11/09/2026): a proposta da IA saiu daqui para o DOCK do painel.
//   O bug que isso conserta primeiro é o mais bobo: `submitDraft` fechava o
//   compositor ANTES de disparar a análise, e o compositor era o único lugar
//   que renderizava o spinner — a tela ficava literalmente muda enquanto a IA
//   trabalhava. Mas mover o estado não foi só por isso: aqui dentro ele não
//   sobrevive ao clique na próxima linha da tabela (o widget segue o foco e
//   remonta) nem à troca de aba, e o pedido é poder comentar no próximo
//   registro enquanto a análise do anterior ainda roda.
// Versão: 1.7 | Data: 10/09/2026
// v1.7 (10/09/2026): a proposta da IA deixou de ser só "agendar". Ela cobre
//   criar, editar, concluir e excluir (até 3 por comentário), porque o que a
//   pessoa escreve raramente é só "abra uma tarefa" — "ele pediu para adiar a
//   proposta e cancelar a demo" são um editar e um excluir. O cartão passou a
//   LISTAR o que vai acontecer, com a exclusão marcada: é a única do lote que
//   some com dado, e o clique continua sendo um só.
// v1.6 (10/09/2026): a árvore ganha o que faltava para ser o lugar de conduzir
//   o lead, e não só de olhar para ele.
//   (a) CRIAR sequência, não só ajustar a que existe. O construtor é o MESMO
//       (`AutomationRuleEditor`, hospedado em `tree-series-sheet.tsx`), e a
//       árvore passa a desenhar UM TRONCO POR SÉRIE — antes só a regra que
//       concedeu o atributo tinha tronco, então uma segunda série virava
//       tarefas soltas.
//   (b) CONCLUIR virou palavra. A caixa nativa ao lado da caixa de seleção
//       eram duas caixas, e a diferença de forma não segurou a distinção.
//   (c) o verbo do comentário mudou (o antigo não era o que se fala aqui) e
//       agora mora em `TREE_COMMENT_VERB`, não em literal de tela. Junto: o
//       botão do NÓ finalmente pendura o comentário NAQUELE nó — antes o nó
//       chegava e era descartado, e tudo caía na ocorrência de hoje.
//   (d) "Salvar e analisar": a IA lê o comentário e, se ele pedir um próximo
//       passo, propõe a tarefa num cartão de um clique. Ela nunca escreve — o
//       Agendar re-valida e grava pelo `createTask` de sempre (invariante 25).
// v1.5 (10/09/2026): SELEÇÃO MÚLTIPLA com cascata tri-estado. Marcar um nó-pai
//   marca o galho; desmarcar UM filho deixa o pai parcial e preserva os
//   irmãos. A regra é pura e mora em `lib/tree/selection.ts` — aqui só o
//   estado e o JSX. Nó de "Alteração" não é selecionável (fato do audit_log).
// v1.4 (10/09/2026): o nó CONCLUI e EXCLUI. Abrir a tarefa inteira (v1.3) não
//   bastava: o TaskSheet é editor, e por desenho não conclui nem apaga — então
//   a árvore era o único lugar do app onde não se podia fechar uma tarefa nem
//   apagar um comentário. Reusa `useTaskRowActions` (a MESMA regra da lista de
//   tarefas), `deleteComment` (0066) e a `deleteTreeNode` nova para o nó livre.
//   Nó de "Alteração" segue sem ação: é fato do audit_log, não se apaga.
//   Junto: o substantivo do tronco virou dado (ver lib/series/types.ts v1.4).
// v1.3 (09/09/2026): o nó ABRE A TAREFA INTEIRA. Antes um nó mostrava título e
//   data e mais nada, e o "agendar tarefa" era um Input de título só — a tarefa
//   nascia sem prazo (o `dueDate` que a action aceita nunca era enviado). Agora
//   clicar num nó abre o MESMO editor que o resto do app usa (TaskSheet), com
//   prazo, hora, descrição e responsável; e a ocorrência prevista que não
//   virou tarefa abre o editor JÁ com a data dela. Nada de editor novo: um
//   segundo seria a régua paralela da invariante 25.
// v1.2 (09/09/2026): a árvore RESPONDE ao clique. Três defeitos juntos:
//   (a) o título do registro clicado já viajava no contexto de foco e era
//       jogado fora — o nome só aparecia quando o payload inteiro chegava;
//   (b) trocar de registro não limpava `data`, então a tela seguia mostrando
//       a árvore E o nome do lead ANTERIOR até a nova chegar (não era só
//       demora: era informação errada em tela);
//   (c) só o ramo silencioso do §4.10 estava implementado, então a troca de
//       registro — que é ação do USUÁRIO — não acendia nada.
// v1.1 (09/09/2026): (a) sem registro fixo, o widget SEGUE o registro em
//   foco do painel (o clique da tabela) — antes ficava eternamente vazio;
//   (b) filtro por tipo de nó (settings.showKinds); (c) JANELA com ordem e
//   "carregar mais": um acompanhamento de dois anos tem ~50 galhos.
// Widget TREE (0134): a árvore de acompanhamento de um registro — e, no modo
// livre, o mapa mental.
//
// O que ela responde, e nenhum gráfico respondia: "como o vendedor está
// conduzindo este lead". O tronco são as OCORRÊNCIAS da série (derivadas,
// então a que ninguém fez também aparece) e cada comentário, tarefa e alteração
// pendura naquela em cuja janela caiu.
//
// Render em HTML/CSS, não SVG: os nós têm texto de tamanho variável e ações
// dentro deles (comentar, agendar, pausar), e um <foreignObject> para cada um
// custaria mais do que a linha de conexão vale. As linhas são bordas.
//
// Refetch: origem do EVENT BUS é silenciosa (§4.10) — o sync do Bitrix roda a
// cada minuto e uma árvore que pisca sozinha lê como defeito.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  Pause,
  Play,
  Sparkles,
  Star,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TaskSheet, type TaskFormContext } from "@/components/tarefas/task-sheet";
import {
  useAiSuggestions,
  useHasAiSuggestions,
} from "@/components/dashboards/ai-suggestions-context";
import { useWarmupReady } from "@/components/dashboards/presentation-warmup";
import {
  addTreeNote,
  attachTaskToMap,
  convertTreeNote,
  createTreeNode,
  createTreeNote,
  deleteTreeNode,
  loadMapTree,
  loadRecordTree,
  scheduleRitualOccurrence,
  setTreeNodeGeometry,
  setTreeNodeGoal,
  setTreeNodeParent,
  convertNoteToOperational,
  updateTreeNode,
  updateTreeNote,
  type TreeData,
  type TreeNoteStatus,
} from "@/app/(app)/dashboards/tree-actions";
import { usePresenting } from "../presenting-context";
import { useDashboardStyle } from "../dashboard-style-context";
import { isClassicStyle } from "@/lib/dashboards/style";
import {
  parsePresentationSettings,
  treeChrome,
  type TreeNodeDisplay,
} from "@/lib/tree/display";
import { parseIndicatorPayload } from "@/lib/tree/payload";
import { fieldLabel } from "@/lib/widgets/fields";
import type { RealizedCatalog } from "@/components/indicators/realized-source-editor";
import { TreeNodeFocusDialog, TreeNoteEditSheet, type NoteEditInput } from "./tree-node-focus";
import { TreeSeriesSheet } from "./tree-series-sheet";
import { useRecordFocus } from "../record-focus-context";
import { setRecordAttributeStatus } from "@/lib/attributes/actions";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import {
  BUS_REFETCH_DELAY_MS,
  useRefetchOrigin,
} from "@/lib/feedback/use-refetch-origin";
import { useBulkSelection } from "@/lib/feedback/use-bulk-selection";
import {
  allSelectableRefs,
  cascadeIds,
  nextCascadeValue,
  nodeCheckState,
  partitionSelection,
  selectableRefs,
} from "@/lib/tree/selection";
import { moveSubtree } from "@/lib/tree/path";
import { TreeBulkBar } from "./tree-bulk-bar";
import {
  normalizeMapKey,
  TREE_ALWAYS_VISIBLE_KINDS,
  TREE_COMMENT_VERB,
  TREE_NODE_KIND_LABELS,
  TREE_WINDOW_STEP,
  type TreeBranchKind,
  type TreeDirection,
  type TreeFilterableKind,
  type TreeNode,
  type TreeScope,
} from "@/lib/tree/model";
import type { TreeSettings } from "@/lib/widgets/types";
import {
  AddBranchMenu,
  KIND_TONE,
  NodeActions,
  NodeDate,
  TreeTaskComposer,
  type NodeActionsContext,
} from "./tree-node-parts";
import { TreeRootView, type RootCreateInput } from "./tree-root-view";
import {
  isOperationalNode,
  OperationalBody,
  OperationalNodeSheet,
  operationalSize,
  TreeOpsProvider,
  useTreeOps,
  type OperationalDraft,
  type OperationalSaveInput,
  type TreeOpsValue,
} from "./tree-op-nodes";
import {
  loadTreeIndicatorValues,
  saveTreeIndicatorGoal,
  type TreeIndicatorValues,
} from "@/app/(app)/dashboards/goal-table-actions";
import { indicatorRequestsOf, nodeSeriesKey, seriesKey } from "@/lib/tree/payload";
import { useGoalMetrics } from "@/components/goal-metrics-context";
import { ROOT_NODE_HEIGHT, ROOT_NODE_WIDTH } from "@/lib/tree/root-layout";
import { updateComment } from "@/lib/comments/actions";
import { notifyActionError } from "@/lib/feedback/notify";
import { toast } from "sonner";

/** O que o NodeCard precisa saber sobre a seleção (v1.5). */
interface NodeSelection {
  selected: Set<string>;
  /** Aplica a cascata: o nó e o galho dele acompanham o clique. */
  onToggle: (node: TreeNode) => void;
  /** v1.9: puxar um galho novo deste nó. */
  onAddBranch?: (kind: TreeBranchKind, parent: TreeNode | null) => void;
  /** v1.14: duplo-clique — o cartão em destaque. */
  onOpenFocus?: (node: TreeNode) => void;
}

function NodeCard({
  node,
  actx,
  selection,
}: {
  node: TreeNode;
  /** v1.9: as ações do nó — as MESMAS da Root (`NodeActions`). */
  actx: NodeActionsContext;
  selection: NodeSelection;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  // O nó de tarefa E a ocorrência já fundida com uma tarefa carregam o id.
  const task = node.refId ? (actx.taskById.get(node.refId) ?? null) : null;
  // DERIVADO dos descendentes: é o que faz desmarcar um filho deixar o pai
  // parcial. Nó sem nada selecionável abaixo não mostra caixa nenhuma.
  const checkState = nodeCheckState(selection.selected, node);
  const selectable = selectableRefs(node).length > 0;
  // v1.14: o que o cartão mostra ao apresentar (lib/tree/display.ts).
  const ops = useTreeOps();
  const chrome = treeChrome(ops?.presentation, ops?.displayOf?.(node) ?? null, ops?.presenting ?? false);

  return (
    <div className="flex flex-col">
      <div
        className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${
          KIND_TONE[node.kind] ?? "border-muted"
        }`}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input, textarea, [role='checkbox']")) return;
          selection.onOpenFocus?.(node);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Recolher" : "Expandir"}
            className="text-muted-foreground shrink-0"
          >
            {open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {selectable && !ops?.presenting ? (
          <Checkbox
            checked={checkState}
            onCheckedChange={() => selection.onToggle(node)}
            aria-label={`Selecionar ${TREE_NODE_KIND_LABELS[node.kind]}`}
          />
        ) : null}

        {chrome.kindBadge ? (
          <Badge variant="outline" className="shrink-0 text-xs">
            {TREE_NODE_KIND_LABELS[node.kind]}
          </Badge>
        ) : null}
        {node.goal ? (
          <Badge className="shrink-0 bg-amber-500 text-xs text-white">
            Resultado
          </Badge>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm" title={node.label}>
          {node.label}
        </span>
        {node.status ? (
          <span className="text-muted-foreground text-xs">{node.status}</span>
        ) : null}
        <NodeDate node={node} task={task} />

        {/* v1.9: o miolo de ações saiu para `NodeActions` (tree-node-parts),
            compartilhado com a Root — e o "+" puxa um galho de QUALQUER nó. */}
        {ops?.presenting ? null : <NodeActions node={node} actx={actx} />}
        {selection.onAddBranch && chrome.addBranch ? (
          <AddBranchMenu
            parent={node}
            scopeKind={actx.scope.kind}
            onPick={selection.onAddBranch}
            compact
          />
        ) : null}
      </div>

      {/* v1.11: indicador/plano/ritual trazem o próprio corpo. */}
      {isOperationalNode(node) ? (
        <div className="ml-6 max-w-md rounded-md border border-dashed px-2 py-1.5">
          <OperationalBody node={node} />
        </div>
      ) : null}

      {open && hasChildren ? (
        // A linha de conexão é a borda esquerda: o galho é visual, não SVG.
        <div className="border-muted ml-4 flex flex-col gap-1.5 border-l pt-1.5 pl-3">
          {node.children.map((c) => (
            <NodeCard key={c.id} node={c} actx={actx} selection={selection} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Recorta a árvore pelos tipos escolhidos (`settings.showKinds`), preservando
 * o desenho: um nó escondido ENTREGA os filhos ao pai dele em vez de levá-los
 * junto — esconder "Alteração" não pode fazer sumir o comentário que caiu
 * embaixo de uma. Lista vazia/ausente = tudo.
 *
 * v1.6: o nó de SEQUÊNCIA nunca é recortado. Ele não é um tipo de fato — é o
 * agrupador dos troncos, e sumir com ele entregaria as ocorrências de duas
 * séries à mesma raiz, misturadas, além de levar junto os controles da série.
 */
function filterKinds(
  nodes: TreeNode[],
  keep: TreeFilterableKind[] | undefined
): TreeNode[] {
  if (!keep || keep.length === 0) return nodes;
  // v1.10: a anotação é o que se desenha na própria árvore — nunca some pelo
  // filtro (esconder fazia a branch recém-criada sumir no mesmo instante).
  const set = new Set<string>([...keep, "series", ...TREE_ALWAYS_VISIBLE_KINDS]);
  const walk = (list: TreeNode[]): TreeNode[] =>
    list.flatMap((n) => {
      const children = walk(n.children);
      return set.has(n.kind) ? [{ ...n, children }] : children;
    });
  return walk(nodes);
}

export function TreeWidget({
  settings,
  recordId,
  dataChangedAt,
  dashboardId,
  widgetId,
  scopeKey: boardScopeKey,
  catalog = null,
  isAdmin = false,
}: {
  settings: TreeSettings | undefined;
  /** Registro em foco: o do settings, ou o que a tabela clicou. */
  recordId: string | null;
  /** Carimbo do event bus — muda quando um registro mudou. */
  dataChangedAt?: number;
  /** v1.11: o painel (os nós de indicador leem pelo widget-scope). */
  dashboardId?: string;
  widgetId?: string;
  /** v1.11: fingerprint de escopo da page (período/filtros/config). */
  scopeKey?: string;
  /** v1.14: catálogo do editor de fórmula (fonte do realizado). */
  catalog?: RealizedCatalog | null;
  /** v1.14: admin — edita metas no próprio nó. */
  isAdmin?: boolean;
}) {
  // v1.9: a fonte LIVRE é um mapa por chave, sem registro nenhum.
  const isMap = settings?.source === "livre";
  const mapKey = isMap ? normalizeMapKey(settings?.mapKey) : null;
  // v1.1 (09/09/2026): sem registro fixo, o widget SEGUE o foco do painel (o
  // clique da tabela). Antes ele só lia o settings e ficava eternamente vazio.
  const focus = useRecordFocus();
  const follows = !isMap && recordId == null;
  const effectiveRecordId = isMap ? null : (recordId ?? (follows ? focus.recordId : null));
  const { registerFollower } = focus;

  // A tabela precisa saber se há uma Tree para focar: sem seguidor, o clique
  // abre o painel lateral em vez de focar no vazio.
  useEffect(() => {
    if (!follows) return;
    return registerFollower();
  }, [follows, registerFollower]);

  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(TREE_WINDOW_STEP);
  // O compositor inline guarda o NÓ em que a pessoa clicou (v1.6). v1.9: e o
  // TIPO do galho — comentário (feed do registro) ou anotação (da Tree), com o
  // estado da anotação (texto livre / etapa) e o marcador de Resultado.
  const [draft, setDraft] = useState<{
    kind: "comment" | "note";
    text: string;
    nodeId: string | null;
    noteStatus?: TreeNoteStatus;
    goal?: boolean;
  } | null>(null);
  // v1.9: a tarefa nova pendurada num galho — o editor de sempre, por estado.
  const [taskDraft, setTaskDraft] = useState<{
    parentRef: string | null;
    /** v1.10: o texto já digitado no rascunho da Root. */
    title?: string;
  } | null>(null);
  // v1.8: a proposta da IA NÃO mora aqui. Ela é uma conversa no dock do
  // painel (ai-suggestions-context) — este widget só a ABRE.
  const dock = useAiSuggestions();
  const hasDock = useHasAiSuggestions();
  const { save } = useBackgroundSave();
  const lastJson = useRef<string>("");

  const layout = isMap ? "livre" : (settings?.layout ?? "por_ocorrencia");
  const view = settings?.view ?? "lista";
  const rootDirection: TreeDirection = settings?.rootDirection ?? "h";

  const scope: TreeScope | null = isMap
    ? mapKey
      ? { kind: "livre", mapKey }
      : null
    : effectiveRecordId
      ? { kind: "record", recordId: effectiveRecordId }
      : null;
  const scopeId = scope
    ? scope.kind === "record"
      ? scope.recordId
      : `mapa:${scope.mapKey}`
    : "";

  /**
   * O que o usuário escolheu ver. Trocar qualquer parte disto é ação DELE e
   * pede feedback; o tick do event bus não mexe aqui e por isso é silencioso.
   */
  const rootRef = isMap ? (settings?.rootRef ?? "").trim() : "";
  const scopeKey = `${scopeId}|${layout}|${order}|${limit}|${rootRef}`;

  // O payload guarda o ESCOPO a que pertence. É isso que faz a árvore do
  // registro anterior sumir no mesmo instante do clique, sem `setState` dentro
  // de efeito (que a regra do projeto proíbe): a decisão é derivada no render.
  const [payload, setPayload] = useState<{ scope: string; data: TreeData } | null>(
    null
  );
  const data = payload?.scope === scopeKey ? payload.data : null;

  // --- seleção múltipla (v1.5) ---
  // O universo é o que está VISÍVEL depois do filtro por tipo e da janela: os
  // hooks vêm antes dos early returns, então `data` ainda pode ser null aqui.
  const universe = useMemo(
    () =>
      data ? allSelectableRefs(filterKinds(data.nodes, settings?.showKinds)) : [],
    [data, settings?.showKinds]
  );
  const universeIds = useMemo(() => universe.map((r) => r.nodeId), [universe]);
  const bulk = useBulkSelection(universeIds);
  const picked = useMemo(
    () => partitionSelection(universe, bulk.selected),
    [universe, bulk.selected]
  );
  const { setMany } = bulk;
  // A cascata: o clique no nó leva o galho junto, e um estado PARCIAL resolve
  // para "marcar tudo" (desmarcar tudo continua a um clique de distância).
  const toggleNode = useCallback(
    (node: TreeNode) =>
      setMany(cascadeIds(node), nextCascadeValue(nodeCheckState(bulk.selected, node))),
    [setMany, bulk.selected]
  );

  const refresh = useCallback(async () => {
    if (!scope) return;
    const scopeAtCall = scopeKey;
    const next =
      scope.kind === "livre"
        ? await loadMapTree(scope.mapKey, { rootRef: rootRef || null })
        : await loadRecordTree(scope.recordId, layout, { order, limit });
    // Payload idêntico não re-renderiza: o tick do sync roda a cada minuto e
    // não pode fazer a árvore piscar para quem só está lendo.
    const json = `${scopeAtCall}::${JSON.stringify(next)}`;
    if (json !== lastJson.current) {
      lastJson.current = json;
      setPayload({ scope: scopeAtCall, data: next });
    }
    // `scope` é derivado de `scopeKey` (que o carrega inteiro).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, layout, order, limit]);

  const originOf = useRefetchOrigin(scopeKey);

  // v1.15 (09/10/2026): carga inicial do Bitrix em curso — confere de 5 em 5 s.
  // O `refresh` não re-renderiza com payload idêntico, então nada pisca.
  const inboundLoading = Boolean(data?.inboundLoading);
  useEffect(() => {
    if (!inboundLoading) return;
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [inboundLoading, refresh]);

  useEffect(() => {
    // A ORIGEM decide o ritmo (§4.10): o que o usuário causou vai agora; o
    // aviso do event bus espera e coalesce, porque ninguém está esperando.
    const userCaused = originOf();
    if (userCaused) {
      void refresh();
      return;
    }
    const t = window.setTimeout(() => void refresh(), BUS_REFETCH_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [refresh, dataChangedAt, originOf]);

  // --- v1.11: valores dos nós de INDICADOR (e dos indicadores dos planos) ---
  const requests = useMemo(
    () => (data && isMap ? indicatorRequestsOf(data.nodes) : []),
    [data, isMap]
  );
  const requestsKey = JSON.stringify(requests);
  // v1.14: `valuesTick` re-busca os números depois de editar uma meta no nó.
  const [valuesTick, setValuesTick] = useState(0);
  const valuesKey = `${requestsKey}|${boardScopeKey ?? ""}|${valuesTick}`;
  const [values, setValues] = useState<{ key: string; data: TreeIndicatorValues } | null>(
    null
  );
  const valuesJson = useRef<string>("");
  const valuesOrigin = useRefetchOrigin(valuesKey);
  useEffect(() => {
    if (!dashboardId || !widgetId || requests.length === 0) return;
    const userCaused = valuesOrigin();
    let cancelled = false;
    const t = window.setTimeout(
      () => {
        void loadTreeIndicatorValues(dashboardId, widgetId, requests, window.location.search).then(
          (res) => {
            if (cancelled) return;
            const json = `${valuesKey}::${JSON.stringify(res)}`;
            if (json === valuesJson.current) return;
            valuesJson.current = json;
            setValues({ key: valuesKey, data: res });
          }
        );
      },
      userCaused ? 60 : BUS_REFETCH_DELAY_MS
    );
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // `requests` é derivado de `requestsKey` (deps reais: o conteúdo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId, widgetId, valuesKey, dataChangedAt, valuesOrigin]);

  // v1.12: pré-render da apresentação — pronta com a árvore e os números.
  useWarmupReady(
    widgetId,
    !scope ||
      (data !== null &&
        (requests.length === 0 || !dashboardId || !widgetId || values?.key === valuesKey))
  );

  const [scheduling, setScheduling] = useState<ReadonlySet<string>>(() => new Set());
  const [opDraft, setOpDraft] = useState<OperationalDraft | null>(null);
  const [opSaving, setOpSaving] = useState(false);
  const goalMetrics = useGoalMetrics();
  const indicatorOptions = useMemo(
    () => goalMetrics.map((m) => ({ value: m.key, label: m.label })),
    [goalMetrics]
  );

  // v1.14: apresentação, estilo e exibição por cartão.
  const presenting = usePresenting();
  const dstyle = useDashboardStyle();
  const styled = !isClassicStyle(dstyle);
  const presentation = useMemo(
    () => parsePresentationSettings(settings?.presentation),
    [settings?.presentation]
  );
  const geoByRef = useMemo(
    () => new Map((data?.geometry ?? []).map((g) => [g.nodeRef, g])),
    [data?.geometry]
  );
  const fieldLabelOf = useMemo(() => {
    const available = catalog?.available ?? [];
    return (ref: string) => (available.length > 0 ? fieldLabel(ref, available) : ref);
  }, [catalog?.available]);

  // v1.14: valores correntes separados do objeto de contexto (que carrega
  // callbacks) — o editor do nó os lê durante o render.
  const currentValues = values?.key === valuesKey ? values.data : null;
  const opMonths = useMemo(() => currentValues?.months ?? [], [currentValues]);
  const opSeries = useMemo(
    () =>
      new Map(
        (currentValues?.series ?? []).map((x) => [
          // v1.14: série de nó de indicador chaveada pelo NÓ.
          x.nodeId ? nodeSeriesKey(x.nodeId) : seriesKey(x.key, x.responsible),
          x,
        ])
      ),
    [currentValues]
  );
  const opsValue: TreeOpsValue | null = useMemo(() => {
    if (!data) return null;
    return {
      months: opMonths,
      series: opSeries,
      presenting,
      presentation,
      styled,
      fieldLabelOf,
      displayOf: (node) => geoByRef.get(node.id)?.display ?? null,
      loading: requests.length > 0 && currentValues == null,
      ritualOccurrences: data.ritualOccurrences ?? {},
      scheduling,
      onScheduleRitual: (node) => {
        if (scope?.kind !== "livre") return;
        const mk = scope.mapKey;
        setScheduling((prev) => new Set(prev).add(node.id));
        void scheduleRitualOccurrence(mk, node.id, { revalidate: false }).then((res) => {
          setScheduling((prev) => {
            const next = new Set(prev);
            next.delete(node.id);
            return next;
          });
          if (res.ok) {
            toast.success("Ocorrência agendada", {
              description: res.dueDate
                ? `Tarefa criada para ${res.dueDate.slice(8, 10)}/${res.dueDate.slice(5, 7)}.`
                : undefined,
            });
            void refresh();
          } else {
            notifyActionError("Não foi possível agendar", res.message);
          }
        });
      },
    };
    // `scope`/`refresh` mudam junto do `data` (mesmo escopo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, opMonths, opSeries, currentValues, scheduling, requests.length, presenting, presentation, styled, fieldLabelOf, geoByRef]);

  // v1.14: cartão em destaque e editor da anotação.
  const [focusNode, setFocusNode] = useState<TreeNode | null>(null);
  const [noteEdit, setNoteEdit] = useState<TreeNode | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  if (!scope) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">
        {isMap
          ? "Dê uma chave a este mapa na configuração do widget."
          : "Escolha um registro na configuração do widget, ou clique numa linha da tabela configurada para abrir a Tree."}
      </div>
    );
  }

  // Carregando: o nome do registro CLICADO já está aqui (veio no contexto de
  // foco, no mesmo instante do clique) — mostrá-lo agora é a diferença entre
  // "o sistema me ouviu" e "o sistema travou".
  if (!data) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
          <span className="truncate text-sm font-medium">
            {follows && focus.title ? focus.title : "Carregando…"}
          </span>
        </div>
        {follows && focus.title ? (
          <p className="text-muted-foreground text-xs">
            Carregando o acompanhamento deste registro…
          </p>
        ) : null}
      </div>
    );
  }

  if (data.message) {
    return <div className="text-muted-foreground p-4 text-sm">{data.message}</div>;
  }

  const visibleNodes = filterKinds(data.nodes, settings?.showKinds);
  const recordScopeId = scope.kind === "record" ? scope.recordId : null;

  // O editor de tarefa escreve pelos choke points de sempre; a árvore só
  // precisa reler os fatos depois.
  const reloadSoon = () => window.setTimeout(() => void refresh(), 400);

  /** Otimista local: troca `data` no MESMO escopo (senão o render o descarta). */
  const patchData = (next: TreeData) => setPayload({ scope: scopeKey, data: next });

  /**
   * Salva o compositor. Comentário vai pelo `addTreeNote` (feed do registro,
   * webhook incluso); anotação pelo `createTreeNote` (da Tree). `analyze` =
   * "Salvar e analisar", só do comentário.
   *
   * A gravação NÃO espera a IA: o comentário é do usuário e tem de existir
   * mesmo que o provedor esteja fora do ar (invariante 25).
   */
  const submitDraft = (analyze = false) => {
    if (!draft || draft.text.trim() === "") return setDraft(null);
    const text = draft.text.trim();
    const parentRef = draft.nodeId;
    const current = draft;
    setDraft(null);
    if (current.kind === "note") {
      save({
        key: "tree-note-new",
        context: "Não foi possível criar a anotação",
        reconcile: false,
        action: async () => {
          const res = await createTreeNote(
            scope,
            {
              parentRef,
              label: text,
              status: current.noteStatus ?? "texto",
              goal: current.goal === true,
            },
            { revalidate: false }
          );
          if (res.ok) void refresh();
          return res;
        },
      });
      return;
    }
    if (!recordScopeId) return;
    save({
      key: "tree-note",
      context: "Não foi possível comentar",
      action: () =>
        addTreeNote(recordScopeId, text, { revalidate: false, parentRef }),
    });
    // A árvore recarrega depois da escrita: o nó novo é um FATO, e ela o lê.
    window.setTimeout(() => void refresh(), 600);
    if (!analyze) return;
    dock.start({
      recordId: recordScopeId,
      recordTitle: data.recordTitle,
      comment: text,
    });
  };

  /**
   * v1.10: o filtro "O que exibir" vai esconder este tipo? Então avisar — um
   * item criado que some calado parece um botão quebrado.
   */
  const warnIfFiltered = (kind: TreeNode["kind"]) => {
    const keep = settings?.showKinds;
    if (!keep || keep.length === 0) return;
    if ((keep as string[]).includes(kind)) return;
    if (TREE_ALWAYS_VISIBLE_KINDS.includes(kind)) return;
    toast.info(`${TREE_NODE_KIND_LABELS[kind]} criado`, {
      description: `O filtro "O que exibir" deste widget esconde ${TREE_NODE_KIND_LABELS[kind].toLowerCase()}s — ajuste-o na configuração do widget para vê-lo aqui.`,
    });
  };

  /**
   * v1.10: salva o RASCUNHO da Root. Devolve o id do nó criado (a Root o usa
   * para manter a branch onde a prévia apareceu) ou null na falha.
   */
  const createFromRoot = async (input: RootCreateInput): Promise<string | null> => {
    if (input.kind === "comment") {
      if (!recordScopeId) return null;
      const res = await addTreeNote(recordScopeId, input.text, {
        revalidate: false,
        parentRef: input.parentRef,
      });
      if (!res.ok || !res.commentId) {
        notifyActionError("Não foi possível comentar", res.message);
        return null;
      }
      warnIfFiltered("comment");
      await refresh();
      if (input.analyze) {
        dock.start({
          recordId: recordScopeId,
          recordTitle: data.recordTitle,
          comment: input.text,
        });
      }
      return `comment:${res.commentId}`;
    }
    const res = await createTreeNote(
      scope,
      { parentRef: input.parentRef, label: input.text, status: "texto" },
      { revalidate: false }
    );
    if (!res.ok || !res.nodeId) {
      notifyActionError("Não foi possível criar a branch", res.message);
      return null;
    }
    await refresh();
    return res.nodeId;
  };

  /** v1.10: clique direito → a anotação vira comentário ou tarefa. */
  const convertNote = (node: TreeNode, to: "comment" | "task") => {
    if (!node.refId) return;
    save({
      key: `tree-convert:${node.refId}`,
      context: `Não foi possível converter em ${TREE_NODE_KIND_LABELS[to].toLowerCase()}`,
      reconcile: false,
      action: async () => {
        const res = await convertTreeNote(scope, node.refId!, to, {
          revalidate: false,
        });
        if (res.ok) {
          warnIfFiltered(to);
          void refresh();
        }
        return res;
      },
    });
  };

  const deleteNote = (node: TreeNode) => {
    if (!node.refId) return;
    if (
      !confirm(
        `Excluir esta ${TREE_NODE_KIND_LABELS.note.toLowerCase()}? As branches que dependem dela não são excluídas — ficam soltas na árvore.`
      )
    ) {
      return;
    }
    save({
      key: `tree-note-del:${node.refId}`,
      context: "Não foi possível excluir a anotação",
      reconcile: false,
      action: async () => {
        const res = await deleteTreeNode(node.refId!, { revalidate: false });
        if (res.ok) void refresh();
        return res;
      },
    });
  };

  /** v1.10: o comentário é digitado no card — o dono segue `updateComment`. */
  const editComment = (node: TreeNode, body: string) => {
    if (!node.refId) return;
    const before = data;
    const apply = (list: TreeNode[]): TreeNode[] =>
      list.map((n) =>
        n.id === node.id
          ? { ...n, body, label: body.slice(0, 120), children: apply(n.children) }
          : { ...n, children: apply(n.children) }
      );
    patchData({ ...data, nodes: apply(data.nodes) });
    save({
      key: `tree-comment-edit:${node.refId}`,
      context: "Não foi possível editar o comentário",
      reconcile: false,
      action: () => updateComment(node.refId!, body),
      revert: () => patchData(before),
    });
  };

  /** v1.9: "+" — a branch nova sai do nó escolhido (ou é independente). */
  const addBranch = (kind: TreeBranchKind, parent: TreeNode | null) => {
    const parentRef = parent?.id ?? null;
    if (kind === "task") return setTaskDraft({ parentRef });
    // v1.11: nó operacional abre o editor dele.
    if (kind === "indicator" || kind === "plan" || kind === "ritual") {
      return setOpDraft({ kind, node: null, parentRef, title: "" });
    }
    if (kind === "comment") {
      if (!recordScopeId) return;
      return setDraft({ kind: "comment", text: "", nodeId: parentRef });
    }
    setDraft({ kind: "note", text: "", nodeId: parentRef, noteStatus: "texto" });
  };

  /** A tarefa que o editor acabou de criar vai para a branch escolhida. */
  const hangTask = (taskId: string | null, parentRef: string | null) => {
    if (!taskId) return reloadSoon();
    warnIfFiltered("task");
    save({
      key: `tree-task-hang:${taskId}`,
      context: "A tarefa foi criada, mas não foi possível pendurá-la na branch",
      reconcile: false,
      action: async () => {
        const res =
          scope.kind === "livre"
            ? await attachTaskToMap(scope.mapKey, taskId, parentRef, {
                revalidate: false,
              })
            : parentRef
              ? await setTreeNodeParent(scope, `task:${taskId}`, parentRef, {
                  revalidate: false,
                })
              : { ok: true };
        void refresh();
        return res;
      },
    });
  };

  // --- Root: arrasto, direção e edição da anotação (otimistas) ---
  const reparent = (nodeId: string, parentId: string | null) => {
    const before = data;
    patchData({
      ...data,
      nodes: moveSubtree(data.nodes, nodeId, parentId),
      // O slot mudou: o offset do pai antigo jogaria o nó num lugar qualquer.
      geometry: data.geometry.map((g) =>
        g.nodeRef === nodeId ? { ...g, offsetX: 0, offsetY: 0 } : g
      ),
    });
    save({
      key: `tree-parent:${nodeId}`,
      context: "Não foi possível mover a branch",
      reconcile: false,
      action: async () => {
        const res = await setTreeNodeParent(scope, nodeId, parentId, {
          revalidate: false,
        });
        if (res.ok) void refresh();
        return res;
      },
      revert: () => patchData(before),
    });
  };

  const patchGeometry = (
    nodeId: string,
    patch: {
      offsetX?: number;
      offsetY?: number;
      direction?: TreeDirection;
      // v1.14 (0150): tamanho e exibição do cartão.
      width?: number | null;
      height?: number | null;
      display?: TreeNodeDisplay | null;
    }
  ) => {
    const before = data;
    const exists = data.geometry.some((g) => g.nodeRef === nodeId);
    const geometry = exists
      ? data.geometry.map((g) => (g.nodeRef === nodeId ? { ...g, ...patch } : g))
      : [
          ...data.geometry,
          {
            nodeRef: nodeId,
            offsetX: patch.offsetX ?? 0,
            offsetY: patch.offsetY ?? 0,
            direction: patch.direction ?? null,
          },
        ];
    patchData({ ...data, geometry });
    save({
      key: `tree-geometry:${nodeId}`,
      context: "Não foi possível guardar a posição da branch",
      reconcile: false,
      action: () =>
        setTreeNodeGeometry(scope, nodeId, patch, { revalidate: false }),
      revert: () => patchData(before),
    });
  };

  const editNote = (
    node: TreeNode,
    patch: { label?: string; status?: TreeNoteStatus; goal?: boolean }
  ) => {
    if (!node.refId) return;
    const before = data;
    const apply = (list: TreeNode[]): TreeNode[] =>
      list.map((n) =>
        n.id === node.id
          ? {
              ...n,
              ...(patch.label !== undefined ? { label: patch.label } : {}),
              ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
              ...(patch.status !== undefined
                ? {
                    status:
                      patch.status === "texto"
                        ? null
                        : patch.status === "concluida"
                          ? "concluída"
                          : "aberta",
                  }
                : {}),
              children: apply(n.children),
            }
          : { ...n, children: apply(n.children) }
      );
    patchData({ ...data, nodes: apply(data.nodes) });
    save({
      key: `tree-note-edit:${node.refId}`,
      context: "Não foi possível salvar a anotação",
      reconcile: false,
      action: () => updateTreeNote(node.refId!, patch, { revalidate: false }),
      revert: () => patchData(before),
    });
  };

  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const seriesByKey = new Map(data.series.map((x) => [x.key, x]));
  const taskCtx: TaskFormContext = {
    responsibles: data.responsibles,
    canAssignOthers: true,
    canLock: false,
  };
  const actx: NodeActionsContext = {
    scope,
    ctx: taskCtx,
    recordTitle: data.recordTitle,
    taskById,
    seriesByKey,
    canConfigure: data.canConfigureSeries,
    sourceKey: data.sourceKey,
    // v1.6: o NÓ viaja. Antes ele chegava aqui e era descartado, e o
    // comentário pendurava na ocorrência de hoje.
    onNote: (target) => setDraft({ kind: "comment", text: "", nodeId: target.id }),
    onChanged: reloadSoon,
    // v1.11: o editor dos nós operacionais.
    onEditOperational: (node) => {
      if (node.kind !== "indicator" && node.kind !== "plan" && node.kind !== "ritual") return;
      setOpDraft({ kind: node.kind, node, parentRef: null, title: node.label });
    },
  };

  /** v1.11: salva o nó operacional (criar, editar ou converter anotação). */
  const saveOperational = (input: OperationalSaveInput) => {
    const d = opDraft;
    if (!d) return;
    setOpSaving(true);
    const run: Promise<{ ok?: boolean; message?: string; nodeId?: string }> = d.fromNoteId
      ? convertNoteToOperational(
          scope,
          d.fromNoteId,
          { kind: d.kind, label: input.label, payload: input.payload },
          { revalidate: false }
        ).then((r) => ({ ...r, nodeId: `note:${d.fromNoteId}` }))
      : d.node?.refId
        ? updateTreeNode(
            d.node.refId,
            { kind: d.kind, label: input.label, payload: input.payload },
            { revalidate: false }
          ).then((r) => ({ ...r, nodeId: d.node!.id }))
        : createTreeNode(
            scope,
            { kind: d.kind, parentRef: d.parentRef, label: input.label, payload: input.payload },
            { revalidate: false }
          );
    void run.then(async (res) => {
      if (res.ok && res.nodeId && input.display !== undefined) {
        // v1.14: a exibição do cartão vai pela geometria (0150).
        const prev = geoByRef.get(res.nodeId)?.display ?? null;
        if (JSON.stringify(prev) !== JSON.stringify(input.display)) {
          await setTreeNodeGeometry(scope, res.nodeId, { display: input.display }, { revalidate: false });
        }
      }
      setOpSaving(false);
      if (!res.ok) {
        notifyActionError("Não foi possível salvar o nó", res.message);
        return;
      }
      setOpDraft(null);
      setValuesTick((n) => n + 1);
      void refresh();
    });
  };

  /** v1.14: editor completo da anotação (título, descrição, data, exibição). */
  const saveNoteDetails = (input: NoteEditInput) => {
    const node = noteEdit;
    if (!node?.refId) return;
    setNoteSaving(true);
    void updateTreeNote(
      node.refId,
      {
        label: input.label,
        body: input.body,
        dueDate: input.dueDate,
        status: input.status,
        goal: input.goal,
      },
      { revalidate: false }
    ).then(async (res) => {
      if (res.ok) {
        const prev = geoByRef.get(node.id)?.display ?? null;
        if (JSON.stringify(prev) !== JSON.stringify(input.display)) {
          await setTreeNodeGeometry(scope, node.id, { display: input.display }, { revalidate: false });
        }
      }
      setNoteSaving(false);
      if (!res.ok) return notifyActionError("Não foi possível salvar a anotação", res.message);
      setNoteEdit(null);
      void refresh();
    });
  };

  /** v1.14: Resultado em nó operacional (otimista). */
  const setGoal = (node: TreeNode, goal: boolean) => {
    const before = data;
    const apply = (list: TreeNode[]): TreeNode[] =>
      list.map((n) =>
        n.id === node.id ? { ...n, goal, children: apply(n.children) } : { ...n, children: apply(n.children) }
      );
    patchData({ ...data, nodes: apply(data.nodes) });
    save({
      key: `tree-goal:${node.id}`,
      context: "Não foi possível marcar o resultado",
      reconcile: false,
      action: () => setTreeNodeGoal(scope, node.id, goal, { revalidate: false }),
      revert: () => patchData(before),
    });
  };

  /** v1.14: etiquetas já usadas no mapa (sugestões do editor). */
  const tagSuggestions = (() => {
    const out = new Set<string>();
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        if (n.kind === "indicator") {
          const t = parseIndicatorPayload(n.payload)?.tag;
          if (t) out.add(t);
        }
        walk(n.children);
      }
    };
    walk(data.nodes);
    return [...out].sort();
  })();

  const opNodeId = opDraft?.node?.id ?? (opDraft?.fromNoteId ? `note:${opDraft.fromNoteId}` : null);
  const opSheet = (
    <>
      <OperationalNodeSheet
        draft={opDraft}
        onClose={() => setOpDraft(null)}
        onSave={saveOperational}
        indicatorOptions={indicatorOptions}
        responsibleOptions={data.responsibles.map((r) => ({ value: r.label, label: r.label }))}
        saving={opSaving}
        catalog={catalog}
        display={opNodeId ? (geoByRef.get(opNodeId)?.display ?? null) : null}
        tagSuggestions={tagSuggestions}
        months={opMonths}
        series={opNodeId ? opSeries.get(nodeSeriesKey(opNodeId)) : undefined}
        canEditGoals={isAdmin}
        onSaveGoal={
          opDraft?.node && dashboardId && widgetId
            ? async (month, value) => {
                const res = await saveTreeIndicatorGoal(
                  dashboardId,
                  widgetId,
                  opDraft.node!.id,
                  month,
                  value
                );
                if (!res.ok) {
                  notifyActionError("Não foi possível salvar a meta", res.message);
                  return false;
                }
                setValuesTick((n) => n + 1);
                return true;
              }
            : undefined
        }
      />
      <TreeNoteEditSheet
        node={noteEdit}
        display={noteEdit ? (geoByRef.get(noteEdit.id)?.display ?? null) : null}
        onClose={() => setNoteEdit(null)}
        onSave={saveNoteDetails}
        saving={noteSaving}
      />
      <TreeNodeFocusDialog
        node={focusNode}
        onClose={() => setFocusNode(null)}
        onEdit={
          presenting
            ? undefined
            : (n) => {
                setFocusNode(null);
                if (n.kind === "note" && n.refId) setNoteEdit(n);
                else if (isOperationalNode(n)) actx.onEditOperational?.(n);
              }
        }
      />
    </>
  );
  const rootMissingNote = data.rootMissing ? (
    <p className="text-muted-foreground text-xs">
      O galho configurado (“{rootRef}”) não existe mais neste mapa — exibindo o mapa inteiro.
    </p>
  ) : null;

  const composer = draft ? (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      <Input
        autoFocus
        value={draft.text}
        onChange={(e) => setDraft((d) => (d ? { ...d, text: e.target.value } : d))}
        placeholder={
          draft.kind === "note"
            ? "O que é esta branch? (uma etapa, uma condição, o resultado…)"
            : "O que aconteceu?"
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") submitDraft();
          if (e.key === "Escape") setDraft(null);
        }}
        aria-label={
          draft.kind === "note"
            ? TREE_NODE_KIND_LABELS.note
            : TREE_NODE_KIND_LABELS.comment
        }
        className="min-w-48 flex-1"
      />
      {draft.kind === "note" ? (
        <>
          <select
            className="border-input bg-background h-8 rounded-md border px-1 text-xs"
            value={draft.noteStatus ?? "texto"}
            aria-label="Tipo da anotação"
            onChange={(e) =>
              setDraft((d) =>
                d ? { ...d, noteStatus: e.target.value as TreeNoteStatus } : d
              )
            }
          >
            <option value="texto">Texto livre</option>
            <option value="pendente">Etapa (a concluir)</option>
          </select>
          <label className="flex items-center gap-1 text-xs">
            <Checkbox
              checked={draft.goal === true}
              onCheckedChange={(v) =>
                setDraft((d) => (d ? { ...d, goal: v === true } : d))
              }
            />
            <Star className="size-3" /> Resultado esperado
          </label>
        </>
      ) : null}
      <Button type="button" size="sm" onClick={() => submitDraft()}>
        Salvar
      </Button>
      {/* Salvar e analisar: a IA lê o texto e decide se ele pede um próximo
          passo. Só do comentário, e só onde há dock. */}
      {draft.kind === "comment" && hasDock ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1"
          title="Salva o comentário e pede à IA que avalie o que ele muda nas tarefas deste registro. A conversa abre no canto da tela."
          onClick={() => submitDraft(true)}
        >
          <Sparkles className="size-3.5" />
          Salvar e analisar
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
        Cancelar
      </Button>
    </div>
  ) : null;

  const orderButton = !isMap ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 text-xs"
      title="Inverte a ordem; 'carregar mais' anda nessa direção"
      onClick={() => {
        // Trocar a ordem volta ao primeiro passo: a janela é das N
        // ocorrências daquela ponta.
        setLimit(TREE_WINDOW_STEP);
        setOrder((o) => (o === "desc" ? "asc" : "desc"));
      }}
    >
      {order === "desc" ? "Recentes ↓" : "Antigas ↑"}
    </Button>
  ) : null;

  const loadMoreButton = data.hasMore ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 self-start text-xs"
      onClick={() => setLimit((n) => n + TREE_WINDOW_STEP)}
    >
      {order === "desc" ? "Carregar o que é mais antigo" : "Carregar o que é mais recente"}
    </Button>
  ) : null;

  const taskComposer = (
    <TreeTaskComposer
      open={taskDraft != null}
      ctx={taskCtx}
      recordId={recordScopeId}
      recordTitle={recordScopeId ? data.recordTitle : null}
      title={taskDraft?.title ?? null}
      onClose={() => setTaskDraft(null)}
      onCreated={(taskId) => hangTask(taskId, taskDraft?.parentRef ?? null)}
    />
  );

  // v1.14: ao apresentar, o cabeçalho de trabalho ("Mapa · chave") some
  // (a menos que o widget mostre avisos).
  const chromeAll = treeChrome(presentation, null, presenting);
  const header = !chromeAll.warnings ? null : (
    <div className="flex flex-wrap items-center gap-2">
      <span className="truncate text-sm font-medium">
        {isMap ? `Mapa · ${scope.kind === "livre" ? scope.mapKey : ""}` : data.recordTitle}
      </span>
      {/* v1.6: a cadência e o construtor da série moram no NÓ da sequência
          (SeriesControls) — com vários troncos, um controle aqui não teria
          como dizer de qual série ele é. */}
      <span className="ml-auto" />
      {view === "lista" ? orderButton : null}
      {data.attribute ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => {
            const next = data.attribute!.status === "pausado" ? "ativo" : "pausado";
            // Pausar NÃO remove o acompanhamento: o registro continua na
            // funcionalidade e a árvore continua inteira.
            patchData({
              ...data,
              attribute: { ...data.attribute!, status: next },
              // v1.15: retomar dispara a carga inicial do Bitrix.
              inboundLoading: next === "ativo" ? true : data.inboundLoading,
            });
            save({
              key: "tree-status",
              context: "Não foi possível alterar o acompanhamento",
              action: () =>
                setRecordAttributeStatus(data.attribute!.id, next, {
                  revalidate: false,
                }),
              revert: () => patchData(data),
            });
          }}
        >
          {data.attribute.status === "pausado" ? (
            <>
              <Play className="size-3.5" /> Retomar
            </>
          ) : (
            <>
              <Pause className="size-3.5" /> Pausar
            </>
          )}
        </Button>
      ) : null}
    </div>
  );

  // v1.15 (09/10/2026): carga inicial do Bitrix — aviso, nunca bloqueio.
  const inboundNote = data.inboundLoading ? (
    <p
      className="text-muted-foreground flex items-center gap-1.5 text-xs"
      role="status"
    >
      <Loader2 className="size-3 animate-spin" />
      Carregando atividades do Bitrix… você pode seguir usando a árvore.
    </p>
  ) : null;

  const pausedNote =
    data.attribute?.status === "pausado" ? (
      <p className="text-muted-foreground text-xs">
        Acompanhamento pausado: novas tarefas não são abertas. O registro
        continua na automação e o histórico permanece.
      </p>
    ) : null;

  // Ações do topo (fora do compositor): comentar/agendar no registro,
  // anotar em qualquer árvore, e criar sequência.
  const topActions = (
    <div className="flex flex-wrap gap-2">
      {recordScopeId ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setDraft({ kind: "comment", text: "", nodeId: null })}
        >
          <MessageSquarePlus className="size-3.5" /> {TREE_COMMENT_VERB}
        </Button>
      ) : null}
      {recordScopeId ? (
        <TaskSheet
          ctx={taskCtx}
          triggerLabel="Agendar tarefa"
          defaults={{ recordId: recordScopeId, recordTitle: data.recordTitle }}
          onDone={reloadSoon}
        />
      ) : null}
      <AddBranchMenu
        parent={null}
        scopeKind={scope.kind}
        onPick={addBranch}
        label={isMap ? "Nova branch" : "Nova branch independente"}
      />
      {/* v1.6: criar OUTRA sequência. */}
      {data.canConfigureSeries && data.sourceKey ? (
        <TreeSeriesSheet
          sourceKey={data.sourceKey}
          suggestedName=""
          onSaved={reloadSoon}
        />
      ) : null}
    </div>
  );

  // --- ROOT (v1.9) ---
  if (view === "root") {
    return (
      <TreeOpsProvider value={opsValue}>
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3">
        {header}
        {inboundNote}
        {pausedNote}
        {rootMissingNote}
        {/* v1.10: sem o compositor externo — na Root a criação é um rascunho
            DENTRO do canvas, que vai junto para a tela cheia. */}
        <TreeRootView
          key={scopeId}
          canvas={settings?.canvas}
          nodes={visibleNodes}
          geometry={data.geometry}
          defaultDirection={rootDirection}
          storageKey={`tree-root:collapsed:${scopeId}`}
          scope={scope}
          actx={actx}
          onCreate={createFromRoot}
          onCreateTask={({ parentRef, title }) => setTaskDraft({ parentRef, title })}
          onConvert={convertNote}
          onDeleteNote={deleteNote}
          onEditComment={editComment}
          onReparent={reparent}
          onMove={(id, offset) =>
            patchGeometry(id, { offsetX: offset.x, offsetY: offset.y })
          }
          onDirection={(id, direction) => patchGeometry(id, { direction })}
          onEditNote={editNote}
          canAnalyze={hasDock}
          toolbarExtra={
            <>
              {orderButton}
              {loadMoreButton}
            </>
          }
          sizeOf={(n) =>
            operationalSize(n, opsValue?.months.length || 3) ?? {
              w: ROOT_NODE_WIDTH,
              h: ROOT_NODE_HEIGHT,
            }
          }
          renderBody={(n) => (isOperationalNode(n) ? <OperationalBody node={n} /> : null)}
          onCreateOperational={({ kind, parentRef, title }) =>
            setOpDraft({ kind, node: null, parentRef, title })
          }
          presentation={presentation}
          onResize={(id, size) =>
            patchGeometry(id, { width: size?.w ?? null, height: size?.h ?? null })
          }
          onOpenFocus={setFocusNode}
          onEditNoteDetails={setNoteEdit}
          onConvertOperational={(node, kind) =>
            node.refId
              ? setOpDraft({ kind, node: null, parentRef: null, title: node.label, fromNoteId: node.refId })
              : undefined
          }
          onSetGoal={setGoal}
        />
        {taskComposer}
        {opSheet}
      </div>
      </TreeOpsProvider>
    );
  }

  return (
    <TreeOpsProvider value={opsValue}>
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      {header}
      {inboundNote}
      {pausedNote}
      {rootMissingNote}
      {composer ?? topActions}

      {visibleNodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {isMap
            ? "O mapa está vazio. Comece pelo resultado esperado."
            : "Nada aconteceu com este registro ainda."}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visibleNodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              actx={actx}
              selection={{
                selected: bulk.selected,
                onToggle: toggleNode,
                onAddBranch: addBranch,
                onOpenFocus: setFocusNode,
              }}
            />
          ))}
          <TreeBulkBar
            taskIds={picked.taskIds}
            commentIds={picked.commentIds}
            noteIds={picked.noteIds}
            onClear={bulk.clear}
            onDone={() => {
              bulk.clear();
              reloadSoon();
            }}
          />
        </div>
      )}

      {loadMoreButton}
      {taskComposer}
      {opSheet}
    </div>
    </TreeOpsProvider>
  );
}
