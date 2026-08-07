// Versão: 1.0 | Data: 07/08/2026
// REGISTRY EFETIVO de domínios de mapeamento: código ∪ banco. Os domínios em
// CÓDIGO (MAPPING_DOMAINS, lib/mappings/domains.ts) seguem imutáveis; os
// DINÂMICOS vivem em `mapping_domains` (0119 — criados pela aba Campos →
// Reclassificações) e são parseados FAIL-CLOSED aqui: linha malformada é
// IGNORADA com aviso, nunca meio-aplicada. Colisão de key: código VENCE (a
// action de criação também barra — defesa em profundidade). Domínio dinâmico
// não tem `suggest` codificado — o motor aprendido (composeSuggester) é o
// único classificador dele. O `db` pode ser service role: o escopo de org é
// SEMPRE explícito no filtro. Sem cache global — cada entry point carrega uma
// vez e passa a lista adiante.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MAPPING_DOMAINS,
  UNCLASSIFIED,
  type MappingDomain,
  type MappingTarget,
} from "./domains";

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,59}$/;

export interface MappingDomainRow {
  key: unknown;
  label: unknown;
  record_types: unknown;
  raw_field_key: unknown;
  raw_field_label: unknown;
  targets: unknown;
}

/** Target dinâmico como gravado no jsonb da linha. */
interface RawTarget {
  fieldKey?: unknown;
  label?: unknown;
  options?: unknown;
}

function asCleanString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Linha do banco → MappingDomain. FAIL-CLOSED: qualquer campo malformado
 * (key/raw_field_key fora do slug, targets vazios/inválidos) devolve null.
 */
export function parseDomainRow(row: MappingDomainRow): MappingDomain | null {
  const key = asCleanString(row.key);
  const label = asCleanString(row.label);
  const rawFieldKey = asCleanString(row.raw_field_key);
  const rawFieldLabel = asCleanString(row.raw_field_label);
  if (!key || !KEY_RE.test(key)) return null;
  if (!label || !rawFieldLabel) return null;
  if (!rawFieldKey || !FIELD_KEY_RE.test(rawFieldKey)) return null;
  if (!Array.isArray(row.record_types)) return null;
  const recordTypes = row.record_types.filter(
    (t): t is string => typeof t === "string" && t.trim() !== ""
  );
  if (recordTypes.length === 0) return null;
  if (!Array.isArray(row.targets) || row.targets.length === 0) return null;
  const targets: MappingTarget[] = [];
  const options: Record<string, string[]> = {};
  const fallback: Record<string, string> = {};
  for (const t of row.targets as RawTarget[]) {
    const fieldKey = asCleanString(t?.fieldKey);
    const tLabel = asCleanString(t?.label);
    if (!fieldKey || !FIELD_KEY_RE.test(fieldKey) || !tLabel) return null;
    if (targets.some((x) => x.fieldKey === fieldKey)) return null;
    targets.push({ fieldKey, label: tLabel });
    const opts = Array.isArray(t.options)
      ? t.options.filter((o): o is string => typeof o === "string" && o.trim() !== "")
      : [];
    options[fieldKey] = opts.includes(UNCLASSIFIED) ? opts : [...opts, UNCLASSIFIED];
    fallback[fieldKey] = UNCLASSIFIED;
  }
  return {
    key,
    label,
    recordTypes,
    rawFieldKey,
    rawFieldLabel,
    targets,
    fallback,
    options,
  };
}

/** União pura código ∪ dinâmicos (código vence colisão de key). */
export function mergeDomains(
  dynamicRows: MappingDomainRow[]
): { domains: MappingDomain[]; skipped: string[] } {
  const domains = [...MAPPING_DOMAINS];
  const codeKeys = new Set(domains.map((d) => d.key));
  const skipped: string[] = [];
  for (const row of dynamicRows) {
    const parsed = parseDomainRow(row);
    if (!parsed) {
      skipped.push(String(row.key ?? "?"));
      continue;
    }
    if (codeKeys.has(parsed.key)) {
      skipped.push(parsed.key);
      continue;
    }
    codeKeys.add(parsed.key);
    domains.push(parsed);
  }
  return { domains, skipped };
}

/**
 * Registry efetivo da org: domínios em código + linhas de `mapping_domains`.
 * `db` pode ser o client do usuário (RLS entrega a org) OU service role —
 * por isso o `eq` de org é sempre explícito.
 */
export async function loadMappingDomains(
  db: SupabaseClient,
  orgId: string
): Promise<MappingDomain[]> {
  const { data, error } = await db
    .from("mapping_domains")
    .select("key, label, record_types, raw_field_key, raw_field_label, targets")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`mapping_domains: ${error.message}`);
  const { domains, skipped } = mergeDomains((data ?? []) as MappingDomainRow[]);
  if (skipped.length > 0) {
    console.warn(`[mappings] domínios dinâmicos ignorados: ${skipped.join(", ")}`);
  }
  return domains;
}

/** Domínios (da lista JÁ carregada) cujo record_type foi tocado. */
export function domainsForRecordType(
  domains: MappingDomain[],
  recordType: string
): MappingDomain[] {
  return domains.filter((d) => d.recordTypes.includes(recordType));
}
