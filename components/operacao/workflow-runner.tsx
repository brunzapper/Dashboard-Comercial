// Versão: 1.0 | Data: 08/09/2026
// Formulário de execução de um esquema de Workflow (0125).
//
// UMA lista plana de campos. Quem lança não vê "empresa / contato / lead" como
// blocos separados e não vê passo nenhum — vê os dados que precisa informar. O
// destrinchar em várias entidades do sistema de destino é dos PASSOS, resolvido
// no servidor; expor essa estrutura aqui obrigaria a pessoa a entender o
// modelo do CRM para preencher um formulário.
//
// A quebra por passo só aparece quando algo dá errado pela metade (parte já foi
// para o destino — reenviar às cegas duplicaria) ou para o admin, que é quem
// vai consertar o esquema.
"use client";

import { useActionState, useEffect, useState } from "react";
import { ExternalLink, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { emitDataChanged } from "@/lib/tasks/events";
import type { WorkflowFormField } from "@/lib/workflow/types";
import {
  runWorkflow,
  type WorkflowRunState,
} from "@/app/(app)/operacao/workflow/actions";

const initial: WorkflowRunState = {};

function FieldInput({
  field,
  options,
}: {
  field: WorkflowFormField;
  options: string[];
}) {
  const name = `wf__${field.key}`;
  const [value, setValue] = useState(field.defaultValue ?? "");

  if (field.type === "selecao") {
    return (
      <Combobox
        id={name}
        name={name}
        options={[
          { value: "", label: "—" },
          ...options.map((o) => ({ value: o, label: o })),
        ]}
        value={value}
        onValueChange={setValue}
        placeholder={field.placeholder ?? "—"}
        emptyText="Nenhuma opção — rode uma sincronização para carregar a lista."
        className="w-full"
        aria-label={field.label}
      />
    );
  }
  if (field.type === "texto_longo") {
    return (
      <Textarea
        id={name}
        name={name}
        rows={3}
        defaultValue={field.defaultValue ?? ""}
        placeholder={field.placeholder}
      />
    );
  }
  const inputType =
    field.type === "email"
      ? "email"
      : field.type === "telefone"
        ? "tel"
        : field.type === "numero"
          ? "number"
          : field.type === "data"
            ? "date"
            : "text";
  return (
    <Input
      id={name}
      type={inputType}
      name={name}
      defaultValue={field.defaultValue ?? ""}
      placeholder={field.placeholder}
    />
  );
}

export function WorkflowRunner({
  schemaKey,
  schemaLabel,
  description,
  fields,
  options,
}: {
  schemaKey: string;
  schemaLabel: string;
  description: string | null;
  /** Já filtrados por `visible` e ordenados pelo servidor. */
  fields: WorkflowFormField[];
  /** Opções por chave de campo — vindas do que o sistema já computou. */
  options: Record<string, string[]>;
}) {
  const [state, formAction, pending] = useActionState(runWorkflow, initial);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (state.ok) {
      // Limpa o formulário para o próximo lançamento e avisa quem exibe dados.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormKey((k) => k + 1);
      emitDataChanged({ kind: "record", recordId: null });
    }
  }, [state.ok, state.status]);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      <input type="hidden" name="schema_key" value={schemaKey} />

      <div>
        <h3 className="font-medium">{schemaLabel}</h3>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>

      <div key={formKey} className="flex flex-col gap-3">
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`wf__${field.key}`}>
              {field.label}
              {field.required ? (
                <span className="text-destructive ml-0.5">*</span>
              ) : null}
            </Label>
            <FieldInput field={field} options={options[field.key] ?? []} />
            {field.help ? (
              <p className="text-muted-foreground text-xs">{field.help}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Send className="size-4" />
          {pending ? "Lançando…" : "Lançar"}
        </Button>
        {state.url ? (
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
          >
            Abrir no CRM <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>

      {state.message ? (
        <p
          role="status"
          className={
            state.ok
              ? "text-sm text-emerald-600 dark:text-emerald-400"
              : "text-destructive text-sm"
          }
        >
          {state.message}
        </p>
      ) : null}

      {/* Quebra por passo: só quando o admin precisa depurar o esquema ou
          quando a execução parou no meio e alguém precisa saber o que já
          existe no destino. */}
      {state.detailed && state.steps && state.steps.length > 0 ? (
        <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
          {state.steps.map((s) => (
            <li key={s.id}>
              <span className="font-medium">{s.label}:</span>{" "}
              {s.error
                ? `falhou — ${s.error}`
                : s.skipped
                  ? "pulado (sem dados para este passo)"
                  : `ok${s.outputId ? ` — ID ${s.outputId}` : ""}`}
              {s.skippedFields.length > 0
                ? ` · campos não enviados: ${s.skippedFields.join(", ")}`
                : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
