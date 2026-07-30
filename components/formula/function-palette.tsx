// Versão: 1.1 | Data: 30/07/2026
// v1.1 (30/07/2026): metadados (assinatura/grupo/descrição) saem do catálogo
//   único FORMULA_FUNCS (lib/records/formula-funcs.ts) — a lista local sumiu.
// Paleta de FUNÇÕES do FormulaEditor: inserção por clique como `NOME()` com o
// cursor dentro dos parênteses. Funções de agregação/comparação de período só
// aparecem no contexto agregado (no por-registro são impossíveis por
// construção — o servidor as rejeita com mensagem dedicada).
"use client";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  FORMULA_FUNC_LIST,
  FUNC_GROUP_LABELS,
  funcSignature,
} from "@/lib/records/formula-funcs";
import type { FormulaFuncName } from "@/lib/records/formulas";

export function FunctionPalette({
  context,
  onInsert,
  className,
}: {
  context: "record" | "aggregate";
  // Insere a função na posição do cursor como `FUNC ( )` (cursor fica dentro).
  onInsert: (name: FormulaFuncName) => void;
  className?: string;
}) {
  // O nome insere; a assinatura ensina; a descrição fica no tooltip da opção.
  const options: ComboboxOption[] = FORMULA_FUNC_LIST.filter(
    (f) => context === "aggregate" || !f.aggOnly
  ).map((f) => ({
    value: f.name,
    label: funcSignature(f),
    cleanLabel: f.name,
    group: FUNC_GROUP_LABELS[f.group],
    title: f.description,
  }));
  return (
    <Combobox
      options={options}
      value=""
      onValueChange={(name) => {
        if (name) onInsert(name as FormulaFuncName);
      }}
      placeholder="ƒ Inserir função…"
      searchPlaceholder="Buscar função…"
      emptyText="Nenhuma função."
      className={className}
      aria-label="Inserir função"
    />
  );
}
