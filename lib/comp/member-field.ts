// Versão: 1.0 | Data: 02/08/2026
// Validação PURA do campo de membro de um fator × fontes EFETIVAS do fator.
// Motivação: campo de texto de OUTRA fonte (ex. "SDR da Reunião", que é de
// lead) passava no catálogo do savePlan, salvava, e o filtro injetado
// (memberFilterFor) nunca casava nada — realizado 0 em SILÊNCIO para todo
// membro. As fontes efetivas são factor.sources ∪ fontes tocadas pelos
// operandos da fórmula (formulaSourceKeys — os fatores do preset usam
// sources: [] + refs `@fonte`); sub-fonte conta pelo record_type da PAI.
// Só refs `custom:` são checados (coluna do núcleo existe em toda fonte;
// match:/unified: ficam fora do escopo — o catálogo já os barra ou aceita).
// Fail-open deliberado: sem fontes resolvíveis ou campo sem applies_to, não
// há base para afirmar incompatibilidade (o check do catálogo segue valendo).

import type { FieldDefinition } from "@/lib/records/types";
import { recordTypeOf, sourceLabel, type SourceDef } from "@/lib/sources";
import { formulaSourceKeys } from "@/lib/widgets/fields";
import type { CompFactor } from "./model";

export function memberFieldSourceError(
  factor: Pick<CompFactor, "label" | "memberField" | "sources" | "formula">,
  allFields: FieldDefinition[],
  sources: SourceDef[]
): string | null {
  const ref = factor.memberField;
  if (!ref || !ref.startsWith("custom:")) return null;
  const def = allFields.find(
    (f) => f.field_key === ref.slice("custom:".length)
  );
  if (!def) return null; // catálogo do savePlan já barra com mensagem própria
  const applies = def.applies_to ?? [];
  if (applies.length === 0) return null; // campo "geral"
  const keys =
    factor.sources.length > 0
      ? factor.sources
      : formulaSourceKeys(factor.formula, allFields);
  if (keys.length === 0) return null; // sem base p/ afirmar
  const factorTypes = new Set(keys.map((k) => recordTypeOf(k, sources)));
  // Presente em ALGUMA fonte do fator já vale (ex.: SDR Responsável não
  // existe em Vendas Site — a perna sem o campo não credita ninguém, design
  // aceito do plano Outbound).
  if (applies.some((rt) => factorTypes.has(rt))) return null;
  const names = [...new Set(keys.map((k) => sourceLabel(k, sources)))].join(
    ", "
  );
  return (
    `Campo de membro "${def.label}" não existe nas fontes do fator ` +
    `"${factor.label}" (${names}) — escolha um campo de texto/seleção dessas fontes.`
  );
}
