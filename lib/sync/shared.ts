// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — SyncResult ganha quebra por entidade (byEntity) e
//   amostras de erro (errorSamples); helpers recordOutcome/recordError param de
//   engolir a mensagem do erro — o painel de Sync mostra leads vs deals e o que
//   falhou, para diagnosticar "só leads importando".
// Utilidades comuns a QUALQUER fonte de sync (Bitrix, Sheets, ...): resultado
// padrão, conflito por campo (edição manual protege contra sobrescrita) e
// resolução de operação primária de um responsável. Extraído de
// lib/sync/bitrix/sync.ts para evitar duplicar a regra entre fontes.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface EntityCounts {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  // Quebra por entidade (ex.: 'lead', 'negocio', 'venda_site').
  byEntity: Record<string, EntityCounts>;
  // Primeiras mensagens de erro (para diagnóstico no painel de Sync).
  errorSamples: string[];
  // Contadores do import em modo "match por coluna" (lib/import/ingest.ts) —
  // ausentes fora dele. Todos também contam em skipped/errors acima.
  noMatch?: number; // sem match e "Incluir novos" desmarcado → rejeitada
  alreadyExists?: number; // com match e "Atualizar existentes" desmarcado
  ambiguous?: number; // valor casa 2+ registros → erro
}

const MAX_ERROR_SAMPLES = 10;

export function emptyResult(): SyncResult {
  return { inserted: 0, updated: 0, skipped: 0, errors: 0, byEntity: {}, errorSamples: [] };
}

function entityCounts(result: SyncResult, entity: string): EntityCounts {
  return (result.byEntity[entity] ??= {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  });
}

/** Contabiliza um insert/update/skip por entidade + no total. */
export function recordOutcome(
  result: SyncResult,
  entity: string,
  outcome: "inserted" | "updated" | "skipped"
): void {
  result[outcome] += 1;
  entityCounts(result, entity)[outcome] += 1;
}

/** Contabiliza um erro por entidade + no total, guardando a mensagem. */
export function recordError(
  result: SyncResult,
  entity: string,
  message: string
): void {
  result.errors += 1;
  entityCounts(result, entity).errors += 1;
  if (result.errorSamples.length < MAX_ERROR_SAMPLES) {
    result.errorSamples.push(`[${entity}] ${message}`);
  }
}

export interface ExistingRecord {
  id: string;
  custom_fields: Record<string, unknown> | null;
  field_modified_at: Record<string, string> | null;
  last_synced_at: string | null;
  responsible_id: string | null;
  operation_id: string | null;
  related_lead_id: string | null;
  [key: string]: unknown;
}

/** Campo protegido = editado manualmente DEPOIS do último sync. */
export function isProtected(field: string, existing: ExistingRecord): boolean {
  const ts = existing.field_modified_at?.[field];
  if (!ts) return false;
  if (!existing.last_synced_at) return true;
  return new Date(ts) > new Date(existing.last_synced_at);
}

export function valuesDiffer(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) !== Number(b);
  }
  return String(a ?? "") !== String(b ?? "");
}

/** Operação de prioridade 1 (primária) de um responsável, se houver. */
export async function primaryOperationId(
  db: SupabaseClient,
  responsibleId: string | null
): Promise<string | null> {
  if (!responsibleId) return null;
  const { data } = await db
    .from("responsible_operations")
    .select("operation_id")
    .eq("responsible_id", responsibleId)
    .eq("priority", 1)
    .maybeSingle();
  return (data?.operation_id as string | undefined) ?? null;
}

export function leadTimeDays(
  refDate: string | null,
  leadCreated: string | null
): number | null {
  if (!refDate || !leadCreated) return null;
  const ref = new Date(refDate).getTime();
  const created = new Date(leadCreated).getTime();
  if (Number.isNaN(ref) || Number.isNaN(created)) return null;
  return Math.round((ref - created) / 86400000);
}

export function normalizeName(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}
