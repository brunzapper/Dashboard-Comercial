// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): editor do filtro "Tem tarefa" — estado + janela de dias.
//
// UM editor para as quatro superfícies (filtros do widget, filtro rápido do
// card, /registros e condição de automação): estado da tarefa e dois campos
// numéricos, "dias atrás" e "dias à frente" (0 a 180; vazio = sem limite). A
// régua de validade é a do módulo puro (lib/tasks/task-filter.ts) — este
// componente só a exibe; nunca valida por conta própria.
"use client";

import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  MAX_TASK_FILTER_DAYS,
  parseTaskFilterDays,
  TASK_FILTER_STATUS_LABELS,
  TASK_FILTER_STATUSES,
  type TaskFilterSpec,
  type TaskFilterStatus,
} from "@/lib/tasks/task-filter";
import { cn } from "@/lib/utils";

/** Rascunho do editor: dias como TEXTO (o campo pode estar no meio da digitação). */
export interface TaskFilterDraft {
  status: TaskFilterStatus | "";
  back: string;
  ahead: string;
}

export function draftFromSpec(spec: TaskFilterSpec | null): TaskFilterDraft {
  return {
    status: spec?.status ?? "",
    back: spec?.back != null ? String(spec.back) : "",
    ahead: spec?.ahead != null ? String(spec.ahead) : "",
  };
}

/** Rascunho → spec; null = sem estado escolhido ou dia inválido. */
export function specFromDraft(d: TaskFilterDraft): TaskFilterSpec | null {
  if (!d.status) return null;
  const back = parseTaskFilterDays(d.back);
  const ahead = parseTaskFilterDays(d.ahead);
  if (back === undefined || ahead === undefined) return null;
  return { status: d.status, back, ahead };
}

export function TaskFilterEditor({
  value,
  onChange,
  allowNone = false,
  noneLabel = "Sem filtro de tarefa",
  className,
  compact = false,
}: {
  value: TaskFilterDraft;
  onChange: (next: TaskFilterDraft) => void;
  /** Oferece a opção "sem filtro" no estado (/registros). */
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
  /** Uma linha só (linha de filtro do construtor). */
  compact?: boolean;
}) {
  const backInvalid = parseTaskFilterDays(value.back) === undefined;
  const aheadInvalid = parseTaskFilterDays(value.ahead) === undefined;
  const disabledDays = !value.status;
  // Atrasada é prazo ANTES de hoje: "à frente" não tem efeito nela.
  const aheadDisabled = disabledDays || value.status === "atrasadas";
  const options = [
    ...(allowNone ? [{ value: "", label: noneLabel }] : []),
    ...TASK_FILTER_STATUSES.map((s) => ({
      value: s,
      label: TASK_FILTER_STATUS_LABELS[s],
    })),
  ];
  const dayInput = (
    key: "back" | "ahead",
    label: string,
    invalid: boolean,
    disabled: boolean
  ) => (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_TASK_FILTER_DAYS}
        step={1}
        value={value[key]}
        disabled={disabled}
        placeholder="—"
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={cn("h-8 w-20", invalid && "border-destructive")}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
      <span>{label}</span>
    </label>
  );
  return (
    <div
      className={cn(
        "flex gap-2",
        compact ? "flex-wrap items-center" : "flex-col",
        className
      )}
    >
      <Combobox
        options={options}
        value={value.status}
        onValueChange={(s) =>
          onChange({ ...value, status: s as TaskFilterStatus | "" })
        }
        searchable={false}
        placeholder="Estado da tarefa"
        aria-label="Estado da tarefa"
        className={compact ? "w-44" : "w-full"}
      />
      <div className="flex flex-wrap items-center gap-3">
        {dayInput("back", "dias atrás", backInvalid, disabledDays)}
        {dayInput("ahead", "dias à frente", aheadInvalid, aheadDisabled)}
      </div>
      {backInvalid || aheadInvalid ? (
        <p className="text-destructive text-xs">
          Use um número inteiro de 0 a {MAX_TASK_FILTER_DAYS}, ou deixe vazio.
        </p>
      ) : !compact && value.status ? (
        <p className="text-muted-foreground text-xs">
          Janela sobre o prazo da tarefa, contada a partir de hoje. Vazio = sem
          limite daquele lado.
        </p>
      ) : null}
    </div>
  );
}
