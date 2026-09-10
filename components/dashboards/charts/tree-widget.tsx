// Versão: 1.6 | Data: 10/09/2026
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  Pause,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TaskSheet, type TaskFormContext } from "@/components/tarefas/task-sheet";
import {
  TaskCompleteButton,
  TaskDeleteButton,
  TaskSeriesPrompt,
  useTaskRowActions,
} from "@/components/tarefas/task-list";
import { deleteComment } from "@/lib/comments/actions";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";
import type { TaskRow } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import {
  addTreeNote,
  analyzeComment,
  applyCommentTask,
  deleteTreeNode,
  loadRecordTree,
  setRecordCadence,
  type TreeData,
} from "@/app/(app)/dashboards/tree-actions";
import { resumeRecordSeries } from "@/lib/tasks/actions";
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
import { TreeBulkBar } from "./tree-bulk-bar";
import type { TreeSeriesInfo } from "@/lib/tree/load";
import {
  TREE_COMMENT_VERB,
  TREE_NODE_KIND_LABELS,
  TREE_WINDOW_STEP,
  type TreeFilterableKind,
  type TreeNode,
} from "@/lib/tree/model";
import type { TreeSettings } from "@/lib/widgets/types";

const KIND_TONE: Record<string, string> = {
  series: "border-primary bg-primary/10",
  occurrence: "border-primary/50 bg-primary/5",
  task: "border-amber-500/40",
  comment: "border-emerald-500/40",
  change: "border-muted",
  note: "border-sky-500/40",
};

/**
 * A data do nó, com a mesma leitura de prazo do resto do app.
 *
 * v1.3 (09/09/2026): antes era uma data crua, e vazio virava string vazia —
 * indistinguível de "carregando". Reusa `classifyDue`/`formatDateValue`, os
 * mesmos do `DueBadge` da lista de tarefas: atrasada em vermelho, em breve em
 * âmbar. Quando o nó É uma tarefa, a data mostrada é o prazo DELA.
 */
function NodeDate({ node, task }: { node: TreeNode; task: TaskRow | null }) {
  if (task?.due_date) {
    const status = classifyDue(task);
    const text = `${formatDateValue(task.due_date, DEFAULT_DATE_FORMAT)}${
      task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""
    }`;
    return (
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap",
          status === "atrasada" &&
            "bg-destructive/10 text-destructive font-medium",
          status === "em_breve" &&
            "bg-amber-500/15 font-medium text-amber-700 dark:text-amber-400",
          !status && "text-muted-foreground bg-muted"
        )}
        title={status ? DUE_STATUS_LABELS[status] : undefined}
      >
        {text}
      </span>
    );
  }
  if (!node.at) {
    // "sem prazo" é informação; a string vazia de antes parecia defeito.
    return <span className="text-muted-foreground shrink-0 text-xs">sem prazo</span>;
  }
  return (
    <span className="text-muted-foreground shrink-0 text-xs">
      {formatDateValue(node.at, DEFAULT_DATE_FORMAT)}
    </span>
  );
}

/**
 * Concluir/reabrir e excluir a tarefa DO NÓ.
 *
 * Componente próprio porque o hook não pode ser condicional e nem todo nó tem
 * tarefa. A regra (quais actions, o evento do bus, a mensagem de RLS) é a
 * MESMA da lista — `useTaskRowActions` é o dono único (invariante 25).
 */
function TaskNodeActions({
  task,
  onChanged,
}: {
  task: TaskRow;
  onChanged: () => void;
}) {
  const { done, pending, error, toggle, remove, seriesPrompt } =
    useTaskRowActions(task, onChanged);
  return (
    <>
      {/* v1.6: a pergunta "e as demais da sequência?" mora no hook, que é o
          dono único de concluir e excluir; aqui só o lugar de renderizá-la. */}
      <TaskSeriesPrompt prompt={seriesPrompt} pending={pending} />
      <TaskCompleteButton done={done} pending={pending} onToggle={toggle} />
      <TaskDeleteButton
        pending={pending}
        onRemove={() => {
          // Ocorrência de série já tem o diálogo da sequência como
          // confirmação — um `confirm()` antes dele seriam duas perguntas
          // seguidas para a mesma decisão.
          if (task.series_occurrence != null && task.series_key) return remove();
          if (confirm(`Excluir a tarefa "${task.title}"?`)) remove();
        }}
      />
      {error ? (
        <span className="text-destructive text-xs" role="status">
          {error}
        </span>
      ) : null}
    </>
  );
}

/**
 * Excluir um nó que NÃO é tarefa — o comentário (`comments`, 0066) e a nota
 * livre (`tree_nodes`). Cada uma pelo choke point que já é dono dela.
 */
function NodeDeleteButton({
  label,
  confirmText,
  onDelete,
  onChanged,
}: {
  label: string;
  confirmText: string;
  onDelete: () => Promise<{ ok?: boolean; message?: string }>;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        disabled={pending}
        aria-label={label}
        title={label}
        onClick={() => {
          if (!confirm(confirmText)) return;
          setError(null);
          startTransition(async () => {
            const res = await onDelete();
            if (res.ok) onChanged();
            else setError(res.message ?? "Falha ao excluir.");
          });
        }}
      >
        <Trash2 className="size-3.5" />
      </Button>
      {error ? (
        <span className="text-destructive text-xs" role="status">
          {error}
        </span>
      ) : null}
    </>
  );
}

/**
 * Os controles de UMA sequência: cadência deste registro, encerrar/retomar e o
 * construtor da automação.
 *
 * v1.6: eram do cabeçalho, quando a árvore tinha um tronco só. Com vários, o
 * lugar deles é o NÓ da sequência — cadência é por série, e um controle no topo
 * não teria como dizer de qual.
 */
function SeriesControls({
  series,
  recordId,
  canConfigure,
  sourceKey,
  onChanged,
}: {
  series: TreeSeriesInfo;
  recordId: string;
  canConfigure: boolean;
  sourceKey: string | null;
  onChanged: () => void;
}) {
  const { save } = useBackgroundSave();
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      <span className="text-muted-foreground text-xs">a cada</span>
      <Input
        type="number"
        min={1}
        max={365}
        defaultValue={series.cadenceDays}
        className="h-7 w-16 text-xs"
        aria-label={`Cadência de "${series.ruleName}" neste registro, em dias`}
        title="Cadência só deste registro. Vazio volta ao padrão do esquema."
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const days = raw === "" ? null : Number(raw);
          if (days != null && (!Number.isFinite(days) || days < 1)) return;
          if (days === series.cadenceDays) return;
          save({
            key: `tree-cadence:${series.key}`,
            context: "Não foi possível alterar a cadência",
            action: () =>
              setRecordCadence(series.key, recordId, days, { revalidate: false }),
          });
          onChanged();
        }}
      />
      <span className="text-muted-foreground text-xs">dia(s)</span>
      {series.active ? null : (
        <>
          <Badge variant="secondary" className="text-xs">
            encerrada para este registro
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            title="A sequência volta a valer para este registro. As ocorrências já apagadas não voltam."
            onClick={() => {
              save({
                key: `tree-resume:${series.key}`,
                context: "Não foi possível retomar a sequência",
                action: () =>
                  resumeRecordSeries(series.key, recordId, { revalidate: false }),
              });
              onChanged();
            }}
          >
            Retomar
          </Button>
        </>
      )}
      {canConfigure && sourceKey ? (
        <TreeSeriesSheet
          sourceKey={sourceKey}
          ruleId={series.ruleId}
          onSaved={onChanged}
        />
      ) : null}
    </span>
  );
}

/** O que o NodeCard precisa saber sobre a seleção (v1.5). */
interface NodeSelection {
  selected: Set<string>;
  /** Aplica a cascata: o nó e o galho dele acompanham o clique. */
  onToggle: (node: TreeNode) => void;
}

function NodeCard({
  node,
  onNote,
  taskById,
  ctx,
  recordId,
  recordTitle,
  onChanged,
  selection,
  seriesByKey,
  canConfigure,
  sourceKey,
}: {
  node: TreeNode;
  onNote: (node: TreeNode) => void;
  /** Tarefas do registro por id — o nó guarda só o `refId`. */
  taskById: Map<string, TaskRow>;
  ctx: TaskFormContext;
  recordId: string;
  recordTitle: string;
  onChanged: () => void;
  selection: NodeSelection;
  /** v1.6: os controles do nó de sequência saem daqui. */
  seriesByKey: Map<string, TreeSeriesInfo>;
  canConfigure: boolean;
  sourceKey: string | null;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  // O nó de tarefa E a ocorrência já fundida com uma tarefa carregam o id.
  const task = node.refId ? (taskById.get(node.refId) ?? null) : null;
  // DERIVADO dos descendentes: é o que faz desmarcar um filho deixar o pai
  // parcial. Nó sem nada selecionável abaixo não mostra caixa nenhuma.
  const checkState = nodeCheckState(selection.selected, node);
  const selectable = selectableRefs(node).length > 0;
  // v1.6: o nó de SEQUÊNCIA é sintético — não é fato de ninguém, então não tem
  // tarefa, não tem exclusão e não entra na seleção; o que ele tem são os
  // controles da série.
  const series = node.kind === "series" && node.seriesKey
    ? (seriesByKey.get(node.seriesKey) ?? null)
    : null;

  return (
    <div className="flex flex-col">
      <div
        className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${
          KIND_TONE[node.kind] ?? "border-muted"
        }`}
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

        {selectable ? (
          <Checkbox
            checked={checkState}
            onCheckedChange={() => selection.onToggle(node)}
            aria-label={`Selecionar ${TREE_NODE_KIND_LABELS[node.kind]}`}
          />
        ) : null}

        <Badge variant="outline" className="shrink-0 text-xs">
          {TREE_NODE_KIND_LABELS[node.kind]}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm" title={node.label}>
          {node.label}
        </span>
        {node.status ? (
          <span className="text-muted-foreground text-xs">{node.status}</span>
        ) : null}
        <NodeDate node={node} task={task} />

        <span className="flex shrink-0 items-center gap-1">
          {series ? (
            <SeriesControls
              series={series}
              recordId={recordId}
              canConfigure={canConfigure}
              sourceKey={sourceKey}
              onChanged={onChanged}
            />
          ) : null}

          {node.kind === "occurrence" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              title={`${TREE_COMMENT_VERB} aqui`}
              aria-label={`${TREE_COMMENT_VERB} aqui`}
              onClick={() => onNote(node)}
            >
              <MessageSquarePlus className="size-3.5" />
            </Button>
          ) : null}

          {/* v1.3: o nó com tarefa abre a tarefa INTEIRA para editar. O
              `refId` sempre carregou o id — só não havia para onde levá-lo.
              v1.4: e agora conclui e exclui, que o editor não faz. */}
          {task ? (
            <>
              <TaskNodeActions task={task} onChanged={onChanged} />
              <TaskSheet task={task} ctx={ctx} editTrigger onDone={onChanged} />
            </>
          ) : node.kind === "occurrence" ? (
            // A ocorrência PREVISTA que ninguém abriu: agendar com o dia dela.
            // É o campo de data que faltava — antes a tarefa nascia sem prazo.
            <TaskSheet
              ctx={ctx}
              iconTrigger
              triggerLabel="Agendar esta tarefa"
              defaults={{
                recordId,
                recordTitle,
                dueDate: node.at || null,
              }}
              onDone={onChanged}
            />
          ) : null}

          {/* v1.4: comentário e nota livre passam a ter exclusão. Nó de
              "Alteração" fica de fora de propósito: é fato do audit_log. */}
          {node.kind === "comment" && node.refId ? (
            <NodeDeleteButton
              label={`Excluir ${TREE_NODE_KIND_LABELS.comment.toLowerCase()}`}
              confirmText={`Excluir este ${TREE_NODE_KIND_LABELS.comment.toLowerCase()}?`}
              onDelete={() => deleteComment(node.refId!)}
              onChanged={onChanged}
            />
          ) : null}
          {node.kind === "note" && node.refId ? (
            <NodeDeleteButton
              label="Excluir nó"
              confirmText="Excluir este nó da árvore?"
              onDelete={() => deleteTreeNode(node.refId!)}
              onChanged={onChanged}
            />
          ) : null}
        </span>
      </div>

      {open && hasChildren ? (
        // A linha de conexão é a borda esquerda: o galho é visual, não SVG.
        <div className="border-muted ml-4 flex flex-col gap-1.5 border-l pt-1.5 pl-3">
          {node.children.map((c) => (
            <NodeCard
              key={c.id}
              node={c}
              onNote={onNote}
              taskById={taskById}
              ctx={ctx}
              recordId={recordId}
              recordTitle={recordTitle}
              onChanged={onChanged}
              selection={selection}
              seriesByKey={seriesByKey}
              canConfigure={canConfigure}
              sourceKey={sourceKey}
            />
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
  const set = new Set<string>([...keep, "series"]);
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
}: {
  settings: TreeSettings | undefined;
  /** Registro em foco: o do settings, ou o que a tabela clicou. */
  recordId: string | null;
  /** Carimbo do event bus — muda quando um registro mudou. */
  dataChangedAt?: number;
}) {
  // v1.1 (09/09/2026): sem registro fixo, o widget SEGUE o foco do painel (o
  // clique da tabela). Antes ele só lia o settings e ficava eternamente vazio.
  const focus = useRecordFocus();
  const follows = recordId == null && (settings?.source ?? "registro") === "registro";
  const effectiveRecordId = recordId ?? (follows ? focus.recordId : null);
  const { registerFollower } = focus;

  // A tabela precisa saber se há uma Tree para focar: sem seguidor, o clique
  // abre o painel lateral em vez de focar no vazio.
  useEffect(() => {
    if (!follows) return;
    return registerFollower();
  }, [follows, registerFollower]);

  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(TREE_WINDOW_STEP);
  // v1.3: só o COMENTÁRIO tem rascunho inline. Tarefa passou a abrir o editor
  // de verdade — o Input de título só era o que fazia a tarefa nascer sem prazo.
  // v1.6: o rascunho guarda o NÓ em que a pessoa clicou. Antes o nó era
  // recebido e jogado fora, e "Comentar aqui" na 3ª ocorrência era idêntico ao
  // "Comentar" do cabeçalho.
  const [draft, setDraft] = useState<{ text: string; nodeId: string | null } | null>(
    null
  );
  // v1.6: a proposta da IA, esperando um clique. `null` = nada proposto.
  const [proposal, setProposal] = useState<{
    json: string;
    titulo: string;
    data: string | null;
    hora: string | null;
  } | null>(null);
  // Mensagem da análise (inclusive "não há nada a agendar", que é resposta).
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [analyzing, startAnalyze] = useTransition();
  const { save } = useBackgroundSave();
  const lastJson = useRef<string>("");

  const layout = settings?.layout ?? "por_ocorrencia";

  /**
   * O que o usuário escolheu ver. Trocar qualquer parte disto é ação DELE e
   * pede feedback; o tick do event bus não mexe aqui e por isso é silencioso.
   */
  const scopeKey = `${effectiveRecordId ?? ""}|${layout}|${order}|${limit}`;

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
    if (!effectiveRecordId) return;
    const scope = scopeKey;
    const next = await loadRecordTree(effectiveRecordId, layout, {
      order,
      limit,
    });
    // Payload idêntico não re-renderiza: o tick do sync roda a cada minuto e
    // não pode fazer a árvore piscar para quem só está lendo.
    const json = `${scope}::${JSON.stringify(next)}`;
    if (json !== lastJson.current) {
      lastJson.current = json;
      setPayload({ scope, data: next });
    }
  }, [effectiveRecordId, layout, order, limit, scopeKey]);

  const originOf = useRefetchOrigin(scopeKey);

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

  if (!effectiveRecordId) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">
        Escolha um registro na configuração do widget, ou clique numa linha da
        tabela configurada para abrir a Tree.
      </div>
    );
  }

  // Carregando: o nome do registro CLICADO já está aqui (veio no contexto de
  // foco, no mesmo instante do clique) — mostrá-lo agora é a diferença entre
  // "o sistema me ouviu" e "o sistema travou". Antes, quem seguia o foco via a
  // árvore do lead ANTERIOR até o payload novo chegar.
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

  /**
   * Salva o comentário. `analyze` = "Salvar e analisar": depois de gravado, a
   * IA lê o texto e propõe (ou não) um próximo passo.
   *
   * A gravação NÃO espera a IA: o comentário é do usuário e tem de existir
   * mesmo que o provedor esteja fora do ar. A proposta chega depois, num
   * cartão de um clique — a IA nunca escreve sozinha (invariante 25).
   */
  const submitDraft = (analyze = false) => {
    if (!draft || draft.text.trim() === "") return setDraft(null);
    const text = draft.text.trim();
    const parentRef = draft.nodeId;
    setDraft(null);
    setAiMessage(null);
    setProposal(null);
    save({
      key: "tree-note",
      context: "Não foi possível comentar",
      action: () =>
        addTreeNote(effectiveRecordId, text, { revalidate: false, parentRef }),
    });
    // A árvore recarrega depois da escrita: o nó novo é um FATO, e ela o lê.
    window.setTimeout(() => void refresh(), 600);
    if (!analyze) return;
    startAnalyze(async () => {
      const res = await analyzeComment(effectiveRecordId, text);
      if (!res.ok) return setAiMessage(res.message ?? "A análise falhou.");
      if (!res.json) {
        // Resposta legítima: o comentário não pedia próximo passo.
        return setAiMessage(res.message ?? "Nada a agendar a partir deste comentário.");
      }
      setProposal({
        json: res.json,
        titulo: res.titulo ?? "",
        data: res.data ?? null,
        hora: res.hora ?? null,
      });
    });
  };

  /** Aceita a proposta. RE-VALIDA no servidor e grava pelo `createTask`. */
  const acceptProposal = () => {
    if (!proposal) return;
    const raw = proposal.json;
    setProposal(null);
    save({
      key: "tree-ai-task",
      context: "Não foi possível agendar",
      action: () => applyCommentTask(effectiveRecordId, raw, { revalidate: false }),
    });
    window.setTimeout(() => void refresh(), 600);
  };

  // O editor de tarefa escreve pelos choke points de sempre; a árvore só
  // precisa reler os fatos depois.
  const reloadSoon = () => window.setTimeout(() => void refresh(), 400);

  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const seriesByKey = new Map(data.series.map((x) => [x.key, x]));
  const taskCtx: TaskFormContext = {
    responsibles: data.responsibles,
    canAssignOthers: true,
    canLock: false,
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{data.recordTitle}</span>
        {/* v1.6: a cadência e o construtor da série saíram daqui para o NÓ da
            sequência (SeriesControls). Com vários troncos, um controle no
            cabeçalho não teria como dizer de qual série ele é — e com um só
            ele fica ali mesmo, um nível abaixo, ao lado do que ele governa. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          title="Inverte a ordem; 'carregar mais' anda nessa direção"
          onClick={() => {
            // Trocar a ordem volta ao primeiro passo: a janela é das N
            // ocorrências daquela ponta, e manter o limite esticado mostraria
            // um recorte que ninguém pediu.
            setLimit(TREE_WINDOW_STEP);
            setOrder((o) => (o === "desc" ? "asc" : "desc"));
          }}
        >
          {order === "desc" ? "Recentes ↓" : "Antigas ↑"}
        </Button>
        {data.attribute ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => {
              const next =
                data.attribute!.status === "pausado" ? "ativo" : "pausado";
              // Pausar NÃO remove o acompanhamento: o registro continua na
              // funcionalidade e a árvore continua inteira.
              // O otimista carrega o MESMO escopo: sem isso ele nasceria
              // "de outro recorte" e o render o descartaria na hora.
              setPayload({
                scope: scopeKey,
                data: {
                  ...data,
                  attribute: { ...data.attribute!, status: next },
                },
              });
              save({
                key: "tree-status",
                context: "Não foi possível alterar o acompanhamento",
                action: () =>
                  setRecordAttributeStatus(data.attribute!.id, next, {
                    revalidate: false,
                  }),
                revert: () => setPayload({ scope: scopeKey, data }),
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

      {data.attribute?.status === "pausado" ? (
        <p className="text-muted-foreground text-xs">
          Acompanhamento pausado: novas tarefas não são abertas. O registro
          continua na automação e o histórico permanece.
        </p>
      ) : null}

      {/* v1.6: o cartão da IA. Ele aparece DEPOIS de o comentário ter sido
          salvo, e agendar é um clique — mas é um clique de gente: quem
          re-valida e grava é o servidor, pelo `createTask` de sempre. */}
      {proposal ? (
        <div className="border-primary/50 bg-primary/5 flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Sparkles className="text-primary size-4 shrink-0" />
          <span className="min-w-0 flex-1 text-sm">
            Agendar <strong>{proposal.titulo}</strong>
            {proposal.data
              ? ` para ${formatDateValue(proposal.data, DEFAULT_DATE_FORMAT)}`
              : " sem prazo"}
            {proposal.hora ? ` às ${proposal.hora}` : ""}?
          </span>
          <Button type="button" size="sm" onClick={acceptProposal}>
            Agendar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setProposal(null)}
          >
            Descartar
          </Button>
        </div>
      ) : null}

      {aiMessage && !proposal ? (
        <p className="text-muted-foreground text-xs" role="status">
          {aiMessage}
        </p>
      ) : null}

      {draft ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Input
            autoFocus
            value={draft.text}
            onChange={(e) =>
              setDraft((d) => (d ? { ...d, text: e.target.value } : d))
            }
            placeholder="O que aconteceu?"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitDraft();
              if (e.key === "Escape") setDraft(null);
            }}
            aria-label={TREE_NODE_KIND_LABELS.comment}
          />
          <Button type="button" size="sm" onClick={() => submitDraft()}>
            Salvar
          </Button>
          {/* Salvar e analisar: a IA lê o texto e decide se ele pede um próximo
              passo. "Não pede" é resposta legítima — e é a mais comum. */}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1"
            disabled={analyzing}
            title="Salva o comentário e pede à IA que avalie se cabe agendar uma tarefa a partir dele."
            onClick={() => submitDraft(true)}
          >
            {analyzing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Salvar e analisar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDraft(null)}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setDraft({ text: "", nodeId: null })}
          >
            <MessageSquarePlus className="size-3.5" /> {TREE_COMMENT_VERB}
          </Button>
          {/* v1.3: o editor de verdade, com prazo, hora, descrição e
              responsável — não mais um Input de título. */}
          <TaskSheet
            ctx={taskCtx}
            triggerLabel="Agendar tarefa"
            defaults={{ recordId: effectiveRecordId, recordTitle: data.recordTitle }}
            onDone={reloadSoon}
          />
          {/* v1.6: criar OUTRA sequência. Era o buraco do pedido: dava para
              ajustar a que existia e não dava para abrir uma segunda. */}
          {data.canConfigureSeries && data.sourceKey ? (
            <TreeSeriesSheet
              sourceKey={data.sourceKey}
              suggestedName=""
              onSaved={reloadSoon}
            />
          ) : null}
        </div>
      )}

      {visibleNodes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nada aconteceu com este registro ainda.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visibleNodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              // v1.6: o NÓ viaja. Antes ele chegava aqui e era descartado, e
              // o comentário pendurava na ocorrência de hoje — o botão do nó
              // fazia exatamente o mesmo que o do cabeçalho.
              onNote={(target) => setDraft({ text: "", nodeId: target.id })}
              taskById={taskById}
              ctx={taskCtx}
              recordId={effectiveRecordId}
              recordTitle={data.recordTitle}
              onChanged={reloadSoon}
              selection={{ selected: bulk.selected, onToggle: toggleNode }}
              seriesByKey={seriesByKey}
              canConfigure={data.canConfigureSeries}
              sourceKey={data.sourceKey}
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

      {data.hasMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setLimit((n) => n + TREE_WINDOW_STEP)}
        >
          {order === "desc"
            ? "Carregar o que é mais antigo"
            : "Carregar o que é mais recente"}
        </Button>
      ) : null}
    </div>
  );
}
