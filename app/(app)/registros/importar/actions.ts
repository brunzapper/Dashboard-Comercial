// Versão: 1.0 | Data: 16/07/2026
// Server Actions do wizard de import de CSV (Registros → Importar CSV).
// Fluxo: prepareImportFields (cria/reusa field_definitions com o client do
// USUÁRIO — RLS manage_field_definitions) → N× importCsvChunk (service role,
// como os adapters de sync — INSERT em records é admin-only na RLS) →
// finalizeCsvImport (auto-match + recálculo, UMA vez por import, best-effort
// como em app/api/sync/sheets/route.ts).
// Chamadas programáticas (não via <form>): validam sessão/papel e retornam
// { ok, message } em vez de redirecionar.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadSources } from "@/lib/config/sources";
import { slugify } from "@/lib/records/slug";
import { ingestRows } from "@/lib/import/ingest";
import { CORE_IMPORT_COLUMNS, type ColumnMapping } from "@/lib/import/csv";
import type { SyncResult } from "@/lib/sync/shared";
import { runAutoMatch } from "@/lib/records/matching-engine";
import { recalcAllFormulaFields } from "@/lib/records/recalc";

const MAX_CHUNK_ROWS = 500;
const IMPORT_FIELD_TYPES = new Set(["texto", "numero", "data"]);

async function ensureAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores podem importar dados." };
  }
  return { ok: true, userId: session.user.id };
}

// ============ Passo de preparação: campos ============

export interface PrepareFieldSpec {
  csvColumn: string;
  // Reusar um campo existente (field_key)…
  fieldKey?: string;
  // …ou criar um novo (label -> field_key slugificado).
  create?: { label: string; dataType: string };
}

export interface PrepareImportResult {
  ok: boolean;
  message?: string;
  // csvColumn -> field_key efetivo (criado ou reusado).
  fieldKeys?: Record<string, string>;
}

/** Cria/reusa as field_definitions do mapeamento e garante o applies_to da
 *  fonte (merge de array, padrão 0018). */
export async function prepareImportFields(
  sourceKey: string,
  specs: PrepareFieldSpec[]
): Promise<PrepareImportResult> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const source = sources.find((s) => s.key === sourceKey);
  if (!source) return { ok: false, message: `Fonte "${sourceKey}" não encontrada.` };
  const rt = source.recordType;

  const fieldKeys: Record<string, string> = {};
  for (const spec of specs) {
    let key = spec.fieldKey ?? "";
    if (spec.create) {
      if (!IMPORT_FIELD_TYPES.has(spec.create.dataType)) {
        return { ok: false, message: `Tipo inválido em "${spec.csvColumn}".` };
      }
      key = slugify(spec.create.label);
      if (!key) {
        return { ok: false, message: `Nome inválido para o campo de "${spec.csvColumn}".` };
      }
    }
    if (!key) continue;

    const { data: existing, error: selectError } = await supabase
      .from("field_definitions")
      .select("field_key, applies_to")
      .eq("field_key", key)
      .maybeSingle();
    if (selectError) {
      return { ok: false, message: `Falha ao consultar campos: ${selectError.message}` };
    }

    if (!existing) {
      if (!spec.create) {
        return { ok: false, message: `Campo "${key}" não existe mais.` };
      }
      const { error: insertError } = await supabase.from("field_definitions").insert({
        field_key: key,
        label: spec.create.label.trim().slice(0, 60),
        data_type: spec.create.dataType,
        options: [],
        visible_to_roles: ["admin", "gestor", "vendedor"],
        editable_by_roles: ["admin"],
        is_local: false,
        sort_order: 0,
        source_system: "csv",
        // Prefixo da fonte: o índice único (source_system, source_field_id) é
        // global — sem ele, o mesmo cabeçalho em fontes diferentes colidiria.
        source_field_id: `${sourceKey}:${key}`,
        show_in_builder: true,
        applies_to: [rt],
      });
      if (insertError) {
        return { ok: false, message: `Falha ao criar o campo "${key}": ${insertError.message}` };
      }
    } else {
      // Campo existente: garante a fonte no applies_to (vazio = todas, deixa).
      const appliesTo = (existing.applies_to as string[] | null) ?? [];
      if (appliesTo.length > 0 && !appliesTo.includes(rt)) {
        const { error: updateError } = await supabase
          .from("field_definitions")
          .update({ applies_to: [...appliesTo, rt] })
          .eq("field_key", key);
        if (updateError) {
          return { ok: false, message: `Falha ao atualizar o campo "${key}": ${updateError.message}` };
        }
      }
    }
    fieldKeys[spec.csvColumn] = key;
  }

  return { ok: true, fieldKeys };
}

// ============ Chunks de linhas ============

export interface ImportChunkPayload {
  sourceKey: string;
  mapping: ColumnMapping[];
  dedupColumns: string[];
  rows: Record<string, unknown>[];
}

export interface ImportChunkResult {
  ok: boolean;
  message?: string;
  result?: SyncResult;
}

export async function importCsvChunk(
  payload: ImportChunkPayload
): Promise<ImportChunkResult> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const { sourceKey, mapping, dedupColumns, rows } = payload;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, message: "Chunk vazio." };
  }
  if (rows.length > MAX_CHUNK_ROWS) {
    return { ok: false, message: `Máximo de ${MAX_CHUNK_ROWS} linhas por chunk.` };
  }
  // Whitelist dos alvos (nunca aceitar coluna core arbitrária do client).
  for (const m of mapping) {
    const valid =
      m.target === "ignore" ||
      m.target === "responsible" ||
      (m.target.startsWith("core:") &&
        CORE_IMPORT_COLUMNS.has(m.target.slice("core:".length))) ||
      (m.target.startsWith("custom:") && m.target.length > "custom:".length);
    if (!valid) return { ok: false, message: `Alvo inválido: ${m.target}` };
  }

  const db = createServiceClient();
  const sources = await loadSources(db);
  const source = sources.find((s) => s.key === sourceKey);
  if (!source) return { ok: false, message: `Fonte "${sourceKey}" não encontrada.` };

  const result = await ingestRows(
    db,
    {
      sourceKey: source.key,
      recordType: source.recordType,
      mapping,
      dedupColumns,
      userId: auth.userId,
    },
    rows
  );
  return { ok: true, result };
}

// ============ Finalização ============

export async function finalizeCsvImport(): Promise<{ ok: boolean; message?: string }> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const db = createServiceClient();
  // Best-effort (como no push da planilha): as linhas já foram persistidas.
  try {
    await runAutoMatch(db);
    await recalcAllFormulaFields();
  } catch {
    /* ignora: auto-match/recalc podem ser rodados depois em Campos. */
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
