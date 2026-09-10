// Versão: 1.3 | Data: 09/09/2026
// v1.3 (09/09/2026): o nó ABRE A TAREFA INTEIRA. Antes um nó mostrava título e
//   data e mais nada, e o "agendar tarefa" era um Input de título só — a tarefa
//   nascia sem prazo (o `dueDate` que a action aceita nunca era enviado). Agora
//   clicar num nó abre o MESMO editor que o resto do app usa (TaskSheet), com
//   prazo, hora, descrição e responsável; e a cobrança prevista que ainda não
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
// conduzindo este lead". O tronco são as COBRANÇAS (derivadas, então a que
// ninguém fez também aparece) e cada anotação, tarefa e alteração pendura
// naquela em cuja janela caiu.
//
// Render em HTML/CSS, não SVG: os nós têm texto de tamanho variável e ações
// dentro deles (anotar, agendar, pausar), e um <foreignObject> para cada um
// custaria mais do que a linha de conexão vale. As linhas são bordas.
//
// Refetch: origem do EVENT BUS é silenciosa (§4.10) — o sync do Bitrix roda a
// cada minuto e uma árvore que pisca sozinha lê como defeito.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  Pause,
  Play,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TaskSheet, type TaskFormContext } from "@/components/tarefas/task-sheet";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";
import type { TaskRow } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import {
  addTreeNote,
  loadRecordTree,
  setRecordCadence,
  type TreeData,
} from "@/app/(app)/dashboards/tree-actions";
import { useRecordFocus } from "../record-focus-context";
import { setRecordAttributeStatus } from "@/lib/attributes/actions";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import {
  BUS_REFETCH_DELAY_MS,
  useRefetchOrigin,
} from "@/lib/feedback/use-refetch-origin";
import {
  TREE_NODE_KIND_LABELS,
  TREE_WINDOW_STEP,
  type TreeFilterableKind,
  type TreeNode,
} from "@/lib/tree/model";
import type { TreeSettings } from "@/lib/widgets/types";

const KIND_TONE: Record<string, string> = {
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

function NodeCard({
  node,
  onNote,
  taskById,
  ctx,
  recordId,
  recordTitle,
  onChanged,
}: {
  node: TreeNode;
  onNote: (node: TreeNode) => void;
  /** Tarefas do registro por id — o nó guarda só o `refId`. */
  taskById: Map<string, TaskRow>;
  ctx: TaskFormContext;
  recordId: string;
  recordTitle: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  // O nó de tarefa E a cobrança já fundida com uma tarefa carregam o id dela.
  const task = node.refId ? (taskById.get(node.refId) ?? null) : null;

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
          {node.kind === "occurrence" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              title="Anotar nesta cobrança"
              onClick={() => onNote(node)}
            >
              <MessageSquarePlus className="size-3.5" />
            </Button>
          ) : null}

          {/* v1.3: o nó com tarefa abre a tarefa INTEIRA para editar. O
              `refId` sempre carregou o id — só não havia para onde levá-lo. */}
          {task ? (
            <TaskSheet task={task} ctx={ctx} editTrigger onDone={onChanged} />
          ) : node.kind === "occurrence" ? (
            // A cobrança PREVISTA que ninguém abriu: agendar já com o dia dela.
            // É o campo de data que faltava — antes a tarefa nascia sem prazo.
            <TaskSheet
              ctx={ctx}
              iconTrigger
              triggerLabel="Agendar esta cobrança"
              defaults={{
                recordId,
                recordTitle,
                dueDate: node.at || null,
              }}
              onDone={onChanged}
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
 * junto — esconder "Alteração" não pode fazer sumir a anotação que caiu embaixo
 * de uma. Lista vazia/ausente = tudo.
 */
function filterKinds(
  nodes: TreeNode[],
  keep: TreeFilterableKind[] | undefined
): TreeNode[] {
  if (!keep || keep.length === 0) return nodes;
  const set = new Set<string>(keep);
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
  // v1.3: só ANOTAÇÃO tem rascunho inline. Tarefa passou a abrir o editor de
  // verdade — o Input de título só era o que fazia a tarefa nascer sem prazo.
  const [draft, setDraft] = useState<{ text: string } | null>(null);
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

  const submitDraft = () => {
    if (!draft || draft.text.trim() === "") return setDraft(null);
    const text = draft.text.trim();
    setDraft(null);
    save({
      key: "tree-note",
      context: "Não foi possível anotar",
      action: () => addTreeNote(effectiveRecordId, text, { revalidate: false }),
    });
    // A árvore recarrega depois da escrita: o nó novo é um FATO, e ela o lê.
    window.setTimeout(() => void refresh(), 600);
  };

  // O editor de tarefa escreve pelos choke points de sempre; a árvore só
  // precisa reler os fatos depois.
  const reloadSoon = () => window.setTimeout(() => void refresh(), 400);

  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const taskCtx: TaskFormContext = {
    responsibles: data.responsibles,
    canAssignOthers: true,
    canLock: false,
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{data.recordTitle}</span>
        {data.series ? (
          <>
            {/* v1.3: a cadência DESTE registro passou a ser editável aqui. A
                action existia desde a 0132 e o manual a descrevia, mas não
                havia controle nenhum — a exceção só dava para gravar por SQL.
                Grava em `series_settings` (escopo registro); a regra fica
                intocada, e limpar o campo devolve o padrão do esquema. */}
            <span className="flex items-center gap-1">
              <span className="text-muted-foreground text-xs">a cada</span>
              <Input
                type="number"
                min={1}
                max={365}
                defaultValue={data.series.cadenceDays}
                className="h-7 w-16 text-xs"
                aria-label="Cadência deste registro, em dias"
                title="Cadência só deste registro. Vazio volta ao padrão do esquema."
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  const days = raw === "" ? null : Number(raw);
                  if (days != null && (!Number.isFinite(days) || days < 1)) return;
                  if (days === data.series!.cadenceDays) return;
                  save({
                    key: "tree-cadence",
                    context: "Não foi possível alterar a cadência",
                    action: () =>
                      setRecordCadence(
                        data.series!.key,
                        effectiveRecordId,
                        days,
                        { revalidate: false }
                      ),
                  });
                  reloadSoon();
                }}
              />
              <span className="text-muted-foreground text-xs">dia(s)</span>
            </span>
            {!data.series.active ? (
              <Badge variant="secondary" className="text-xs">
                série desligada para este recorte
              </Badge>
            ) : null}
          </>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 text-xs"
          title="Inverte a ordem; 'carregar mais' anda nessa direção"
          onClick={() => {
            // Trocar a ordem volta ao primeiro passo: a janela é das N
            // cobranças daquela ponta, e manter o limite esticado mostraria
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
          Acompanhamento pausado: novas cobranças não são abertas. O registro
          continua na automação e o histórico permanece.
        </p>
      ) : null}

      {draft ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Input
            autoFocus
            value={draft.text}
            onChange={(e) => setDraft({ text: e.target.value })}
            placeholder="O que aconteceu?"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitDraft();
              if (e.key === "Escape") setDraft(null);
            }}
            aria-label="Anotação"
          />
          <Button type="button" size="sm" onClick={submitDraft}>
            Salvar
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
            onClick={() => setDraft({ text: "" })}
          >
            <MessageSquarePlus className="size-3.5" /> Anotar
          </Button>
          {/* v1.3: o editor de verdade, com prazo, hora, descrição e
              responsável — não mais um Input de título. */}
          <TaskSheet
            ctx={taskCtx}
            triggerLabel="Agendar tarefa"
            defaults={{ recordId: effectiveRecordId, recordTitle: data.recordTitle }}
            onDone={reloadSoon}
          />
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
              onNote={() => setDraft({ text: "" })}
              taskById={taskById}
              ctx={taskCtx}
              recordId={effectiveRecordId}
              recordTitle={data.recordTitle}
              onChanged={reloadSoon}
            />
          ))}
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
            ? "Carregar cobranças mais antigas"
            : "Carregar cobranças mais recentes"}
        </Button>
      ) : null}
    </div>
  );
}
