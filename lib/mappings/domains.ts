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
// no de-para recebe o fallback "Não Classificado" (igual ao dashboard antigo)
// e entra no relatório de pendências; valor VAZIO recebe o fallback mas não é
// pendência (não há o que mapear).

export const UNCLASSIFIED = "Não Classificado";

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
  },
  {
    key: "segmento",
    label: "Segmentos",
    recordTypes: ["meetime_outbound"],
    rawFieldKey: "segmento",
    rawFieldLabel: "Segmento",
    targets: [{ fieldKey: "segmento_classificado", label: "Segmento (classificado)" }],
    fallback: { segmento_classificado: UNCLASSIFIED },
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
