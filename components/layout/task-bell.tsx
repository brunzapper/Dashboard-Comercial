// Versão: 2.0 | Data: 17/07/2026
// Sino de ALERTAS de tarefas (in-app): botão flutuante fixo no topo-direito
// (o shell não tem header; segue o padrão dos controles flutuantes).
// v2.0 (17/07/2026): duas seções — "Novas" (tarefas criadas/reatribuídas p/
//   mim desde a última visualização; abrir o sino carimba a marca d'água
//   tasksSeenAt) e "Com prazo" (vencidas/próximas). Ambas filtradas pela regra
//   de notificação: GLOBAL notifica todos; sem responsável → só o criador; com
//   responsável → responsável + criador (uma linha — nunca duplica). Badge =
//   novas + com prazo (sem duplicar); atualiza na hora via event bus (W1).
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Globe } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  completeTask,
  countTaskAlerts,
  listTaskAlerts,
  markTasksSeen,
} from "@/lib/tasks/actions";
import { emitDataChanged, useDataChanged } from "@/lib/tasks/events";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import type { TaskRow } from "@/lib/tasks/types";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";

function BellTaskRow({
  task,
  onDone,
}: {
  task: TaskRow;
  onDone: () => void;
}) {
  const status = classifyDue(task);
  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1.5">
      <input
        type="checkbox"
        checked={false}
        onChange={async () => {
          const res = await completeTask(task.id);
          if (res.ok) {
            emitDataChanged({
              kind: "task",
              taskId: task.id,
              recordId: task.record_id,
              boardId: task.board_id,
            });
            onDone();
          }
        }}
        className="accent-primary size-4 shrink-0"
        aria-label="Concluir tarefa"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 truncate text-sm">
          {task.is_global ? (
            <Globe
              className="text-primary size-3 shrink-0"
              aria-label="Tarefa global"
            />
          ) : null}
          <span className="truncate">{task.title}</span>
        </p>
        {task.record?.title ? (
          <p className="text-muted-foreground truncate text-xs">
            {task.record.title}
          </p>
        ) : null}
      </div>
      {task.due_date ? (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
            status === "atrasada" && "bg-destructive/10 text-destructive",
            status === "em_breve" && "bg-amber-500/15 text-amber-700"
          )}
          title={status ? DUE_STATUS_LABELS[status] : undefined}
        >
          {formatDateValue(task.due_date, DEFAULT_DATE_FORMAT)}
          {task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
        </span>
      ) : null}
    </div>
  );
}

export function TaskBell({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState<TaskRow[] | null>(null);
  const [fresh, setFresh] = useState<TaskRow[] | null>(null);
  const [count, setCount] = useState(initialCount);
  const [, startTransition] = useTransition();

  function reload() {
    startTransition(async () => {
      const alerts = await listTaskAlerts();
      setDue(alerts.due);
      setFresh(alerts.fresh);
      setCount(alerts.due.length + alerts.fresh.length);
      // Abrir o sino marca as "Novas" como vistas (elas permanecem visíveis
      // até fechar; o badge cai ao fechar).
      void markTasksSeen();
    });
  }

  // Event bus: mutação de tarefa em qualquer lugar → badge (e lista, se
  // aberta) atualizam sem esperar navegação/refresh do layout.
  useDataChanged((d) => {
    if (d.kind === "record") return;
    if (open) reload();
    else startTransition(async () => setCount(await countTaskAlerts()));
  });

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reload();
        // Fechar: as "Novas" já foram carimbadas — badge volta a só prazo.
        else setCount(due?.length ?? 0);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Alertas de tarefas (${count})`}
          className="bg-background/80 fixed top-3 right-3 z-40 size-9 rounded-full shadow-sm backdrop-blur"
        >
          <Bell className="size-4" />
          {count > 0 ? (
            <span className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 flex size-4.5 items-center justify-center rounded-full text-[10px] font-semibold">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Novas para você</p>
            {fresh == null ? (
              <p className="text-muted-foreground text-xs">Carregando…</p>
            ) : fresh.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                Nada novo desde a última visita.
              </p>
            ) : (
              <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {fresh.map((t) => (
                  <BellTaskRow key={t.id} task={t} onDone={() => {
                    reload();
                    router.refresh();
                  }} />
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t pt-2">
            <p className="text-sm font-medium">Tarefas com prazo</p>
            {due == null ? (
              <p className="text-muted-foreground text-xs">Carregando…</p>
            ) : due.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nenhuma tarefa vencida ou próxima do prazo. 🎉
              </p>
            ) : (
              <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {due.map((t) => (
                  <BellTaskRow key={t.id} task={t} onDone={() => {
                    reload();
                    router.refresh();
                  }} />
                ))}
              </div>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            Você é notificado das tarefas globais, das que criou e das
            atribuídas a você. Veja tudo em{" "}
            <a href="/tarefas" className="underline">
              Tarefas
            </a>
            .
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
