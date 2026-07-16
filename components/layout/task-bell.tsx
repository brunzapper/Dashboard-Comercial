// Versão: 1.0 | Data: 16/07/2026
// Sino de ALERTAS de tarefas (in-app, D8 do plano): botão flutuante fixo no
// topo-direito (o shell não tem header; segue o padrão dos controles
// flutuantes) com badge de tarefas ABERTAS vencidas/próximas do usuário (a
// RLS escopa) e popover com a lista (concluir inline). Contagem inicial vem
// do server (layout); abrir o popover refaz a busca (listDueTasks).
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { completeTask, listDueTasks } from "@/lib/tasks/actions";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import type { TaskRow } from "@/lib/tasks/types";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";

export function TaskBell({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [count, setCount] = useState(initialCount);
  const [, startTransition] = useTransition();

  function reload() {
    startTransition(async () => {
      const list = await listDueTasks();
      setTasks(list);
      setCount(list.length);
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reload();
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
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Tarefas com prazo</p>
          {tasks == null ? (
            <p className="text-muted-foreground text-xs">Carregando…</p>
          ) : tasks.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhuma tarefa vencida ou próxima do prazo. 🎉
            </p>
          ) : (
            <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
              {tasks.map((t) => {
                const status = classifyDue(t);
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={async () => {
                        const res = await completeTask(t.id);
                        if (res.ok) {
                          reload();
                          router.refresh();
                        }
                      }}
                      className="size-4 shrink-0 accent-primary"
                      aria-label="Concluir tarefa"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{t.title}</p>
                      {t.record?.title ? (
                        <p className="text-muted-foreground truncate text-xs">
                          {t.record.title}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                        status === "atrasada" &&
                          "bg-destructive/10 text-destructive",
                        status === "em_breve" && "bg-amber-500/15 text-amber-700"
                      )}
                      title={status ? DUE_STATUS_LABELS[status] : undefined}
                    >
                      {formatDateValue(t.due_date, DEFAULT_DATE_FORMAT)}
                      {t.due_time ? ` ${t.due_time.slice(0, 5)}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Vencidas e com vencimento nos próximos 3 dias. Veja tudo em{" "}
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
