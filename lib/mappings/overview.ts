// Versão: 1.0 | Data: 07/08/2026
// Loader da página /operacao/mapeamentos: entradas do de-para + PENDÊNCIAS
// (valores crus distintos sem entrada) por domínio. Roda com o client do
// USUÁRIO (RLS — a page é de admin via requireSettingsArea("mapeamentos")).
// A contagem varre os registros do domínio paginada, lendo SÓ o campo cru
// (custom_fields->>key) — volume atual ~4k linhas por base, tranquilo p/ RSC.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MAPPING_DOMAINS,
  buildMappingIndex,
  normalizeRawValue,
  type MappingDomain,
} from "./domains";

export interface MappingRow {
  id: string;
  rawValue: string;
  rawNorm: string;
  outputs: Record<string, string>;
}

export interface UnmappedValue {
  value: string;
  count: number;
}

export interface DomainOverview {
  key: string;
  label: string;
  rawFieldLabel: string;
  targets: { fieldKey: string; label: string }[];
  mappings: MappingRow[];
  unmapped: UnmappedValue[];
  /** Registros do domínio com o campo cru preenchido. */
  recordsWithValue: number;
}

const PAGE = 1000;

async function loadDomainMappings(
  db: SupabaseClient,
  orgId: string,
  domain: MappingDomain
): Promise<MappingRow[]> {
  const rows: MappingRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("value_mappings")
      .select("id, raw_value, raw_norm, outputs")
      .eq("organization_id", orgId)
      .eq("domain", domain.key)
      .order("raw_norm", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      rows.push({
        id: r.id as string,
        rawValue: r.raw_value as string,
        rawNorm: r.raw_norm as string,
        outputs: (r.outputs ?? {}) as Record<string, string>,
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function loadDomainUnmapped(
  db: SupabaseClient,
  orgId: string,
  domain: MappingDomain,
  mappings: MappingRow[]
): Promise<{ unmapped: UnmappedValue[]; recordsWithValue: number }> {
  const index = buildMappingIndex(
    mappings.map((m) => ({ rawNorm: m.rawNorm, outputs: m.outputs }))
  );
  const tally = new Map<string, { display: string; count: number }>();
  let recordsWithValue = 0;
  // String NÃO-literal de propósito: o parser de tipos do supabase-js não
  // entende o campo renomeado dinâmico (raw:custom_fields->>…).
  const selectRaw: string = `raw:custom_fields->>${domain.rawFieldKey}, is_mock`;
  for (const recordType of domain.recordTypes) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from("records")
        .select(selectRaw)
        .eq("organization_id", orgId)
        .eq("record_type", recordType)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as unknown as {
        raw: string | null;
        is_mock: boolean | null;
      }[]) {
        if (r.is_mock) continue;
        const norm = normalizeRawValue(r.raw);
        if (!norm) continue;
        recordsWithValue++;
        if (index.has(norm)) continue;
        const cur = tally.get(norm);
        if (cur) cur.count++;
        else tally.set(norm, { display: String(r.raw).trim(), count: 1 });
      }
      if (!data || data.length < PAGE) break;
    }
  }
  const unmapped = [...tally.values()]
    .map((t) => ({ value: t.display, count: t.count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "pt-BR"));
  return { unmapped, recordsWithValue };
}

export async function loadMappingOverview(
  db: SupabaseClient,
  orgId: string
): Promise<DomainOverview[]> {
  const out: DomainOverview[] = [];
  for (const domain of MAPPING_DOMAINS) {
    const mappings = await loadDomainMappings(db, orgId, domain);
    const { unmapped, recordsWithValue } = await loadDomainUnmapped(
      db,
      orgId,
      domain,
      mappings
    );
    out.push({
      key: domain.key,
      label: domain.label,
      rawFieldLabel: domain.rawFieldLabel,
      targets: domain.targets,
      mappings,
      unmapped,
      recordsWithValue,
    });
  }
  return out;
}
