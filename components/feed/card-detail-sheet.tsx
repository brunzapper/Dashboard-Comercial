// Versão: 1.0 | Data: 17/07/2026
// Painel de DETALHE de um card do kanban (clique no corpo do card): duas abas
// — "Feed" (padrão: tarefas/subtarefas + comentários, EntityFeed) e "Dados"
// (o formulário de edição existente: RecordEditForm ou TaskForm). Uma única
// instância por quadro (estado içado no KanbanBoard) — não é um Sheet por
// card. Alternância de abas segue o padrão visual dos view-switchers do app.
"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RECORD_TYPE_LABELS, type RecordRow } from "@/lib/records/types";
import type { TaskRow } from "@/lib/tasks/types";
import type { KanbanRecordContext } from "@/components/kanban/kanban-board";
import {
  RecordEditForm,
} from "@/components/registros/record-edit-sheet";
import {
  TaskForm,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";
import { EntityFeed } from "./entity-feed";

export type CardDetailTarget =
  | { record: RecordRow }
  | { task: TaskRow };

export type CardDetailTab = "feed" | "dados";

export function CardDetailSheet({
  open,
  onOpenChange,
  target,
  recordCtx,
  taskCtx,
  initialTab = "feed",
  focusComposer = false,
  dueSoonDays,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: CardDetailTarget | null;
  recordCtx: KanbanRecordContext;
  taskCtx?: TaskFormContext;
  initialTab?: CardDetailTab;
  focusComposer?: boolean;
  dueSoonDays?: number;
}) {
  const [tab, setTab] = useState<CardDetailTab>(initialTab);

  // Re-sincroniza a aba a cada abertura (o alvo muda entre aberturas).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setTab(initialTab);
  }, [open, initialTab, target]);

  if (!target) return null;
  const isRecord = "record" in target;
  const title = isRecord
    ? (target.record.title ?? "(sem título)")
    : target.task.title;
  const subtitle = isRecord
    ? `${RECORD_TYPE_LABELS[target.record.record_type]} · ${target.record.source_system}`
    : "Tarefa";

  // Contexto de tarefa: cai no recordCtx quando o chamador não fornecer
  // (kanban de registros — os papéis vêm do contexto de registros).
  const isManager =
    recordCtx.userRoles.includes("admin") ||
    recordCtx.userRoles.includes("gestor");
  const effTaskCtx: TaskFormContext = taskCtx ?? {
    responsibles: recordCtx.responsibles,
    canAssignOthers: isManager,
    canLock: isManager,
    canGlobal: isManager,
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </SheetHeader>

        <div className="px-4">
          <div className="flex w-fit rounded-md border p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 px-3", tab === "feed" && "bg-muted")}
              onClick={() => setTab("feed")}
              aria-pressed={tab === "feed"}
            >
              Feed
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 px-3", tab === "dados" && "bg-muted")}
              onClick={() => setTab("dados")}
              aria-pressed={tab === "dados"}
            >
              Dados
            </Button>
          </div>
        </div>

        {tab === "feed" ? (
          <div className="px-4 pb-6">
            <EntityFeed
              target={
                isRecord
                  ? { recordId: target.record.id }
                  : { taskId: target.task.id }
              }
              taskCtx={effTaskCtx}
              recordTitle={isRecord ? target.record.title : null}
              dueSoonDays={dueSoonDays}
              focusComposer={focusComposer}
            />
          </div>
        ) : isRecord ? (
          <RecordEditForm
            // v20/07/2026: key por registro — trocar de card com o painel
            // aberto não pode herdar responsável/operação/moeda do anterior
            // (useState inicial só roda na montagem).
            key={target.record.id}
            record={target.record}
            fields={recordCtx.fields}
            responsibles={recordCtx.responsibles}
            operations={recordCtx.operations}
            relatedLeadLabel={null}
            userRoles={recordCtx.userRoles}
            canEditValues={recordCtx.canEditValues}
            canManageFields={recordCtx.canManageFields}
            onSaved={() => onOpenChange(false)}
          />
        ) : (
          <TaskForm
            key={target.task.id}
            task={target.task}
            ctx={effTaskCtx}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
