// Versão: 1.0 | Data: 19/11/2026
// Ciclo de vida das linhas do ESQUEMA POR BASE vindas de uma ORIGEM que
// enumera os campos dela (Bitrix deal/lead, Processos Inteligentes) — fase 2.
//
// Quem CRIA a linha é o trigger da 0156 (todo escritor de field_definitions
// passa por ele). O que só o sync sabe é o que a origem DEIXOU de mandar:
// campo apagado no Bitrix vira `removed_at` (selo "Removido no Bitrix" na
// página da Base) — NUNCA exclusão: widgets e valores antigos seguem
// resolvendo. Campo que voltou limpa o `removed_at`; todo campo visto ganha
// `last_seen_at`.
//
// Best-effort: sem a tabela (0156 não aplicada) ou com erro, loga e segue —
// um esquema desatualizado é preferível a um sync parado. Lista vazia de
// presentes NÃO reconcilia (lookups hidratados sem o schema dariam a falsa
// impressão de que tudo sumiu).
import type { SupabaseClient } from "@supabase/supabase-js";

const CHUNK = 200;

export interface ReconcileOriginInput {
  sourceKey: string;
  origin: "bitrix" | "spa";
  /** `custom:<key>` que a origem enviou nesta rodada. */
  presentRefs: string[];
  /** Org explícita (caminho service role de Base SPA). */
  orgId?: string | null;
}

export interface ReconcileOriginResult {
  seen: number;
  removed: number;
}

/** Refs que deixaram de vir (puro). */
export function missingRefs(
  existing: readonly { field_ref: string }[],
  present: ReadonlySet<string>
): string[] {
  return existing.map((r) => r.field_ref).filter((ref) => !present.has(ref));
}

export async function reconcileOriginFields(
  db: SupabaseClient,
  input: ReconcileOriginInput
): Promise<ReconcileOriginResult | null> {
  const present = Array.from(new Set(input.presentRefs));
  if (!input.sourceKey || present.length === 0) return null;
  const now = new Date().toISOString();
  try {
    for (let i = 0; i < present.length; i += CHUNK) {
      let q = db
        .from("source_fields")
        .update({ last_seen_at: now, removed_at: null, updated_at: now })
        .eq("source_key", input.sourceKey);
      if (input.orgId) q = q.eq("organization_id", input.orgId);
      const { error } = await q.in("field_ref", present.slice(i, i + CHUNK));
      if (error) throw new Error(error.message);
    }

    let sel = db
      .from("source_fields")
      .select("field_ref")
      .eq("source_key", input.sourceKey)
      .eq("origin", input.origin);
    if (input.orgId) sel = sel.eq("organization_id", input.orgId);
    const { data, error } = await sel.is("removed_at", null);
    if (error) throw new Error(error.message);
    const gone = missingRefs(
      (data ?? []) as { field_ref: string }[],
      new Set(present)
    );
    for (let i = 0; i < gone.length; i += CHUNK) {
      let q = db
        .from("source_fields")
        .update({ removed_at: now, updated_at: now })
        .eq("source_key", input.sourceKey);
      if (input.orgId) q = q.eq("organization_id", input.orgId);
      const { error: upErr } = await q.in("field_ref", gone.slice(i, i + CHUNK));
      if (upErr) throw new Error(upErr.message);
    }
    return { seen: present.length, removed: gone.length };
  } catch (e) {
    console.error(
      `reconcileOriginFields(${input.sourceKey}): ${(e as Error).message}`
    );
    return null;
  }
}

export interface DeclaredOption {
  value: string;
  group?: string | null;
}

/**
 * Fases declaradas na origem para o `core:stage` de UMA Base (fase 3). Garante
 * a linha (rótulo padrão só se a Base ainda não tem um — o admin pode
 * renomear) e reescreve SÓ as options. Best-effort.
 */
export async function upsertCoreStageOptions(
  db: SupabaseClient,
  sourceKey: string,
  defaultLabel: string,
  options: DeclaredOption[],
  orgId?: string | null
): Promise<void> {
  if (!sourceKey || options.length === 0) return;
  const now = new Date().toISOString();
  try {
    const base = orgId ? { organization_id: orgId } : {};
    const { error: insErr } = await db.from("source_fields").upsert(
      {
        ...base,
        source_key: sourceKey,
        field_ref: "core:stage",
        origin: "core",
        label: defaultLabel,
      },
      { onConflict: "organization_id,source_key,field_ref", ignoreDuplicates: true }
    );
    if (insErr) throw new Error(insErr.message);
    let up = db
      .from("source_fields")
      .update({ options, last_seen_at: now, updated_at: now })
      .eq("source_key", sourceKey);
    if (orgId) up = up.eq("organization_id", orgId);
    const { error } = await up.eq("field_ref", "core:stage");
    if (error) throw new Error(error.message);
    let lab = db
      .from("source_fields")
      .update({ label: defaultLabel })
      .eq("source_key", sourceKey)
      .eq("field_ref", "core:stage");
    if (orgId) lab = lab.eq("organization_id", orgId);
    await lab.is("label", null);
  } catch (e) {
    console.error(`upsertCoreStageOptions(${sourceKey}): ${(e as Error).message}`);
  }
}

/** Key da Base raiz de um record_type (data_sources.record_type é único). */
export async function sourceKeyForRecordType(
  db: SupabaseClient,
  recordType: string
): Promise<string | null> {
  const { data, error } = await db
    .from("data_sources")
    .select("key")
    .eq("record_type", recordType)
    .maybeSingle();
  if (error || !data?.key) return null;
  return data.key as string;
}
