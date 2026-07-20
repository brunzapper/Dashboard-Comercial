// Versão: 2.2 | Data: 19/07/2026
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
// v2.1 (16/07/2026): manualEntry — a fonte aceita criação MANUAL de registros
//   no app (data_sources.manual_entry, migração 0061). Builtins (alimentados
//   por Sync) nascem desligados.
// v2.2 (19/07/2026): SUB-FONTES (migração 0078). Uma sub-fonte é tratada como
//   fonte em todo lugar, mas suas linhas são as da fonte PAI filtradas por um
//   predicado (`filter`), com campo de data próprio. `parentKey` != undefined a
//   marca; `recordType` é o da PAI (várias fontes podem compartilhar um
//   record_type). Por isso toRecordType/toSourceKey por IDENTIDADE não servem
//   para subs — quem monta consulta usa os resolvers cientes do catálogo abaixo
//   (recordTypeOf, sourcePredicate, planSourceLegs). Resolvidas no ENGINE
//   (perna por source-key); NÃO tocam nas RPCs de widget.
import type { WidgetFilter } from "@/lib/widgets/types";

export type SourceKey = string;

/** Definição de uma fonte (linha de `data_sources`, `sub_sources` ou builtin). */
export interface SourceDef {
  key: string; // slug; para fontes novas, key === recordType
  recordType: string; // records.record_type correspondente (o da PAI, se sub)
  label: string; // nome completo (listas, abas)
  shortLabel: string; // chip/prefixo dos dropdowns de campo
  defaultPeriodField: string; // campo de data padrão da barra de período
  builtin: boolean;
  // A fonte aceita registros criados manualmente no app (0061). Fontes de Sync
  // (builtins) nascem desligadas; o admin pode religar em Configurações→Fontes.
  manualEntry: boolean;
  // SUB-FONTE (0078): key da fonte PAI. Presente => esta é uma sub-fonte, cujas
  // linhas são as da pai recortadas por `filter`. Ausente => fonte "raiz".
  parentKey?: string;
  // SUB-FONTE (0078): predicado (WidgetFilter[]) que recorta as linhas da pai.
  // Resolvido no engine com record_types:[record_type da pai] (wrap por fonte).
  filter?: WidgetFilter[];
  // Fuso horário da ORIGEM (IANA, ex. "Europe/Moscow"; 0079). Datetimes
  // ingeridos desta fonte são normalizados p/ Brasília na ENTRADA
  // (lib/date/normalize.ts, aplicado no sync). null/ausente = sem conversão.
  // Subs não têm (herdam a ingestão da pai).
  timezone?: string | null;
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
    manualEntry: false,
    timezone: "Europe/Moscow",
  },
  {
    key: "deals",
    recordType: "negocio",
    label: "Deals do Bitrix",
    shortLabel: "Deals",
    defaultPeriodField: "closed_at",
    builtin: true,
    manualEntry: false,
    timezone: "Europe/Moscow",
  },
  {
    key: "estudo",
    recordType: "venda_site",
    label: "Estudo de Fechamentos",
    shortLabel: "Estudo",
    defaultPeriodField: "source_created_at",
    builtin: true,
    manualEntry: false,
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
// está vazio/ausente (campos locais/app valem para todas as fontes). Ciente do
// catálogo: uma sub-fonte herda o record_type (logo os campos) da PAI.
export function fieldAppliesToSource(
  appliesTo: string[] | null | undefined,
  source: SourceKey,
  sources: SourceDef[] = BUILTIN_SOURCES
): boolean {
  if (!appliesTo || appliesTo.length === 0) return true;
  return appliesTo.includes(recordTypeOf(source, sources));
}

// ============ SUB-FONTES (0078) — resolvers cientes do catálogo ============
// toRecordType/toSourceKey por identidade NÃO servem para subs (a sub
// compartilha o record_type da pai). Estes resolvers recebem o catálogo
// (SourceDef[] carregado por lib/config/sources.ts) e são a fonte de verdade nos
// caminhos que montam consulta (engine, período, modo lista).

/** A fonte é uma sub-fonte (tem pai)? */
export function isSubSource(
  key: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): boolean {
  return Boolean(sources.find((s) => s.key === key)?.parentKey);
}

/** Key da fonte pai de uma sub-fonte (null se não for sub / não achada). */
export function parentKeyOf(
  key: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): string | null {
  return sources.find((s) => s.key === key)?.parentKey ?? null;
}

/**
 * record_type de uma fonte QUALQUER usando o catálogo — resolve subs para o
 * record_type da pai (o `toRecordType` por identidade devolveria a key da sub,
 * que não é um record_type válido). Fallback: `toRecordType` (builtin/identidade)
 * quando a fonte não está no catálogo.
 */
export function recordTypeOf(
  key: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): string {
  const def = sources.find((s) => s.key === key);
  return def?.recordType ?? toRecordType(key);
}

/** Predicado (WidgetFilter[]) que recorta as linhas da pai; [] p/ fontes raiz. */
export function sourcePredicate(
  key: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): WidgetFilter[] {
  const f = sources.find((s) => s.key === key)?.filter;
  return Array.isArray(f) ? f : [];
}

/** Sub-fontes de uma pai. */
export function subSourcesOf(
  parentKey: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): SourceDef[] {
  return sources.filter((s) => s.parentKey === parentKey);
}

/** Fontes RAIZ (não-sub) do catálogo. */
export function rootSources(
  sources: SourceDef[] = BUILTIN_SOURCES
): SourceDef[] {
  return sources.filter((s) => !s.parentKey);
}

/**
 * Planeja as PERNAS de consulta de um widget a partir da seleção de fontes e do
 * toggle de convivência (settings.coexistSubSources).
 *
 * Passo 1 — candidatas: uma sub entra quando (a) sua pai NÃO está selecionada
 * (fonte filtrada avulsa) ou (b) está em `coexist` (conviver explícito). Senão é
 * ABSORVIDA (a pai já cobre suas linhas) e some. Fontes raiz sempre entram.
 *
 * Passo 2 — main × extra: a consulta PRINCIPAL resolve UMA fonte efetiva por
 * `record_type` (assim o `byType`/coalesce/`record_type in` seguem chaveados por
 * record_type, sem recriar as RPCs). Candidatas que sobram no mesmo record_type
 * (ex.: pai + sub em conviver, ou duas subs da mesma pai) viram `extraLegs` —
 * pernas próprias mescladas no nível do resultado (adicionam linhas).
 *
 * `selected` vazio = "todas as fontes" → principal sem filtro de fonte
 * (allMain=true), sem subs (subs só entram quando explicitamente marcadas).
 */
export function planSourceLegs(
  selected: SourceKey[] | undefined,
  coexist: SourceKey[] | undefined,
  sources: SourceDef[] = BUILTIN_SOURCES
): { mainSources: SourceKey[]; allMain: boolean; extraLegs: SourceKey[] } {
  const sel = selected ?? [];
  if (sel.length === 0) {
    return { mainSources: [], allMain: true, extraLegs: [] };
  }
  const selSet = new Set(sel);
  const coexistSet = new Set(coexist ?? []);

  const candidates: SourceKey[] = [];
  for (const key of sel) {
    if (!isSubSource(key, sources)) {
      candidates.push(key);
      continue;
    }
    const parent = parentKeyOf(key, sources);
    const parentSelected = parent != null && selSet.has(parent);
    if (!parentSelected || coexistSet.has(key)) candidates.push(key);
    // Senão: absorvida.
  }

  const mainSources: SourceKey[] = [];
  const extraLegs: SourceKey[] = [];
  const seenRt = new Set<string>();
  for (const key of candidates) {
    const rt = recordTypeOf(key, sources);
    if (!seenRt.has(rt)) {
      seenRt.add(rt);
      mainSources.push(key);
    } else {
      // Já há uma fonte efetiva para este record_type na principal → perna extra.
      extraLegs.push(key);
    }
  }
  return { mainSources, allMain: false, extraLegs };
}
