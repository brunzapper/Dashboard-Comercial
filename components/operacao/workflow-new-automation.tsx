// Versão: 1.0 | Data: 09/09/2026
// A PORTA QUE FALTAVA: criar uma automação sem quadro.
//
// A 0127 deu escopo de Base ao motor — regra que avalia os registros de uma
// Base, sem kanban nenhum. RLS, save e avaliação ficaram prontos, mas o painel
// de regras só é montado dentro de um quadro (kanban-widget / kanban-page):
// uma regra de Base era, na prática, impossível de criar pela interface.
//
// Aqui não há editor novo: escolhida a Base, abre-se o MESMO `AutomationsSheet`
// do quadro, com `owner = { kind: "source" }` e sem colunas. `saveAutomation`,
// `getAutomationFieldOptions` e `parseAutomationRule` já tratam esse dono — e é
// justamente por isso que a porta cabe num arquivo deste tamanho.
//
// Automação de QUADRO não ganha porta aqui de propósito: o painel do quadro já
// cria, e uma segunda porta para a mesma coisa é a régua paralela que a
// invariante 25 proíbe.
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { AutomationsSheet } from "@/components/kanban/automations-sheet";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import type { StepSourceOption } from "./workflow-step-editor";

export function NewAutomationButton({
  sources,
}: {
  sources: StepSourceOption[];
}) {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {open ? (
        <>
          <div className="flex w-56 flex-col gap-1">
            <Label className="text-xs">Base</Label>
            <Combobox
              options={sources.map((s) => ({ value: s.key, label: s.label }))}
              value={base}
              onValueChange={setBase}
              placeholder="Sobre quais registros"
              aria-label="Base da automação"
            />
          </div>
          {base ? (
            // O painel é o do quadro. Sem colunas, "Mover para a coluna" e a
            // condição "parado na coluna" aparecem desabilitadas com motivo —
            // não há posição para medir nem alvo para onde mover.
            <AutomationsSheet
              owner={{ kind: "source", id: base }}
              source={base}
              columns={[]}
              isCustomColumns={false}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              setBase("");
            }}
          >
            Cancelar
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-4" /> Nova automação
        </Button>
      )}
    </div>
  );
}
