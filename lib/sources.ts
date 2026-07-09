// Versão: 1.0 | Data: 09/07/2026
// Fase 8: definição das FONTES do produto. Cada fonte mapeia 1:1 num record_type
// do núcleo `records`, então "fonte" é açúcar sobre record_type — usado na aba
// Registros (abas por fonte) e no construtor de widgets (seleção de fontes).

export type SourceKey = "leads" | "deals" | "estudo";

export const SOURCE_KEYS: SourceKey[] = ["leads", "deals", "estudo"];

export const SOURCE_LABELS: Record<SourceKey, string> = {
  leads: "Leads do Bitrix",
  deals: "Deals do Bitrix",
  estudo: "Estudo de Fechamentos",
};

// record_type correspondente a cada fonte.
export const SOURCE_RECORD_TYPE: Record<SourceKey, "lead" | "negocio" | "venda_site"> = {
  leads: "lead",
  deals: "negocio",
  estudo: "venda_site",
};

// record_type -> fonte (inverso).
export const RECORD_TYPE_SOURCE: Record<string, SourceKey> = {
  lead: "leads",
  negocio: "deals",
  venda_site: "estudo",
};

export function isSourceKey(v: string | null | undefined): v is SourceKey {
  return v === "leads" || v === "deals" || v === "estudo";
}

// Uma FieldDefinition pertence à fonte se applies_to a inclui, ou se applies_to
// está vazio/ausente (campos locais/app valem para todas as fontes).
export function fieldAppliesToSource(
  appliesTo: string[] | null | undefined,
  source: SourceKey
): boolean {
  if (!appliesTo || appliesTo.length === 0) return true;
  return appliesTo.includes(SOURCE_RECORD_TYPE[source]);
}
