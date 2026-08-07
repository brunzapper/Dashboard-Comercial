// Versão: 1.0 | Data: 07/08/2026
// MAPEAMENTOS DE VALORES (de-para) — catálogo de DOMÍNIOS em código + helpers
// PUROS de planejamento. Um domínio liga um campo CRU de uma base (ex.:
// `custom:cargo` do Meetime) aos campos ALVO derivados (ex.: `cargo_area` +
// `cargo_nivel`), preenchidos a partir das entradas de `value_mappings`
// (migração 0117). Substitui os caches "Map Cargos"/"Map Segmentos" do
// dashboard antigo em Apps Script — a chave de lookup é a MESMA normalização
// do cache antigo: lower(trim(valor)).
// Este módulo é PURO (sem I/O) — a aplicação vive em lib/mappings/apply.ts e
// a notificação de não-mapeados em lib/mappings/notify.ts. Valor SEM entrada
// no de-para passa pelo `suggest` do domínio (classificador heurístico V5
// portado — lib/mappings/classify/*): classificável ⇒ vira entrada
// `origin='auto'`; senão recebe o fallback "Não Classificado" e entra nas
// pendências; valor VAZIO recebe o fallback mas não é pendência.
// `options` por target = categorias CANÔNICAS (dropdowns da página +
// validação do assistente de IA) — a UI ainda aceita valor livre (datalist).
import { classifyCargo, CARGO_AREAS, CARGO_NIVEIS } from "./classify/cargo";
import { classifySegmento, SEGMENTO_CATEGORIAS } from "./classify/segmento";
import { UNCLASSIFIED } from "./classify/shared";

export { UNCLASSIFIED };

export interface MappingTarget {
  /** field_key do field_definition local alvo (sem prefixo `custom:`). */
  fieldKey: string;
  label: string;
}

export interface MappingDomain {
  /** Chave do domínio (coluna `value_mappings.domain`). */
  key: string;
  label: string;
  /** record_types cujas linhas carregam o campo cru. */
  recordTypes: string[];
  /** Chave custom (sem prefixo) do campo CRU lido. */
  rawFieldKey: string;
  rawFieldLabel: string;
  targets: MappingTarget[];
  /** Saídas aplicadas quando o valor cru não tem entrada (ou é vazio). */
  fallback: Record<string, string>;
  /** Categorias CANÔNICAS por target (dropdown + validação da IA). */
  options: Record<string, string[]>;
  /**
   * Classificador heurístico do domínio (port do V5): devolve as saídas
   * sugeridas ou null quando NADA foi classificável (⇒ pendência). Resultado
   * não-nulo vira entrada `origin='auto'` na aplicação.
   */
  suggest?: (raw: string) => Record<string, string> | null;
}

/** Sugestão de cargo: null quando área E nível saem "Não Classificado". */
function suggestCargo(raw: string): Record<string, string> | null {
  const { area, nivel } = classifyCargo(raw);
  if (area === UNCLASSIFIED && nivel === UNCLASSIFIED) return null;
  return { cargo_area: area, cargo_nivel: nivel };
}

function suggestSegmento(raw: string): Record<string, string> | null {
  const categoria = classifySegmento(raw);
  if (categoria === UNCLASSIFIED) return null;
  return { segmento_classificado: categoria };
}

export const MAPPING_DOMAINS: MappingDomain[] = [
  {
    key: "cargo",
    label: "Cargos",
    recordTypes: ["meetime_outbound"],
    rawFieldKey: "cargo",
    rawFieldLabel: "Cargo",
    targets: [
      { fieldKey: "cargo_area", label: "Cargo — Área" },
      { fieldKey: "cargo_nivel", label: "Cargo — Nível hierárquico" },
    ],
    fallback: { cargo_area: UNCLASSIFIED, cargo_nivel: UNCLASSIFIED },
    options: {
      cargo_area: [...CARGO_AREAS, UNCLASSIFIED],
      cargo_nivel: [...CARGO_NIVEIS, UNCLASSIFIED],
    },
    suggest: suggestCargo,
  },
  {
    key: "segmento",
    label: "Segmentos",
    recordTypes: ["meetime_outbound"],
    rawFieldKey: "segmento",
    rawFieldLabel: "Segmento",
    targets: [{ fieldKey: "segmento_classificado", label: "Segmento (classificado)" }],
    fallback: { segmento_classificado: UNCLASSIFIED },
    options: { segmento_classificado: [...SEGMENTO_CATEGORIAS, UNCLASSIFIED] },
    suggest: suggestSegmento,
  },
];

export function mappingDomain(key: string): MappingDomain | undefined {
  return MAPPING_DOMAINS.find((d) => d.key === key);
}

/** Domínios cujo record_type foi tocado (gancho pós-import). */
export function mappingDomainsForRecordType(recordType: string): MappingDomain[] {
  return MAPPING_DOMAINS.filter((d) => d.recordTypes.includes(recordType));
}

/** Chave de lookup — byte-igual ao cache do Apps Script antigo. */
export function normalizeRawValue(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

/** Entrada de mapeamento já carregada (linha de value_mappings). */
export interface MappingEntry {
  rawNorm: string;
  outputs: Record<string, unknown>;
}

export type MappingIndex = Map<string, Record<string, unknown>>;

export function buildMappingIndex(entries: MappingEntry[]): MappingIndex {
  const idx: MappingIndex = new Map();
  for (const e of entries) {
    if (!e.rawNorm) continue;
    idx.set(e.rawNorm, e.outputs ?? {});
  }
  return idx;
}

/**
 * Saídas EFETIVAS para um valor cru: entrada do de-para (limitada aos targets
 * do domínio, com fallback por target ausente) ou o fallback inteiro.
 * `unmapped` = valor NÃO-vazio sem entrada (candidato a pendência).
 */
export function resolveOutputs(
  domain: MappingDomain,
  rawValue: unknown,
  index: MappingIndex
): { outputs: Record<string, string>; unmapped: boolean } {
  const norm = normalizeRawValue(rawValue);
  const outputs: Record<string, string> = {};
  if (!norm) {
    for (const t of domain.targets)
      outputs[t.fieldKey] = domain.fallback[t.fieldKey] ?? UNCLASSIFIED;
    return { outputs, unmapped: false };
  }
  const entry = index.get(norm);
  for (const t of domain.targets) {
    const v = entry?.[t.fieldKey];
    outputs[t.fieldKey] =
      typeof v === "string" && v.trim() !== ""
        ? v.trim()
        : domain.fallback[t.fieldKey] ?? UNCLASSIFIED;
  }
  return { outputs, unmapped: entry === undefined };
}

/** Entrada de auto-classificação pronta p/ upsert (origin='auto'). */
export interface AutoClassifiedEntry {
  rawValue: string;
  rawNorm: string;
  outputs: Record<string, string>;
}

/**
 * Roda o classificador do domínio sobre valores AINDA sem entrada e devolve
 * as entradas auto-classificadas (suggest não-nulo). Puro — a aplicação
 * (apply.ts) faz o upsert com origin='auto' ANTES de planejar as escritas,
 * replicando o Apps Script antigo (que classificava e gravava no cache).
 */
export function autoClassifyValues(
  domain: MappingDomain,
  values: { norm: string; display: string }[]
): AutoClassifiedEntry[] {
  if (!domain.suggest) return [];
  const out: AutoClassifiedEntry[] = [];
  for (const v of values) {
    if (!v.norm) continue;
    const outputs = domain.suggest(v.display);
    if (outputs) out.push({ rawValue: v.display, rawNorm: v.norm, outputs });
  }
  return out;
}

/** Linha mínima de `records` que o planejador consome. */
export interface MappingRecordRow {
  id: string;
  is_mock?: boolean | null;
  custom_fields: Record<string, unknown> | null;
}

export interface PlannedMappingWrite {
  recordId: string;
  /** Merge a aplicar em custom_fields (só chaves que MUDAM). */
  changes: Record<string, string>;
}

export interface MappingPlan {
  writes: PlannedMappingWrite[];
  /** Valor cru (forma original, 1ª vista) → contagem de registros sem entrada. */
  unmapped: Map<string, number>;
}

/**
 * Planeja as escritas de um domínio sobre um lote de registros: devolve só as
 * DIFERENÇAS (idempotente — rodar duas vezes não reescreve nada) e o tally de
 * valores não mapeados. Mock nunca recebe escrita (defesa em profundidade —
 * o chamador também filtra).
 */
export function planMappingWrites(
  domain: MappingDomain,
  rows: MappingRecordRow[],
  index: MappingIndex
): MappingPlan {
  const writes: PlannedMappingWrite[] = [];
  const unmapped = new Map<string, number>();
  const firstSeen = new Map<string, string>();
  for (const row of rows) {
    if (row.is_mock) continue;
    const custom = row.custom_fields ?? {};
    const raw = custom[domain.rawFieldKey];
    const { outputs, unmapped: miss } = resolveOutputs(domain, raw, index);
    if (miss) {
      const norm = normalizeRawValue(raw);
      const display = firstSeen.get(norm) ?? String(raw).trim();
      firstSeen.set(norm, display);
      unmapped.set(display, (unmapped.get(display) ?? 0) + 1);
    }
    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries(outputs)) {
      if ((custom[k] ?? null) !== v) changes[k] = v;
    }
    if (Object.keys(changes).length > 0) writes.push({ recordId: row.id, changes });
  }
  return { writes, unmapped };
}
