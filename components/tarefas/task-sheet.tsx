// Versão: 1.1 | Data: 17/07/2026
// Painel de criação/edição de TAREFA: título, descrição, vencimento (data +
// hora opcional), responsável (vendedor fica travado nos próprios), vínculo a
// registro e trava de exclusão (só admin/gestor). `defaults` pré-preenche
// fase/board/registro (quick-create de coluna e seção do registro).
// v1.1 (17/07/2026): formulário extraído em TaskForm (exportado — a aba
//   "Dados" do CardDetailSheet embute o mesmo form); defaults.parentTaskId
//   cria SUBTAREFA (feed da tarefa pai); gatilho `chipTrigger` ("+tarefa" no
//   rodapé dos cards); checkbox "Global" (notifica todos — só admin/gestor,
//   trigger 0066 reforça). Sucesso emite emitDataChanged (event bus W1).
"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OptionItem } from "@/lib/records/types";
import type { TaskRow } from "@/lib/tasks/types";
import {
  createTask,
  updateTask,
  type TaskActionState,
} from "@/lib/tasks/actions";
import { emitDataChanged } from "@/lib/tasks/events";
import { RecordSearchCombobox } from "./record-search-combobox";

const initial: TaskActionState = {};

// Contexto compartilhado dos formulários de tarefa.
export interface TaskFormContext {
  responsibles: OptionItem[];
  // Sem view_all_records (vendedor): responsável travado nos próprios; a lista
  // aqui já deve vir restrita pelo chamador quando fizer sentido.
  canAssignOthers: boolean;
  // admin/gestor: pode travar/destravar a exclusão.
  canLock: boolean;
  // admin/gestor: pode marcar a tarefa como GLOBAL (visível/notifica a todos).
  // Ausente = segue canLock (mesmos papéis hoje).
  canGlobal?: boolean;
}

// Pré-preenchimentos de criação (quick-create de coluna, seção do registro,
// feed dos cards). parentTaskId = subtarefa (vive no feed da tarefa pai).
export interface TaskDefaults {
  boardId?: string | null;
  phase?: string;
  recordId?: string | null;
  recordTitle?: string | null;
  locked?: boolean;
  parentTaskId?: string | null;
}

/**
 * Formulário de tarefa (sem Sheet) — embutível na aba "Dados" do
 * CardDetailSheet ou em qualquer painel. `onDone` roda após sucesso (fechar
 * painel/recarregar); o evento global de dados é emitido aqui.
 */
export function TaskForm({
  task,
  defaults,
  ctx,
  onDone,
}: {
  // Presente = edição; ausente = criação.
  task?: TaskRow;
  defaults?: TaskDefaults;
  ctx: TaskFormContext;
  onDone?: () => void;
}) {
  const isEdit = Boolean(task);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateTask : createTask,
    initial
  );
  const [responsibleId, setResponsibleId] = useState(
    task?.responsible_id ?? ""
  );
  const [locked, setLocked] = useState(task?.locked ?? defaults?.locked ?? false);
  const canGlobal = ctx.canGlobal ?? ctx.canLock;
  const [isGlobal, setIsGlobal] = useState(task?.is_global ?? false);

  useEffect(() => {
    if (state.ok) {
      // Event bus: widgets/sino/listas recarregam na hora (qualquer superfície).
      emitDataChanged({
        kind: "task",
        taskId: task?.id ?? state.id ?? null,
        recordId: task?.record_id ?? defaults?.recordId ?? null,
        boardId: task?.board_id ?? defaults?.boardId ?? null,
      });
      if (onDone) onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <form action={formAction} className="flex flex-col gap-4 px-4 pb-6">
      {isEdit ? <input type="hidden" name="id" value={task!.id} /> : null}
      {!isEdit ? (
        <>
          <input
            type="hidden"
            name="board_id"
            value={defaults?.boardId ?? ""}
          />
          <input
            type="hidden"
            name="phase"
            value={defaults?.phase ?? "a_fazer"}
          />
          {defaults?.parentTaskId ? (
            <input
              type="hidden"
              name="parent_task_id"
              value={defaults.parentTaskId}
            />
          ) : null}
        </>
      ) : null}
      {/* Sempre presente quando permitido: desmarcar também grava ("0"). */}
      {canGlobal ? (
        <input type="hidden" name="is_global" value={isGlobal ? "1" : "0"} />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-title">Título *</Label>
        <Input
          id="task-title"
          name="title"
          defaultValue={task?.title ?? ""}
          placeholder="Ex.: Preparar proposta"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="task-desc">Descrição</Label>
        <Textarea
          id="task-desc"
          name="description"
          defaultValue={task?.description ?? ""}
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-due">Vencimento</Label>
          <Input
            id="task-due"
            type="date"
            name="due_date"
            defaultValue={task?.due_date ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-time">Hora</Label>
          <Input
            id="task-time"
            type="time"
            name="due_time"
            defaultValue={task?.due_time?.slice(0, 5) ?? ""}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Responsável</Label>
        <Combobox
          name="responsible_id"
          options={[
            { value: "", label: "— nenhum —" },
            ...ctx.responsibles.map((r) => ({
              value: r.id,
              label: r.label,
            })),
          ]}
          value={responsibleId}
          onValueChange={setResponsibleId}
          placeholder="— nenhum —"
          className="w-full"
          aria-label="Responsável"
        />
        {!ctx.canAssignOthers ? (
          <p className="text-muted-foreground text-xs">
            Você só pode atribuir tarefas ao seu próprio responsável.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Registro vinculado</Label>
        <RecordSearchCombobox
          name="record_id"
          defaultId={task?.record_id ?? defaults?.recordId ?? null}
          defaultLabel={
            task?.record?.title ?? defaults?.recordTitle ?? null
          }
        />
      </div>

      {ctx.canLock || !isEdit ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="locked"
            value="1"
            checked={locked}
            onChange={(e) => setLocked(e.target.checked)}
            disabled={isEdit && !ctx.canLock}
            className="size-4 accent-primary"
          />
          Travar exclusão (só admin/gestor excluem)
        </label>
      ) : null}

      {canGlobal ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={isGlobal}
            onChange={(e) => setIsGlobal(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Global — notifica todos
            <span className="text-muted-foreground block text-xs">
              Visível para todos os usuários e destacada no sino de cada um.
            </span>
          </span>
        </label>
      ) : null}

      {state.message && !state.ok ? (
        <p className="text-destructive text-sm" role="status">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending
          ? "Salvando..."
          : isEdit
            ? "Salvar tarefa"
            : "Criar tarefa"}
      </Button>
    </form>
  );
}

/** Painel lateral com gatilho (botão/ícone/lápis/chip) — wrapper do TaskForm. */
export function TaskSheet({
  task,
  defaults,
  ctx,
  onDone,
  triggerLabel = "Nova tarefa",
  iconTrigger = false,
  editTrigger = false,
  chipTrigger = false,
}: {
  task?: TaskRow;
  defaults?: TaskDefaults;
  ctx: TaskFormContext;
  onDone?: () => void;
  triggerLabel?: string;
  iconTrigger?: boolean;
  editTrigger?: boolean;
  // Chip textual compacto ("+tarefa" no rodapé dos cards do kanban).
  chipTrigger?: boolean;
}) {
  const isEdit = Boolean(task);
  const [open, setOpen] = useState(false);
  const isSub = Boolean(defaults?.parentTaskId);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {editTrigger ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Editar tarefa"
          onClick={() => setOpen(true)}
        >
          <Pencil className="size-3.5" />
        </Button>
      ) : chipTrigger ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground rounded px-1 py-0.5 text-[11px] font-medium transition-colors"
          aria-label={triggerLabel}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          draggable={false}
        >
          {triggerLabel}
        </button>
      ) : iconTrigger ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={triggerLabel}
          onClick={() => setOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      )}
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {isEdit ? "Editar tarefa" : isSub ? "Nova subtarefa" : "Nova tarefa"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Título, prazo, responsável e vínculo."
              : isSub
                ? "Subtarefas aparecem no feed da tarefa principal."
                : "Tarefas aparecem em Tarefas, nos kanbans e na agenda."}
          </SheetDescription>
        </SheetHeader>

        <TaskForm
          task={task}
          defaults={defaults}
          ctx={ctx}
          onDone={() => {
            setOpen(false);
            if (onDone) onDone();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
