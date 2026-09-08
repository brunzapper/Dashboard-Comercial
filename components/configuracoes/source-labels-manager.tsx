// Versão: 2.1 | Data: 07/08/2026
// v2.1 (07/08/2026): a action não revalida mais ("/", "layout") — refresh
//   pós-sucesso via useRefreshOnActionOk (o provider do layout re-renderiza).
// Form do rótulo dos campos "GERAIS" (presentes em todas as fontes) — grava em
// sync_config 'source_labels' via Server Action. Os nomes curtos POR FONTE
// migraram para o catálogo (data_sources.short_label, editados na própria
// fonte em SourcesManager).
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRefreshOnActionOk } from "@/lib/use-debounced-refresh";
import {
  saveSourceLabels,
  type SourceLabelsActionState,
} from "@/app/(app)/registros/bases/actions";

const initial: SourceLabelsActionState = {};

export function SourceLabelsManager({ geral }: { geral: string }) {
  const [state, formAction, pending] = useActionState(saveSourceLabels, initial);
  // A action não revalida — o refresh pós-sucesso atualiza o provider do layout.
  useRefreshOnActionOk(state);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-label-geral">
          Campos gerais (todas as bases)
        </Label>
        <Input
          id="source-label-geral"
          name="geral"
          defaultValue={geral}
          maxLength={40}
          required
          aria-label="Rótulo dos campos gerais"
        />
        <p className="text-muted-foreground text-xs">
          Rótulo usado nos dropdowns de campo para os campos que existem em
          todas as bases.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
        {state.message ? (
          <p
            className={
              state.ok ? "text-sm text-emerald-600 dark:text-emerald-400" : "text-destructive text-sm"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
