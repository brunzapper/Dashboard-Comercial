// Versão: 1.0 | Data: 02/08/2026
// "Aplica-se a" (field_definitions.applies_to) editável na UI de Campos
// (02/08/2026): helpers PUROS de parse/validação usados pelas actions de
// /campos — o form monta as checkboxes pelo MESMO catálogo (rootSources).
// Semântica (fieldAppliesToSource, lib/sources.ts): lista de record_types de
// bases RAIZ; vazia = campo GERAL (vale para todas as bases). Sub-bases herdam
// o record_type da PAI — nunca aparecem em applies_to.
// Só campo LOCAL/app edita applies_to pela UI: linhas do Bitrix têm a coluna
// reescrita pelo sync do catálogo e linhas core nem a usam (invariante 13).

import { rootSources, type SourceDef } from "@/lib/sources";

export type ParseAppliesToResult =
  | { ok: true; appliesTo: string[] }
  | { ok: false; message: string };

// Dedupe preservando a ordem; cada valor precisa ser record_type de base RAIZ
// do catálogo (um valor desconhecido indica form velho/adulterado — erro alto,
// nunca gravar em silêncio).
export function parseAppliesTo(
  values: string[],
  sources: SourceDef[]
): ParseAppliesToResult {
  const roots = new Set(rootSources(sources).map((s) => s.recordType));
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v || out.includes(v)) continue;
    if (!roots.has(v)) {
      return {
        ok: false,
        message: `Base desconhecida em "Aplica-se a": "${v}".`,
      };
    }
    out.push(v);
  }
  return { ok: true, appliesTo: out };
}

// Guarda de estreitamento: base/sub que usa `custom:<key>` como campo de
// período exige applies_to cobrindo o record_type dela (é o que
// validateCustomPeriodField confere no caminho inverso, em registros/bases) —
// restringir o campo deixaria aquele período órfão. Lista vazia = campo geral,
// cobre tudo. Sub entra na varredura com o record_type da PAI (SourceDef).
export function appliesToPeriodConflict(
  fieldKey: string,
  appliesTo: string[],
  sources: SourceDef[]
): string | null {
  if (appliesTo.length === 0) return null;
  const ref = `custom:${fieldKey}`;
  const orphan = sources.find(
    (s) => s.defaultPeriodField === ref && !appliesTo.includes(s.recordType)
  );
  if (!orphan) return null;
  return (
    `O campo é o campo de período de "${orphan.label}" — mantenha a base ` +
    `correspondente marcada em "Aplica-se a" (ou troque o período da base antes).`
  );
}
