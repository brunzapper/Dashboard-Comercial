// Versão: 1.0 | Data: 07/08/2026
// APLICAÇÃO dos mapeamentos de valores (de-para, 0117) — service role com org
// EXPLÍCITA em toda consulta (regra do repo: consulta service-role sem escopo
// vaza registro entre orgs). Os campos ALVO são ESPELHO DERIVADO do campo cru
// + tabela `value_mappings`: a escrita replica o padrão do executor de
// automações (executeFieldWrites, lib/kanban/automations/move.ts) — merge de
// custom_fields com carimbos field_modified_at[campo] + locally_modified_at
// (protege do reconcile/re-import), SEM audit/webhook (derivação, não edição),
// mock nunca recebe escrita, e UM recalcFormulaFieldsForRecords ao final.
// Idempotente: só grava DIFERENÇAS (rodar N vezes não reescreve nada).
// `maybeApplyMappingsAfterImport` é o gancho best-effort das caudas de
// import/ingestão — NUNCA lança (falha de mapeamento não derruba o import).
import type { SupabaseClient } from "@supabase/supabase-js";

import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import {
  MAPPING_DOMAINS,
  autoClassifyValues,
  buildMappingIndex,
  mappingDomainsForRecordType,
  normalizeRawValue,
  planMappingWrites,
  type MappingDomain,
  type MappingIndex,
  type MappingRecordRow,
} from "./domains";
import { syncUnmappedTasks, type UnmappedByDomain } from "./notify";

const PAGE = 500;
const WRITE_CHUNK = 50;

export interface ApplyMappingsResult {
  /** Registros efetivamente alterados (todas as gravações somadas). */
  changedRecords: number;
  /** Entradas criadas pelo classificador heurístico (origin='auto'). */
  autoMapped: number;
  /** Pendências por domínio: valor cru → nº de registros. */
  unmapped: UnmappedByDomain;
  errors: string[];
}

/**
 * Garante os field_definitions ALVO dos domínios (locais, texto) — ensure-if-
 * absent, nunca sobrescreve campo existente (mesmo padrão de
 * ensurePresetFields). `applies_to` = record_types do domínio.
 */
export async function ensureMappingFields(
  db: SupabaseClient,
  orgId: string
): Promise<void> {
  const { data } = await db
    .from("field_definitions")
    .select("field_key")
    .eq("organization_id", orgId);
  const have = new Set((data ?? []).map((f) => f.field_key as string));
  const rows: Record<string, unknown>[] = [];
  for (const domain of MAPPING_DOMAINS) {
    for (const target of domain.targets) {
      if (have.has(target.fieldKey)) continue;
      have.add(target.fieldKey);
      rows.push({
        organization_id: orgId,
        field_key: target.fieldKey,
        label: target.label,
        data_type: "texto",
        options: [],
        visible_to_roles: [],
        editable_by_roles: [],
        is_local: true,
        show_in_builder: true,
        sort_order: 200,
        applies_to: domain.recordTypes,
      });
    }
  }
  if (rows.length === 0) return;
  const { error } = await db.from("field_definitions").insert(rows);
  if (error) throw new Error(`ensureMappingFields: ${error.message}`);
}

/** Índice de entradas do de-para de um domínio (org explícita). */
async function loadMappingIndex(
  db: SupabaseClient,
  orgId: string,
  domainKey: string
) {
  const entries: { rawNorm: string; outputs: Record<string, unknown> }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("value_mappings")
      .select("raw_norm, outputs")
      .eq("organization_id", orgId)
      .eq("domain", domainKey)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`value_mappings (${domainKey}): ${error.message}`);
    for (const r of data ?? [])
      entries.push({
        rawNorm: r.raw_norm as string,
        outputs: (r.outputs ?? {}) as Record<string, unknown>,
      });
    if (!data || data.length < 1000) break;
  }
  return buildMappingIndex(entries);
}

/**
 * Varredura LEVE dos valores crus distintos do domínio (só o campo cru, sem
 * custom_fields inteiro) — insumo da auto-classificação. norm → 1ª forma
 * vista (exibição).
 */
async function collectRawValues(
  db: SupabaseClient,
  orgId: string,
  domain: MappingDomain
): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  // String NÃO-literal de propósito (parser de tipos do supabase-js não
  // entende o campo renomeado dinâmico).
  const selectRaw: string = `raw:custom_fields->>${domain.rawFieldKey}, is_mock`;
  for (const recordType of domain.recordTypes) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("records")
        .select(selectRaw)
        .eq("organization_id", orgId)
        .eq("record_type", recordType)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`records (${recordType}): ${error.message}`);
      for (const r of (data ?? []) as unknown as {
        raw: string | null;
        is_mock: boolean | null;
      }[]) {
        if (r.is_mock) continue;
        const norm = normalizeRawValue(r.raw);
        if (!norm || seen.has(norm)) continue;
        seen.set(norm, String(r.raw).trim());
      }
      if (!data || data.length < 1000) break;
    }
  }
  return seen;
}

/**
 * Auto-atribuição (comportamento do Apps Script antigo): valores sem entrada
 * passam pelo sugestor EFETIVO do domínio (classificador específico +
 * banco de palavras APRENDIDO das entradas atuais — retroalimentado a cada
 * correção); os classificáveis viram entradas `origin='auto'` (upsert
 * ignoreDuplicates — nunca sobrescreve manual/seed/IA) e entram no índice
 * desta rodada. Devolve o nº de entradas criadas.
 */
async function autoClassifyDomain(
  db: SupabaseClient,
  orgId: string,
  domain: MappingDomain,
  index: MappingIndex,
  result: ApplyMappingsResult
): Promise<number> {
  const seen = await collectRawValues(db, orgId, domain);
  const missing = [...seen.entries()]
    .filter(([norm]) => !index.has(norm))
    .map(([norm, display]) => ({ norm, display }));
  if (missing.length === 0) return 0;
  const entries = autoClassifyValues(domain, missing, index);
  if (entries.length === 0) return 0;
  for (let i = 0; i < entries.length; i += 500) {
    const slice = entries.slice(i, i + 500);
    const { error } = await db.from("value_mappings").upsert(
      slice.map((e) => ({
        organization_id: orgId,
        domain: domain.key,
        raw_value: e.rawValue,
        raw_norm: e.rawNorm,
        outputs: e.outputs,
        origin: "auto",
      })),
      { onConflict: "organization_id,domain,raw_norm", ignoreDuplicates: true }
    );
    if (error) {
      result.errors.push(`auto-classificação (${domain.key}): ${error.message}`);
      return 0;
    }
  }
  for (const e of entries) index.set(e.rawNorm, e.outputs);
  return entries.length;
}

async function applyDomain(
  db: SupabaseClient,
  orgId: string,
  domain: MappingDomain,
  result: ApplyMappingsResult
): Promise<string[]> {
  const index = await loadMappingIndex(db, orgId, domain.key);
  result.autoMapped += await autoClassifyDomain(db, orgId, domain, index, result);
  const now = new Date().toISOString();
  const changedIds: string[] = [];
  const unmappedTally = new Map<string, number>();

  for (const recordType of domain.recordTypes) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from("records")
        .select("id, is_mock, custom_fields, field_modified_at")
        .eq("organization_id", orgId)
        .eq("record_type", recordType)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`records (${recordType}): ${error.message}`);
      const rows = (data ?? []) as (MappingRecordRow & {
        field_modified_at: Record<string, string> | null;
      })[];
      const plan = planMappingWrites(domain, rows, index);
      for (const [value, count] of plan.unmapped)
        unmappedTally.set(value, (unmappedTally.get(value) ?? 0) + count);

      const byId = new Map(rows.map((r) => [r.id, r]));
      for (let i = 0; i < plan.writes.length; i += WRITE_CHUNK) {
        const slice = plan.writes.slice(i, i + WRITE_CHUNK);
        const outcomes = await Promise.all(
          slice.map(async (w) => {
            const fresh = byId.get(w.recordId);
            if (!fresh) return null;
            const custom = { ...(fresh.custom_fields ?? {}), ...w.changes };
            const fmod = { ...(fresh.field_modified_at ?? {}) };
            for (const key of Object.keys(w.changes)) fmod[key] = now;
            const { error: upErr } = await db
              .from("records")
              .update({
                custom_fields: custom,
                field_modified_at: fmod,
                locally_modified_at: now,
              })
              .eq("id", w.recordId)
              .eq("organization_id", orgId);
            if (upErr) {
              result.errors.push(`${domain.key}/${w.recordId}: ${upErr.message}`);
              return null;
            }
            return w.recordId;
          })
        );
        for (const id of outcomes) if (id) changedIds.push(id);
      }
      if (rows.length < PAGE) break;
    }
  }

  if (unmappedTally.size > 0) result.unmapped[domain.key] = unmappedTally;
  result.changedRecords += changedIds.length;
  return changedIds;
}

/**
 * Aplica os mapeamentos dos domínios pedidos (default: todos) aos registros da
 * org. Garante os campos alvo, grava só diferenças e devolve as pendências.
 * NÃO notifica — o chamador decide (gancho usa maybeApplyMappingsAfterImport;
 * a action da página chama syncUnmappedTasks explicitamente).
 */
export async function applyValueMappings(
  db: SupabaseClient,
  orgId: string,
  domainKeys?: string[]
): Promise<ApplyMappingsResult> {
  const result: ApplyMappingsResult = {
    changedRecords: 0,
    autoMapped: 0,
    unmapped: {},
    errors: [],
  };
  const domains = MAPPING_DOMAINS.filter(
    (d) => !domainKeys || domainKeys.includes(d.key)
  );
  if (domains.length === 0) return result;
  await ensureMappingFields(db, orgId);

  const changedIds: string[] = [];
  for (const domain of domains) {
    changedIds.push(...(await applyDomain(db, orgId, domain, result)));
  }
  if (changedIds.length > 0) {
    try {
      await recalcFormulaFieldsForRecords(changedIds);
    } catch (e) {
      result.errors.push(`recalc: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

/**
 * Gancho best-effort das caudas de import CSV / API de ingestão: se o
 * record_type importado pertence a algum domínio, aplica os mapeamentos e
 * sincroniza as tarefas de pendência. Nunca lança.
 */
export async function maybeApplyMappingsAfterImport(
  db: SupabaseClient,
  orgId: string | null,
  recordType: string
): Promise<void> {
  try {
    if (!orgId) return;
    const domains = mappingDomainsForRecordType(recordType);
    if (domains.length === 0) return;
    const res = await applyValueMappings(
      db,
      orgId,
      domains.map((d) => d.key)
    );
    await syncUnmappedTasks(db, orgId, res.unmapped, domains.map((d) => d.key));
    if (res.errors.length > 0) {
      console.warn("[mappings] aplicação pós-import com erros:", res.errors.slice(0, 3));
    }
  } catch (e) {
    console.warn("[mappings] aplicação pós-import falhou:", e);
  }
}
