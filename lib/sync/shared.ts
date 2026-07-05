// Versão: 1.0 | Data: 05/07/2026
// Utilidades comuns a QUALQUER fonte de sync (Bitrix, Sheets, ...): resultado
// padrão, conflito por campo (edição manual protege contra sobrescrita) e
// resolução de operação primária de um responsável. Extraído de
// lib/sync/bitrix/sync.ts para evitar duplicar a regra entre fontes.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

export function emptyResult(): SyncResult {
  return { inserted: 0, updated: 0, skipped: 0, errors: 0 };
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
