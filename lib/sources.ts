// Versão: 2.0 | Data: 16/07/2026
// Fase 8: definição das FONTES do produto. Cada fonte mapeia 1:1 num record_type
// do núcleo `records`, então "fonte" é açúcar sobre record_type — usado na aba
// Registros (abas por fonte) e no construtor de widgets (seleção de fontes).
// v1.1 (15/07/2026): rótulos CURTOS de exibição (prefixo/chips dos dropdowns de
//   campo), personalizáveis em Configurações → Fontes (sync_config
//   'source_labels' — ver lib/config/source-labels.ts).
// v2.0 (16/07/2026): fontes DINÂMICAS. O catálogo vivo mora na tabela
//   `data_sources` (migração 0060; loader em lib/config/sources.ts) e os 3
//   builtins abaixo são o fallback/default. Fontes novas usam mapeamento
//   IDENTIDADE (key === record_type), então toRecordType/toSourceKey resolvem
//   qualquer fonte sem precisar do catálogo; apenas listas, rótulos, validação
//   de pertencimento e campo de período dependem do catálogo (parâmetro
//   `sources`, default BUILTIN_SOURCES).

export type SourceKey = string;

/** Definição de uma fonte (linha de `data_sources` ou builtin). */
export interface SourceDef {
  key: string; // slug; para fontes novas, key === recordType
  recordType: string; // records.record_type correspondente
  label: string; // nome completo (listas, abas)
  shortLabel: string; // chip/prefixo dos dropdowns de campo
  defaultPeriodField: string; // campo de data padrão da barra de período
  builtin: boolean;
}

// Fallback/default: as 3 fontes históricas do produto.
export const BUILTIN_SOURCES: SourceDef[] = [
  {
    key: "leads",
    recordType: "lead",
    label: "Leads do Bitrix",
    shortLabel: "Leads",
    defaultPeriodField: "source_created_at",
    builtin: true,
  },
  {
    key: "deals",
    recordType: "negocio",
    label: "Deals do Bitrix",
    shortLabel: "Deals",
    defaultPeriodField: "closed_at",
    builtin: true,
  },
  {
    key: "estudo",
    recordType: "venda_site",
    label: "Estudo de Fechamentos",
    shortLabel: "Estudo",
    defaultPeriodField: "source_created_at",
    builtin: true,
  },
];

export const SOURCE_KEYS: SourceKey[] = BUILTIN_SOURCES.map((s) => s.key);

export const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  BUILTIN_SOURCES.map((s) => [s.key, s.label])
);

// Rótulos de exibição dos dropdowns de campo: nome curto de cada fonte + rótulo
// dos campos "gerais" (presentes em todas as fontes / sem fonte única).
// Chaves = keys das fontes + "geral" (reservada).
export type SourceDisplayLabels = Record<string, string>;

export const DEFAULT_SOURCE_DISPLAY_LABELS: SourceDisplayLabels = {
  ...Object.fromEntries(BUILTIN_SOURCES.map((s) => [s.key, s.shortLabel])),
  geral: "Geral",
};

// record_type correspondente a cada fonte BUILTIN (fontes novas: identidade).
export const SOURCE_RECORD_TYPE: Record<string, string> = Object.fromEntries(
  BUILTIN_SOURCES.map((s) => [s.key, s.recordType])
);

// record_type -> fonte BUILTIN (inverso; fontes novas: identidade).
export const RECORD_TYPE_SOURCE: Record<string, string> = Object.fromEntries(
  BUILTIN_SOURCES.map((s) => [s.recordType, s.key])
);

/** record_type de uma fonte qualquer (builtin mapeado; nova = identidade). */
export function toRecordType(source: string): string {
  return SOURCE_RECORD_TYPE[source] ?? source;
}

/** Fonte de um record_type qualquer (builtin mapeado; novo = identidade). */
export function toSourceKey(recordType: string): string {
  return RECORD_TYPE_SOURCE[recordType] ?? recordType;
}

/** Rótulo completo de uma fonte no catálogo (fallback: a própria key). */
export function sourceLabel(
  key: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): string {
  return sources.find((s) => s.key === key)?.label ?? SOURCE_LABELS[key] ?? key;
}

// Campo de data usado pelo filtro de período de CADA fonte quando o dashboard
// não configura um override explícito (periodBar.fieldBySource). Reflete onde
// cada fonte guarda a data da venda: negócios usam `closed_at` (assinatura/
// fechamento); leads e Estudo (venda do site) só têm `source_created_at` — a
// "Created At" da origem. Sem isto, o default global `closed_at` excluiria todo
// registro de Estudo (closed_at sempre NULL) quando há período ativo.
export const DEFAULT_PERIOD_FIELD_BY_SOURCE: Record<string, string> =
  Object.fromEntries(BUILTIN_SOURCES.map((s) => [s.key, s.defaultPeriodField]));

/** Mapa fonte -> campo de período padrão, a partir do catálogo. */
export function defaultPeriodFieldBySource(
  sources: SourceDef[] = BUILTIN_SOURCES
): Record<string, string> {
  return Object.fromEntries(sources.map((s) => [s.key, s.defaultPeriodField]));
}

/** A key é uma fonte conhecida no catálogo dado? */
export function isKnownSource(
  v: string | null | undefined,
  sources: SourceDef[] = BUILTIN_SOURCES
): v is SourceKey {
  return typeof v === "string" && sources.some((s) => s.key === v);
}

/** Compat: pertencimento às fontes BUILTIN (usos dinâmicos: isKnownSource). */
export function isSourceKey(v: string | null | undefined): v is SourceKey {
  return isKnownSource(v, BUILTIN_SOURCES);
}

// Uma FieldDefinition pertence à fonte se applies_to a inclui, ou se applies_to
// está vazio/ausente (campos locais/app valem para todas as fontes).
export function fieldAppliesToSource(
  appliesTo: string[] | null | undefined,
  source: SourceKey
): boolean {
  if (!appliesTo || appliesTo.length === 0) return true;
  return appliesTo.includes(toRecordType(source));
}
