// Versão: 1.0 | Data: 30/09/2026
// v1.0 (30/09/2026): as PEÇAS de um nó da Tree, extraídas do `tree-widget`
//   para as DUAS visualizações (Lista e Root) usarem as mesmas. Uma segunda
//   cópia de "o que dá para fazer com este nó" seria a régua paralela da
//   invariante 25 — e a Root nasceria sem a pergunta da sequência, sem o
//   editor de tarefa ou sem os controles da série.
//
//   O que veio do widget (sem mudança de comportamento): `NodeDate`,
//   `TaskNodeActions`, `NodeDeleteButton`, `SeriesControls` e o cluster de
//   ações do `NodeCard`, agora `NodeActions`. O que é novo:
//    - `NoteDoneButton`: a anotação-ETAPA conclui e reabre (0148);
//    - `AddBranchMenu`: de qualquer nó sai um galho novo — anotação, tarefa ou
//      comentário (este, desabilitado com motivo no mapa livre);
//    - `TreeTaskComposer`: o editor de tarefa de sempre (`TaskForm` →
//      `createTask`) aberto por estado, para a tarefa nova ser pendurada no
//      galho em que a pessoa clicou.
"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Circle,
  MessageSquarePlus,
  Plus,
  StickyNote,
  ListTodo,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import {
  TaskForm,
  TaskSheet,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";
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
  deleteTreeNode,
  setRecordCadence,
  updateTreeNote,
} from "@/app/(app)/dashboards/tree-actions";
import { resumeRecordSeries } from "@/lib/tasks/actions";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import type { TreeSeriesInfo } from "@/lib/tree/load";
import {
  branchKindDisabledReason,
  TREE_BRANCH_KINDS,
  TREE_BRANCH_LABELS,
  TREE_COMMENT_VERB,
  TREE_NODE_KIND_LABELS,
  type TreeBranchKind,
  type TreeNode,
  type TreeScope,
} from "@/lib/tree/model";
import { TreeSeriesSheet } from "./tree-series-sheet";

/** Tom da borda por tipo de nó — o mesmo nas duas visualizações. */
export const KIND_TONE: Record<string, string> = {
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
 * Reusa `classifyDue`/`formatDateValue`, os mesmos do `DueBadge` da lista de
 * tarefas: atrasada em vermelho, em breve em âmbar. Quando o nó É uma tarefa,
 * a data mostrada é o prazo DELA.
 */
export function NodeDate({
  node,
  task,
}: {
  node: TreeNode;
  task: TaskRow | null;
}) {
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
    // "sem prazo" é informação; a string vazia parecia defeito.
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
export function TaskNodeActions({
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
      {/* A pergunta "e as demais da sequência?" mora no hook, que é o dono
          único de concluir e excluir; aqui só o lugar de renderizá-la. */}
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
 * Excluir um nó que NÃO é tarefa — o comentário (`comments`, 0066) e a
 * anotação (`tree_nodes`). Cada uma pelo choke point que já é dono dela.
 */
export function NodeDeleteButton({
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
 * construtor da automação. O lugar deles é o NÓ da sequência — cadência é por
 * série, e um controle no topo não teria como dizer de qual.
 */
export function SeriesControls({
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

/**
 * Concluir/reabrir a anotação-ETAPA (0148). Texto livre não tem o botão:
 * não há o que concluir num lembrete.
 */
export function NoteDoneButton({
  node,
  onChanged,
  compact = false,
}: {
  node: TreeNode;
  onChanged: () => void;
  compact?: boolean;
}) {
  const { save, pendingKeys } = useBackgroundSave();
  const done = node.status === "concluída";
  const key = `tree-note-done:${node.refId}`;
  if (!node.refId || (node.status !== "aberta" && node.status !== "concluída")) {
    return null;
  }
  const label = done ? "Reabrir etapa" : "Concluir etapa";
  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon" : "sm"}
      className={compact ? "size-6" : "h-7 gap-1 text-xs"}
      disabled={pendingKeys.has(key)}
      aria-label={label}
      title={label}
      data-no-drag
      onClick={() =>
        save({
          key,
          context: "Não foi possível atualizar a etapa",
          reconcile: false,
          action: async () => {
            const res = await updateTreeNote(
              node.refId!,
              { status: done ? "pendente" : "concluida" },
              { revalidate: false }
            );
            if (res.ok) onChanged();
            return res;
          },
        })
      }
    >
      {done ? (
        <CheckCircle2 className="size-4 text-emerald-600" />
      ) : (
        <Circle className="size-4" />
      )}
      {compact ? null : done ? "Reabrir" : "Concluir"}
    </Button>
  );
}

/** O que o cluster de ações precisa saber do widget. */
export interface NodeActionsContext {
  scope: TreeScope;
  ctx: TaskFormContext;
  recordTitle: string;
  taskById: Map<string, TaskRow>;
  seriesByKey: Map<string, TreeSeriesInfo>;
  canConfigure: boolean;
  sourceKey: string | null;
  /** "Comentar aqui": abre o compositor pendurado neste nó. */
  onNote: (node: TreeNode) => void;
  onChanged: () => void;
}

/**
 * As ações de UM nó — o que era o miolo do `NodeCard`. Na Lista vão na linha
 * do nó; na Root, na barra do nó selecionado.
 */
export function NodeActions({
  node,
  actx,
}: {
  node: TreeNode;
  actx: NodeActionsContext;
}) {
  const task = node.refId ? (actx.taskById.get(node.refId) ?? null) : null;
  const recordId = actx.scope.kind === "record" ? actx.scope.recordId : null;
  // O nó de SEQUÊNCIA é sintético — não é fato de ninguém, então não tem
  // tarefa, não tem exclusão e não entra na seleção; o que ele tem são os
  // controles da série.
  const series =
    node.kind === "series" && node.seriesKey
      ? (actx.seriesByKey.get(node.seriesKey) ?? null)
      : null;

  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1" data-no-drag>
      {series && recordId ? (
        <SeriesControls
          series={series}
          recordId={recordId}
          canConfigure={actx.canConfigure}
          sourceKey={actx.sourceKey}
          onChanged={actx.onChanged}
        />
      ) : null}

      {node.kind === "occurrence" && recordId ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          title={`${TREE_COMMENT_VERB} aqui`}
          aria-label={`${TREE_COMMENT_VERB} aqui`}
          onClick={() => actx.onNote(node)}
        >
          <MessageSquarePlus className="size-3.5" />
        </Button>
      ) : null}

      {/* O nó com tarefa abre a tarefa INTEIRA para editar, e conclui e
          exclui, que o editor não faz. */}
      {task ? (
        <>
          <TaskNodeActions task={task} onChanged={actx.onChanged} />
          <TaskSheet task={task} ctx={actx.ctx} editTrigger onDone={actx.onChanged} />
        </>
      ) : node.kind === "occurrence" && recordId ? (
        // A ocorrência PREVISTA que ninguém abriu: agendar com o dia dela.
        <TaskSheet
          ctx={actx.ctx}
          iconTrigger
          triggerLabel="Agendar esta tarefa"
          defaults={{
            recordId,
            recordTitle: actx.recordTitle,
            dueDate: node.at || null,
          }}
          onDone={actx.onChanged}
        />
      ) : null}

      {node.kind === "note" ? (
        <NoteDoneButton node={node} onChanged={actx.onChanged} compact />
      ) : null}

      {/* Comentário e anotação têm exclusão. Nó de "Alteração" fica de fora
          de propósito: é fato do audit_log. */}
      {node.kind === "comment" && node.refId ? (
        <NodeDeleteButton
          label={`Excluir ${TREE_NODE_KIND_LABELS.comment.toLowerCase()}`}
          confirmText={`Excluir este ${TREE_NODE_KIND_LABELS.comment.toLowerCase()}?`}
          onDelete={() => deleteComment(node.refId!)}
          onChanged={actx.onChanged}
        />
      ) : null}
      {node.kind === "note" && node.refId ? (
        <NodeDeleteButton
          label={`Excluir ${TREE_NODE_KIND_LABELS.note.toLowerCase()}`}
          confirmText={`Excluir esta ${TREE_NODE_KIND_LABELS.note.toLowerCase()}? Os galhos que dependem dela não são excluídos — ficam soltos na árvore.`}
          onDelete={() => deleteTreeNode(node.refId!)}
          onChanged={actx.onChanged}
        />
      ) : null}
    </span>
  );
}

const BRANCH_ICON: Record<TreeBranchKind, typeof StickyNote> = {
  note: StickyNote,
  task: ListTodo,
  comment: MessageSquarePlus,
};

/**
 * "+" — puxa um galho novo de um nó (ou da raiz, com `parent` null). O tipo
 * que não cabe aqui fica DESABILITADO com o motivo, nunca escondido.
 */
export function AddBranchMenu({
  parent,
  scopeKind,
  onPick,
  label = "Novo galho",
  compact = false,
}: {
  parent: TreeNode | null;
  scopeKind: TreeScope["kind"];
  onPick: (kind: TreeBranchKind, parent: TreeNode | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const synthetic =
    parent != null && (parent.kind === "series" || parent.id.startsWith("kind:"));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={label}
            title={label}
            data-no-drag
            disabled={synthetic}
          >
            <Plus className="size-4" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            data-no-drag
            disabled={synthetic}
          >
            <Plus className="size-3.5" /> {label}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs">
          {parent ? "Galho a partir deste nó" : "Galho na raiz"}
        </DropdownMenuLabel>
        {TREE_BRANCH_KINDS.map((kind) => {
          const reason = branchKindDisabledReason(kind, scopeKind);
          const Icon = BRANCH_ICON[kind];
          return (
            <DropdownMenuItem
              key={kind}
              disabled={reason != null}
              title={reason ?? undefined}
              onSelect={() => onPick(kind, parent)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="flex items-center gap-2">
                <Icon className="size-3.5" /> {TREE_BRANCH_LABELS[kind]}
              </span>
              {reason ? (
                <span className="text-muted-foreground text-[11px]">{reason}</span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * O editor de tarefa de SEMPRE (`TaskForm` → `createTask`), aberto por
 * estado. O `TaskSheet` tem gatilho próprio e não serve para abrir a partir de
 * um menu; o formulário, sim — e é ele o choke point. `onCreated` recebe o id
 * para a árvore pendurar a tarefa no galho escolhido.
 */
export function TreeTaskComposer({
  open,
  ctx,
  recordId,
  recordTitle,
  onClose,
  onCreated,
}: {
  open: boolean;
  ctx: TaskFormContext;
  recordId: string | null;
  recordTitle: string | null;
  onClose: () => void;
  onCreated: (taskId: string | null) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : onClose())}>
      <ResizableSheetContent
        storageKey="panel-w:task"
        defaultWidth={448}
        className="overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Nova tarefa</SheetTitle>
          <SheetDescription>
            A tarefa nasce pendurada no galho escolhido — e aparece também em
            Tarefas, nos kanbans e na agenda.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <TaskForm
            ctx={ctx}
            defaults={{ recordId, recordTitle }}
            onDone={(taskId) => {
              onCreated(taskId ?? null);
              onClose();
            }}
          />
        ) : null}
      </ResizableSheetContent>
    </Sheet>
  );
}
