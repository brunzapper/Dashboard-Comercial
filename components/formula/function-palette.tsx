// Versão: 1.0 | Data: 20/07/2026
// Paleta de FUNÇÕES do FormulaEditor (view visual): antes, SE/E/OU e
// SOMASE/CONT.SE/MÉDIASE só existiam DIGITANDO no modo texto — a paleta as
// torna montáveis por clique (inserção como tokens FUNC ( ), com o cursor
// dentro dos parênteses). Funções de agregação/comparação de período só
// aparecem no contexto agregado (no por-registro são impossíveis por
// construção — o servidor as rejeita com mensagem dedicada).
"use client";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { FormulaFuncName } from "@/lib/records/formulas";

interface FuncSpec {
  name: FormulaFuncName;
  sig: string;
  group: string;
  aggOnly?: boolean;
}

// Assinaturas curtas exibidas no seletor (o nome insere; a assinatura ensina).
const FUNCS: FuncSpec[] = [
  { name: "SE", sig: "SE(condição; então; senão)", group: "Condicionais" },
  { name: "E", sig: "E(cond1; cond2; …)", group: "Condicionais" },
  { name: "OU", sig: "OU(cond1; cond2; …)", group: "Condicionais" },
  {
    name: "SOMASE",
    sig: "SOMASE([Campo]; condição)",
    group: "Agregações condicionais",
    aggOnly: true,
  },
  {
    name: "SOMASES",
    sig: "SOMASES([Campo]; cond1; cond2; …)",
    group: "Agregações condicionais",
    aggOnly: true,
  },
  {
    name: "CONT.SE",
    sig: "CONT.SE(condição)",
    group: "Agregações condicionais",
    aggOnly: true,
  },
  {
    name: "CONT.SES",
    sig: "CONT.SES(cond1; cond2; …)",
    group: "Agregações condicionais",
    aggOnly: true,
  },
  {
    name: "MÉDIASE",
    sig: "MÉDIASE([Campo]; condição)",
    group: "Agregações condicionais",
    aggOnly: true,
  },
  { name: "SOMA", sig: "SOMA(a; b; …)", group: "Matemáticas" },
  { name: "MÉDIA", sig: "MÉDIA(a; b; …)", group: "Matemáticas" },
  { name: "MÍN", sig: "MÍN(a; b; …)", group: "Matemáticas" },
  { name: "MÁX", sig: "MÁX(a; b; …)", group: "Matemáticas" },
  { name: "CONT.NÚM", sig: "CONT.NÚM(a; b; …)", group: "Matemáticas" },
  { name: "CONT.VALORES", sig: "CONT.VALORES(a; b; …)", group: "Matemáticas" },
  { name: "ARRED", sig: "ARRED(valor; casas)", group: "Matemáticas" },
  { name: "ABS", sig: "ABS(valor)", group: "Matemáticas" },
  { name: "CONCATENAR", sig: "CONCATENAR(a; b; …)", group: "Matemáticas" },
  {
    name: "ANTERIOR",
    sig: 'ANTERIOR(expr; "anterior"|"ano")',
    group: "Comparação de período",
    aggOnly: true,
  },
  {
    name: "VARPCT",
    sig: "VARPCT(expr) — variação % vs período anterior",
    group: "Comparação de período",
    aggOnly: true,
  },
  {
    name: "VARABS",
    sig: "VARABS(expr) — variação absoluta vs período anterior",
    group: "Comparação de período",
    aggOnly: true,
  },
];

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
  const options: ComboboxOption[] = FUNCS.filter(
    (f) => context === "aggregate" || !f.aggOnly
  ).map((f) => ({ value: f.name, label: f.sig, cleanLabel: f.name, group: f.group }));
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
