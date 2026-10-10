// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): chip do filtro rápido "Tem tarefa" no card.
//
// Mesmo editor das outras superfícies (components/filters/task-filter-editor):
// estado + dias atrás/à frente. "Sem filtro de tarefa" limpa (valor nulo —
// nada persistido). Só rascunho VÁLIDO vira valor: dias no meio da digitação
// não disparam consulta nem apagam a seleção gravada. A gravação em si é a da
// barra (debounce + save otimista em quick-filters-bar).
"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import {
  draftFromSpec,
  specFromDraft,
  TaskFilterEditor,
  type TaskFilterDraft,
} from "@/components/filters/task-filter-editor";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { taskFilterSummary } from "@/lib/tasks/task-filter";
import type { QuickFilterValue } from "@/lib/widgets/quick-filters";

export function TaskQuickFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: QuickFilterValue;
  onChange: (v: QuickFilterValue | null) => void;
}) {
  const spec =
    value?.kind === "tasks"
      ? { status: value.status, back: value.back, ahead: value.ahead }
      : null;
  const [draft, setDraft] = useState<TaskFilterDraft>(() => draftFromSpec(spec));
  // Re-semeia ao abrir: o valor pode ter mudado por outro usuário/refresh.
  const [open, setOpen] = useState(false);
  const summary = spec
    ? taskFilterSummary(spec).replace(/^Tem tarefa: /, "")
    : "Todos";
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(draftFromSpec(spec));
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={spec ? "secondary" : "outline"}
          size="sm"
          className="h-8 max-w-64 gap-1 px-2 text-xs"
          aria-label={`${label}: ${summary}`}
        >
          <span className="truncate">
            {label}: <span className="font-semibold">{summary}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <TaskFilterEditor
          allowNone
          noneLabel="Todos (sem filtro de tarefa)"
          value={draft}
          onChange={(next) => {
            setDraft(next);
            if (!next.status) {
              onChange(null);
              return;
            }
            const s = specFromDraft(next);
            if (s) onChange({ kind: "tasks", ...s });
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
