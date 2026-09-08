// Versão: 1.0 | Data: 27/07/2026
// Barra flutuante das ações em massa do kanban: aparece com a seleção ativa e
// oferece Mover para (dropdown de colunas), Gerar tarefa (mini-form: título/
// prazo/responsável — cria UMA tarefa por card), Concluir tarefas e Excluir
// (diálogo de confirmação; registros = só admin, tarefas = RLS decide por
// item). O board é quem executa (via fila otimista) — aqui só a UI/gating.
"use client";

import { useState } from "react";
import { CheckCheck, ChevronDown, ListPlus, MoveRight, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { OptionItem } from "@/lib/records/types";
import type { KanbanColumn, KanbanMode } from "@/lib/kanban/types";

export interface BulkTaskInput {
  title: string;
  due_date: string | null;
  responsible_id: string | null;
}

export function BulkActionBar({
  count,
  mode,
  canMove,
  canDelete,
  columns,
  responsibles,
  onMoveTo,
  onCreateTask,
  onCompleteTasks,
  onDelete,
  onClear,
}: {
  count: number;
  mode: KanbanMode;
  canMove: boolean;
  // Registros: admin; tarefas: sempre (RLS/cadeado decidem por item).
  canDelete: boolean;
  columns: KanbanColumn[];
  responsibles: OptionItem[];
  onMoveTo: (targetKey: string) => void;
  onCreateTask: (input: BulkTaskInput) => void;
  onCompleteTasks: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [taskResp, setTaskResp] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const isTasks = mode === "tarefas";
  const targets = columns.filter((c) => !c.noDrop);

  return (
    <div
      role="toolbar"
      aria-label="Ações em massa"
      className="bg-card sticky bottom-2 z-10 flex flex-wrap items-center gap-1.5 self-center rounded-full border px-3 py-1.5 shadow-lg"
    >
      <span className="text-sm font-medium">{count} selecionado(s)</span>

      {canMove ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1">
              <MoveRight className="size-3.5" />
              Mover para
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {targets.map((c) => (
              <DropdownMenuItem key={c.key} onSelect={() => onMoveTo(c.key)}>
                {c.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {!isTasks ? (
        <Popover open={taskOpen} onOpenChange={setTaskOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1">
              <ListPlus className="size-3.5" />
              Gerar tarefa
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-72 flex-col gap-2" align="center">
            <p className="text-muted-foreground text-xs">
              Cria uma tarefa vinculada a CADA card selecionado.
            </p>
            <div className="flex flex-col gap-1">
              <Label className="text-xs" htmlFor="bulk-task-title">
                Título
              </Label>
              <Input
                id="bulk-task-title"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Ex.: Fazer follow-up"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs" htmlFor="bulk-task-due">
                Prazo (opcional)
              </Label>
              <Input
                id="bulk-task-due"
                type="date"
                value={taskDue}
                onChange={(e) => setTaskDue(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Responsável (opcional)</Label>
              <Combobox
                options={[
                  { value: "", label: "— Sem atribuição —" },
                  ...responsibles.map((r) => ({ value: r.id, label: r.label })),
                ]}
                value={taskResp}
                onValueChange={setTaskResp}
                aria-label="Responsável da tarefa"
              />
            </div>
            <Button
              size="sm"
              disabled={taskTitle.trim() === ""}
              onClick={() => {
                onCreateTask({
                  title: taskTitle.trim(),
                  due_date: taskDue || null,
                  responsible_id: taskResp || null,
                });
                setTaskOpen(false);
                setTaskTitle("");
                setTaskDue("");
                setTaskResp("");
              }}
            >
              Criar {count} tarefa(s)
            </Button>
          </PopoverContent>
        </Popover>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1"
        onClick={() => setConfirmComplete(true)}
        title={
          isTasks
            ? "Concluir as tarefas selecionadas"
            : "Concluir as tarefas abertas dos cards selecionados"
        }
      >
        <CheckCheck className="size-3.5" />
        Concluir tarefas
      </Button>
      {/* Concluir em massa é irreversível na prática (não há "reabrir em
          massa") — confirma com o escopo explícito, como o Excluir ao lado. */}
      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title="Concluir tarefas?"
        description={
          isTasks
            ? `As ${count} tarefa(s) selecionada(s) serão marcadas como concluídas.`
            : `Todas as tarefas abertas dos ${count} card(s) selecionado(s) serão marcadas como concluídas.`
        }
        actionLabel="Concluir"
        destructive={false}
        onConfirm={() => {
          setConfirmComplete(false);
          onCompleteTasks();
        }}
      />

      {canDelete ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive h-7 gap-1"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-3.5" />
            Excluir
          </Button>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Excluir {count} {isTasks ? "tarefa(s)" : "registro(s)"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isTasks
                    ? "Tarefas travadas ou de outros usuários não serão excluídas."
                    : "Os registros vão para a Lixeira e podem ser restaurados por um administrador em até 30 dias (Registros → Lixeira). Depois disso são excluídos definitivamente."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDelete();
                  }}
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}

      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Limpar seleção"
        title="Limpar seleção (Esc)"
        onClick={onClear}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
