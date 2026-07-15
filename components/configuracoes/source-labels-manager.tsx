// Versão: 1.0 | Data: 15/07/2026
// Form da tela Configurações → Fontes: edita os nomes curtos de exibição das
// fontes + o rótulo "Geral" (sync_config 'source_labels', via Server Action).
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SOURCE_KEYS,
  SOURCE_LABELS,
  type SourceDisplayLabels,
} from "@/lib/sources";
import {
  saveSourceLabels,
  type SourceLabelsActionState,
} from "@/app/(app)/configuracoes/fontes/actions";

const initial: SourceLabelsActionState = {};

export function SourceLabelsManager({
  labels,
}: {
  labels: SourceDisplayLabels;
}) {
  const [state, formAction, pending] = useActionState(saveSourceLabels, initial);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      {SOURCE_KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-1.5">
          <Label htmlFor={`source-label-${key}`}>{SOURCE_LABELS[key]}</Label>
          <Input
            id={`source-label-${key}`}
            name={key}
            defaultValue={labels[key]}
            maxLength={40}
            required
            aria-label={`Nome curto de ${SOURCE_LABELS[key]}`}
          />
        </div>
      ))}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-label-geral">
          Campos gerais (todas as fontes)
        </Label>
        <Input
          id="source-label-geral"
          name="geral"
          defaultValue={labels.geral}
          maxLength={40}
          required
          aria-label="Rótulo dos campos gerais"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        {state.message ? (
          <p
            className={
              state.ok ? "text-sm text-emerald-600" : "text-destructive text-sm"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
