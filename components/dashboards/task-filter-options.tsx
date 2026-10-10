// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): o filtro "Tem tarefa" na linha de filtro do construtor.
//
// Módulo próprio pelo mesmo motivo de `manual-axis-options.ts`: o
// `widget-builder.tsx` está no limite do React Compiler, então a lógica nova
// fica fora dele — lá entra só a constante de opção. O pseudo-campo é UMA
// entrada no seletor ("Tem tarefa"); estado e janela de dias são editados pelo
// `TaskFilterEditor` dentro da própria linha (`TaskFilterRowValue`).
"use client";

import { useState } from "react";

import {
  draftFromSpec,
  specFromDraft,
  TaskFilterEditor,
  type TaskFilterDraft,
} from "@/components/filters/task-filter-editor";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  isTaskFilterField,
  parseTaskFilter,
  serializeTaskFilter,
  TASK_FILTER_PREFIX,
} from "@/lib/tasks/task-filter";
import { TASK_QUICK_FIELD } from "@/lib/widgets/quick-filters";
import type { WidgetFilter } from "@/lib/widgets/types";

/** Valor da opção no seletor de campo (o estado padrão é "pendentes"). */
export const TASK_FILTER_OPTION_VALUE = `${TASK_FILTER_PREFIX}pendentes`;

export const TASK_FILTER_FIELD_OPTIONS: ComboboxOption[] = [
  {
    value: TASK_FILTER_OPTION_VALUE,
    label: "Tem tarefa (estado e prazo)",
    group: "Tarefas",
  },
];

/** Filtro RÁPIDO: a entry só diz "Tem tarefa"; estado e dias vão no valor. */
export const TASK_QUICK_FIELD_OPTIONS: ComboboxOption[] = [
  { value: TASK_QUICK_FIELD, label: "Tem tarefa (estado e prazo)", group: "Tarefas" },
];

/** O valor que o seletor de campo exibe para a linha (todo `task:` é a mesma opção). */
export function filterFieldDisplayValue(field: string): string {
  return isTaskFilterField(field) ? TASK_FILTER_OPTION_VALUE : field;
}

/**
 * Patch ao escolher um campo no seletor: entrar no filtro de tarefa zera
 * operador e valor (o editor próprio os define); sair dele também, para que um
 * "30,60" não vire valor de outro campo.
 */
export function filterFieldPatch(
  prev: WidgetFilter,
  field: string
): Partial<WidgetFilter> {
  const wasTask = isTaskFilterField(prev.field);
  const isTask = isTaskFilterField(field);
  if (isTask && wasTask) return {};
  // "Tem tarefa" vale para o registro inteiro: sem alvo por Base.
  if (isTask) return { field, op: "eq", value: "", sources: undefined };
  if (wasTask) return { field, op: "eq", value: "" };
  return { field };
}

/** Editor da linha: estado + dias atrás/à frente, gravando field/value. */
export function TaskFilterRowValue({
  filter,
  onChange,
}: {
  filter: WidgetFilter;
  onChange: (patch: Partial<WidgetFilter>) => void;
}) {
  // Rascunho local: os dias podem estar no meio da digitação (inválidos) sem
  // que isso apague o filtro gravado — só um rascunho VÁLIDO vira patch.
  const external = `${filter.field}|${String(filter.value ?? "")}`;
  const [draft, setDraft] = useState<TaskFilterDraft>(() =>
    draftFromSpec(parseTaskFilter(filter))
  );
  // A linha é chaveada pelo ÍNDICE no construtor: remover uma linha acima
  // entrega OUTRO filtro a este componente. Re-semeia o rascunho quando o
  // filtro de fora muda por motivo que não foi a própria digitação (padrão
  // "estado derivado de prop" — ajuste durante o render, sem efeito).
  const [seen, setSeen] = useState(external);
  if (external !== seen) {
    setSeen(external);
    const mine = specFromDraft(draft);
    const mineKey = mine
      ? `${serializeTaskFilter(mine).field}|${serializeTaskFilter(mine).value}`
      : null;
    if (mineKey !== external) setDraft(draftFromSpec(parseTaskFilter(filter)));
  }
  return (
    <TaskFilterEditor
      compact
      value={draft}
      onChange={(next) => {
        setDraft(next);
        const spec = specFromDraft(next);
        if (spec) onChange(serializeTaskFilter(spec));
      }}
    />
  );
}
