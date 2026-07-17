// Versão: 1.0 | Data: 17/07/2026
// FEED de um card do kanban (registro ou tarefa): histórico mesclado de
// tarefas/subtarefas + comentários (0066), com composer, fixar (pinned),
// reordenar por arrasto (posição fracionária, restrito ao grupo fixado/não
// fixado), concluir tarefa inline e editar/excluir comentário (autor ou
// admin/gestor — a RLS dá o veredito; o client usa taskCtx.canLock como
// proxy de gestão). DnD HTML5 nativo com payload próprio
// (application/x-feed-item) — não conflita com o drag de cards/colunas.
"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { GripVertical, Link2, Pencil, Pin, PinOff, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FeedItem, FeedTarget } from "@/lib/comments/types";
import {
  createComment,
  deleteComment,
  fetchFeed,
  setCommentPinned,
  setCommentPosition,
  updateComment,
} from "@/lib/comments/actions";
import {
  completeTask,
  reopenTask,
  setTaskFeedPosition,
  setTaskPinned,
} from "@/lib/tasks/actions";
import { emitDataChanged, useDataChanged } from "@/lib/tasks/events";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";
import {
  TaskSheet,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";

const FEED_DND_TYPE = "application/x-feed-item";

const stampFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : stampFmt.format(d);
}

function targetMatches(t: FeedTarget, d: { recordId?: string | null; taskId?: string | null }): boolean {
  if ("recordId" in t) return !d.recordId || d.recordId === t.recordId;
  return !d.taskId || d.taskId === t.taskId;
}

export function EntityFeed({
  target,
  taskCtx,
  recordTitle,
  dueSoonDays,
  focusComposer,
  readOnly,
}: {
  target: FeedTarget;
  taskCtx: TaskFormContext;
  // Título do registro (defaults do "+tarefa" quando o alvo é um registro).
  recordTitle?: string | null;
  dueSoonDays?: number;
  // Abrir com o cursor no composer ("+comentário" do card).
  focusComposer?: boolean;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // admin/gestor (proxy): pode editar/excluir comentários alheios (RLS confirma).
  const canManage = taskCtx.canLock;

  const targetKey = "recordId" in target ? `r:${target.recordId}` : `t:${target.taskId}`;
  const reload = useCallback(() => {
    startTransition(async () => {
      try {
        setItems(await fetchFeed(target));
      } catch {
        setError("Falha ao carregar o feed.");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (focusComposer) composerRef.current?.focus();
  }, [focusComposer]);

  // Event bus: tarefa/comentário deste alvo mudou em outra superfície.
  useDataChanged((d) => {
    if (d.kind === "record") return;
    if (targetMatches(target, d)) reload();
  });

  function emit(kind: "task" | "comment") {
    emitDataChanged({
      kind,
      recordId: "recordId" in target ? target.recordId : null,
      taskId: "taskId" in target ? target.taskId : null,
    });
  }

  async function submitComment() {
    const body = text.trim();
    if (!body) return;
    setError(null);
    const res = await createComment(target, body);
    if (!res.ok) {
      setError(res.message ?? "Falha ao comentar.");
      return;
    }
    setText("");
    emit("comment");
    reload();
  }

  async function togglePin(item: FeedItem) {
    setError(null);
    const res =
      item.kind === "comment"
        ? await setCommentPinned(item.id, !item.pinned)
        : await setTaskPinned(item.id, !item.pinned);
    if (!res.ok) {
      setError(res.message ?? "Falha ao fixar.");
      return;
    }
    emit(item.kind);
    reload();
  }

  async function toggleTask(item: Extract<FeedItem, { kind: "task" }>) {
    setError(null);
    const done = Boolean(item.task.completed_at);
    const res = done
      ? await reopenTask(item.id)
      : await completeTask(item.id);
    if (!res.ok) {
      setError(res.message ?? "Falha ao atualizar a tarefa.");
      return;
    }
    emit("task");
    reload();
  }

  async function saveEdit(id: string) {
    const body = draft.trim();
    if (!body) return;
    const res = await updateComment(id, body);
    if (!res.ok) {
      setError(res.message ?? "Falha ao editar.");
      return;
    }
    setEditingId(null);
    emit("comment");
    reload();
  }

  async function removeComment(id: string) {
    const res = await deleteComment(id);
    if (!res.ok) {
      setError(res.message ?? "Falha ao excluir.");
      return;
    }
    emit("comment");
    reload();
  }

  // ---- Reordenação por arrasto (dentro do mesmo grupo fixado/não fixado) ----

  async function handleDrop(targetItem: FeedItem, e: React.DragEvent) {
    e.preventDefault();
    setDropBefore(null);
    setDraggingId(null);
    if (!items) return;
    let payload: { id: string; kind: "task" | "comment" };
    try {
      payload = JSON.parse(e.dataTransfer.getData(FEED_DND_TYPE));
    } catch {
      return;
    }
    const dragged = items.find((i) => i.id === payload.id);
    if (!dragged || dragged.id === targetItem.id) return;
    // Restrito ao grupo: fixados reordenam entre si, não fixados idem.
    if (dragged.pinned !== targetItem.pinned) return;

    const group = items.filter(
      (i) => i.pinned === dragged.pinned && i.id !== dragged.id
    );
    const idx = group.findIndex((i) => i.id === targetItem.id);
    if (idx < 0) return;
    const prev = group[idx - 1];
    // Ordenação ASC por position: inserir ANTES do alvo = entre prev e alvo.
    const newPos = prev
      ? (prev.position + targetItem.position) / 2
      : targetItem.position - 3_600_000;

    const before = items;
    setItems((list) => {
      if (!list) return list;
      const next = list.map((i) =>
        i.id === dragged.id ? { ...i, position: newPos } : i
      );
      next.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.position !== b.position) return a.position - b.position;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
      return next;
    });

    const res =
      dragged.kind === "comment"
        ? await setCommentPosition(dragged.id, newPos)
        : await setTaskFeedPosition(dragged.id, newPos);
    if (!res.ok) {
      setItems(before);
      setError(res.message ?? "Falha ao mover no feed.");
      return;
    }
    emit(dragged.kind);
  }

  const newTaskTrigger =
    "recordId" in target ? (
      <TaskSheet
        ctx={taskCtx}
        defaults={{ recordId: target.recordId, recordTitle: recordTitle ?? null }}
        triggerLabel="+ tarefa"
        chipTrigger
        onDone={reload}
      />
    ) : (
      <TaskSheet
        ctx={taskCtx}
        defaults={{ parentTaskId: target.taskId }}
        triggerLabel="+ subtarefa"
        chipTrigger
        onDone={reload}
      />
    );

  return (
    <div className="flex flex-col gap-3">
      {!readOnly ? (
        <div className="flex flex-col gap-1.5">
          <Textarea
            ref={composerRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escreva um comentário…"
            rows={2}
          />
          <div className="flex items-center justify-between">
            {newTaskTrigger}
            <Button
              size="sm"
              onClick={submitComment}
              disabled={pending || !text.trim()}
            >
              Comentar
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive text-xs" role="status">
          {error}
        </p>
      ) : null}

      {items == null ? (
        <p className="text-muted-foreground text-xs">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Sem atividades ainda. Comente ou crie uma tarefa.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((item) => {
            const isDragging = draggingId === item.id;
            return (
              <div
                key={item.id}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(FEED_DND_TYPE)) return;
                  e.preventDefault();
                  setDropBefore(item.id);
                }}
                onDragLeave={() =>
                  setDropBefore((v) => (v === item.id ? null : v))
                }
                onDrop={(e) => handleDrop(item, e)}
                className={cn(
                  "group/feed relative rounded-md border px-2 py-1.5",
                  item.pinned && "bg-amber-500/5 border-amber-500/40",
                  isDragging && "opacity-50",
                  dropBefore === item.id &&
                    draggingId &&
                    "border-t-primary border-t-2"
                )}
              >
                <div className="flex items-start gap-1.5">
                  {!readOnly ? (
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDraggingId(item.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData(
                          FEED_DND_TYPE,
                          JSON.stringify({ id: item.id, kind: item.kind })
                        );
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropBefore(null);
                      }}
                      className="text-muted-foreground/50 hover:text-muted-foreground mt-0.5 cursor-grab active:cursor-grabbing"
                      aria-label="Arrastar para reordenar"
                    >
                      <GripVertical className="size-3.5" />
                    </span>
                  ) : null}

                  {item.kind === "task" ? (
                    <TaskFeedRow
                      item={item}
                      dueSoonDays={dueSoonDays}
                      readOnly={readOnly}
                      onToggle={() => toggleTask(item)}
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="text-muted-foreground text-[11px]">
                        {item.authorLabel ?? "Usuário"} · {stamp(item.createdAt)}
                        {item.kind === "comment" &&
                        item.comment.updated_at !== item.comment.created_at
                          ? " (editado)"
                          : ""}
                      </p>
                      {editingId === item.id ? (
                        <div className="mt-1 flex flex-col gap-1">
                          <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            rows={2}
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => saveEdit(item.id)}>
                              Salvar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingId(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm break-words whitespace-pre-wrap">
                          {item.comment.body}
                        </p>
                      )}
                    </div>
                  )}

                  {!readOnly ? (
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/feed:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={item.pinned ? "Desafixar" : "Fixar no topo"}
                        onClick={() => togglePin(item)}
                      >
                        {item.pinned ? (
                          <PinOff className="size-3.5" />
                        ) : (
                          <Pin className="size-3.5" />
                        )}
                      </Button>
                      {item.kind === "comment" && (item.own || canManage) ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            aria-label="Editar comentário"
                            onClick={() => {
                              setEditingId(item.id);
                              setDraft(item.comment.body);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            aria-label="Excluir comentário"
                            onClick={() => removeComment(item.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      ) : null}
                      {item.kind === "task" ? (
                        <TaskSheet
                          task={item.task}
                          ctx={taskCtx}
                          editTrigger
                          onDone={reload}
                        />
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskFeedRow({
  item,
  dueSoonDays,
  readOnly,
  onToggle,
}: {
  item: Extract<FeedItem, { kind: "task" }>;
  dueSoonDays?: number;
  readOnly?: boolean;
  onToggle: () => void;
}) {
  const task = item.task;
  const done = Boolean(task.completed_at);
  const status = classifyDue(task, dueSoonDays);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={done}
          disabled={readOnly}
          onChange={onToggle}
          className="accent-primary mt-0.5 size-4 shrink-0"
          aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
        />
        <span
          className={cn(
            "min-w-0 flex-1 text-sm font-medium break-words",
            done && "text-muted-foreground line-through"
          )}
        >
          {task.title}
        </span>
      </div>
      <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 pl-6 text-[11px]">
        <span>
          {task.parent_task_id ? "Subtarefa" : "Tarefa"}
          {item.authorLabel ? ` · ${item.authorLabel}` : ""} ·{" "}
          {stamp(item.createdAt)}
        </span>
        {task.due_date ? (
          <span
            className={cn(
              "rounded px-1 py-0.5",
              status === "atrasada" &&
                "bg-destructive/10 text-destructive font-medium",
              status === "em_breve" &&
                "bg-amber-500/15 font-medium text-amber-700"
            )}
            title={status ? DUE_STATUS_LABELS[status] : undefined}
          >
            {formatDateValue(task.due_date, DEFAULT_DATE_FORMAT)}
            {task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
          </span>
        ) : null}
        {task.record?.title ? (
          <span className="flex items-center gap-0.5">
            <Link2 className="size-3" />
            {task.record.title}
          </span>
        ) : null}
      </div>
    </div>
  );
}
