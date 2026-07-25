// Versão: 1.0 | Data: 25/07/2026
// Rótulo de EXIBIÇÃO de um operando: prefixa a fonte (sourceHint) SÓ quando o
// label ainda não a carrega. Operandos escopados (agg:…@fonte) já saem do
// catálogo com "· <fonte>" no fim — esse label é load-bearing (round-trip
// texto↔visual e validação do servidor casam por ele; nunca alterar no
// catálogo), então prefixar de novo viraria eco ("SQL · Contagem … · SQL").
import type { RefOption } from "@/lib/records/date-operands";

type OperandLabel = Pick<RefOption, "label" | "sourceHint">;

/** Fonte a exibir como prefixo — undefined quando o label já a contém. */
export function displaySourceHint(r: OperandLabel): string | undefined {
  if (!r.sourceHint) return undefined;
  return r.label.endsWith(`· ${r.sourceHint}`) ? undefined : r.sourceHint;
}

/** Rótulo de exibição completo: "Fonte · Label" ou o label puro. */
export function displayLabel(r: OperandLabel): string {
  const hint = displaySourceHint(r);
  return hint ? `${hint} · ${r.label}` : r.label;
}
