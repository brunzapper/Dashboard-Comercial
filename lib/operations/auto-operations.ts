// Versão: 1.0 | Data: 26/07/2026
// Parcerias (fase B): SUB-OPERAÇÕES AUTOMÁTICAS por registro de uma base
// (0106). Para cada registro válido da base configurada (ex.: Parceiros),
// garante uma sub-operação sob a operação-pai com perfil gerado
// `[{ field: target_field, op: profile_op, value: <value_field do registro>,
// sources: target_sources }]` — o perfil de uma sub-operação automática é
// PROPRIEDADE do gerador (o admin customiza a CONFIG, não o perfil; edição
// manual do perfil é sobrescrita na próxima rodada).
// Identidade: operations.auto_source_record_id (rename do parceiro renomeia a
// MESMA operação; registro sumiu/ficou sem identificador → active=false —
// NUNCA delete: goals/vínculos/snapshots podem referenciar; reaparecendo,
// reativa). Operação homônima do MESMO pai sem vínculo é ADOTADA por nome
// normalizado (normalizeName), como o seed 0053.
// Roda com service role (RLS de operations é admin-only): os ganchos de
// ingestão (CSV/API/criação manual) e o botão da tela de Fontes chamam com o
// carimbo EXPLÍCITO de organization_id da config (invariante multi-org).
// Idempotente; erro individual não derruba o lote.
import type { SupabaseClient } from "@supabase/supabase-js";

import { refValue, type MatchableRecord } from "@/lib/matching";
import { normalizeName } from "@/lib/sync/shared";
import type { WidgetFilter } from "@/lib/widgets/types";

export interface AutoOperationsConfig {
  source_key: string;
  parent_operation_id: string;
  name_field: string;
  value_field: string;
  target_field: string;
  target_sources: string[];
  profile_op: "eq" | "eq_ci";
  enabled: boolean;
  organization_id: string;
}

export interface AutoOperationsResult {
  configured: boolean;
  created: number;
  renamed: number;
  adopted: number;
  reactivated: number;
  deactivated: number;
  /** Registros sem nome ou sem identificador (não geram operação). */
  skipped: number;
}

const EMPTY: AutoOperationsResult = {
  configured: false,
  created: 0,
  renamed: 0,
  adopted: 0,
  reactivated: 0,
  deactivated: 0,
  skipped: 0,
};

interface ChildOp {
  id: string;
  name: string;
  active: boolean;
  filter: unknown;
  auto_source_record_id: string | null;
}

function buildProfile(
  cfg: AutoOperationsConfig,
  value: string
): WidgetFilter[] {
  return [
    {
      field: cfg.target_field,
      op: cfg.profile_op,
      value,
      ...(cfg.target_sources.length > 0
        ? { sources: cfg.target_sources as WidgetFilter["sources"] }
        : {}),
    },
  ];
}

function asText(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

async function loadSourceRecords(
  db: SupabaseClient,
  recordType: string
): Promise<MatchableRecord[]> {
  const BATCH = 1000;
  const all: MatchableRecord[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db
      .from("records")
      .select("id, record_type, title, custom_fields")
      .eq("record_type", recordType)
      .eq("is_mock", false)
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as unknown as MatchableRecord[];
    if (chunk.length === 0) break;
    all.push(...chunk);
    from += chunk.length;
  }
  return all;
}

/**
 * Garante as sub-operações da base `sourceKey` conforme a config (0106).
 * `db` DEVE ser o service client (escrita em operations é admin-only na RLS).
 */
export async function ensureAutoOperationsForSource(
  db: SupabaseClient,
  sourceKey: string
): Promise<AutoOperationsResult> {
  const { data: cfgRow } = await db
    .from("source_auto_operations")
    .select(
      "source_key, parent_operation_id, name_field, value_field, target_field, target_sources, profile_op, enabled, organization_id"
    )
    .eq("source_key", sourceKey)
    .maybeSingle();
  const cfg = cfgRow as AutoOperationsConfig | null;
  if (!cfg || !cfg.enabled) return { ...EMPTY };

  // record_type da base (fontes dinâmicas: key === record_type; builtins não).
  const { data: src } = await db
    .from("data_sources")
    .select("record_type")
    .eq("key", sourceKey)
    .maybeSingle();
  const recordType = (src?.record_type as string | undefined) ?? null;
  if (!recordType) return { ...EMPTY };

  // Pai precisa existir (FK derruba a config junto, mas a rodada pode correr
  // concorrente a um delete).
  const { data: parent } = await db
    .from("operations")
    .select("id")
    .eq("id", cfg.parent_operation_id)
    .maybeSingle();
  if (!parent) return { ...EMPTY };

  const records = await loadSourceRecords(db, recordType);

  const { data: childrenData } = await db
    .from("operations")
    .select("id, name, active, filter, auto_source_record_id")
    .eq("parent_operation_id", cfg.parent_operation_id);
  const children = (childrenData ?? []) as ChildOp[];
  const byRecordId = new Map<string, ChildOp>();
  const unlinkedByName = new Map<string, ChildOp>();
  for (const c of children) {
    if (c.auto_source_record_id) byRecordId.set(c.auto_source_record_id, c);
    else {
      const key = normalizeName(c.name);
      if (key && !unlinkedByName.has(key)) unlinkedByName.set(key, c);
    }
  }

  const result: AutoOperationsResult = { ...EMPTY, configured: true };
  const liveOpIds = new Set<string>();

  for (const rec of records) {
    try {
      const name = asText(refValue(rec, cfg.name_field));
      const value = asText(refValue(rec, cfg.value_field));
      if (!name || !value) {
        result.skipped += 1;
        continue;
      }
      const filter = buildProfile(cfg, value);

      const linked = byRecordId.get(rec.id);
      if (linked) {
        liveOpIds.add(linked.id);
        const needsPatch =
          linked.name !== name ||
          !linked.active ||
          JSON.stringify(linked.filter ?? []) !== JSON.stringify(filter);
        if (needsPatch) {
          const { error } = await db
            .from("operations")
            .update({ name, active: true, filter })
            .eq("id", linked.id);
          if (error) throw new Error(error.message);
          if (linked.name !== name) result.renamed += 1;
          if (!linked.active) result.reactivated += 1;
        }
        continue;
      }

      const homonym = unlinkedByName.get(normalizeName(name) ?? "");
      if (homonym) {
        const { error } = await db
          .from("operations")
          .update({
            auto_source_record_id: rec.id,
            name,
            active: true,
            filter,
          })
          .eq("id", homonym.id);
        if (error) throw new Error(error.message);
        unlinkedByName.delete(normalizeName(name) ?? "");
        byRecordId.set(rec.id, { ...homonym, auto_source_record_id: rec.id });
        liveOpIds.add(homonym.id);
        result.adopted += 1;
        continue;
      }

      const { data: inserted, error } = await db
        .from("operations")
        .insert({
          name,
          parent_operation_id: cfg.parent_operation_id,
          // Carimbo EXPLÍCITO de org: service role bypassa RLS — sem isso a
          // linha cairia na org default (invariante multi-org).
          organization_id: cfg.organization_id,
          auto_source_record_id: rec.id,
          filter,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      if (inserted?.id) liveOpIds.add(inserted.id as string);
      result.created += 1;
    } catch (e) {
      console.warn(
        `[auto-operations] registro ${rec.id} da base ${sourceKey} falhou:`,
        (e as Error).message
      );
    }
  }

  // Sub-operações GERADAS cujo registro sumiu (ou perdeu o identificador):
  // inativa — nunca exclui.
  for (const c of children) {
    if (!c.auto_source_record_id || liveOpIds.has(c.id) || !c.active) continue;
    try {
      const { error } = await db
        .from("operations")
        .update({ active: false })
        .eq("id", c.id);
      if (error) throw new Error(error.message);
      result.deactivated += 1;
    } catch (e) {
      console.warn(
        `[auto-operations] inativação de ${c.id} falhou:`,
        (e as Error).message
      );
    }
  }

  return result;
}

/**
 * Gancho da criação/edição MANUAL de registros: resolve a base do record_type
 * e roda o ensure só quando há config habilitada (2 selects baratos no caminho
 * sem config). `db` = service client.
 */
export async function ensureAutoOperationsForRecordType(
  db: SupabaseClient,
  recordType: string
): Promise<void> {
  const { data } = await db
    .from("data_sources")
    .select("key")
    .eq("record_type", recordType)
    .maybeSingle();
  const key = (data?.key as string | undefined) ?? null;
  if (!key) return;
  const { data: cfg } = await db
    .from("source_auto_operations")
    .select("source_key")
    .eq("source_key", key)
    .eq("enabled", true)
    .maybeSingle();
  if (!cfg) return;
  await ensureAutoOperationsForSource(db, key);
}

/** Roda o ensure de TODAS as configs habilitadas (gancho do import CSV). */
export async function ensureAllAutoOperations(
  db: SupabaseClient
): Promise<void> {
  const { data } = await db
    .from("source_auto_operations")
    .select("source_key")
    .eq("enabled", true);
  for (const row of data ?? []) {
    try {
      await ensureAutoOperationsForSource(db, row.source_key as string);
    } catch (e) {
      console.warn(
        `[auto-operations] base ${row.source_key} falhou:`,
        (e as Error).message
      );
    }
  }
}
