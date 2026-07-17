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
import {
  CORE_IMPORT_COLUMNS,
  isValidMatchTarget,
  type ColumnMapping,
  type MatchConfig,
} from "@/lib/import/csv";
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

  // 1) Resolve/valida as chaves (puro, sem I/O).
  const keyed: { spec: (typeof specs)[number]; key: string }[] = [];
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
    if (key) keyed.push({ spec, key });
  }
  const fieldKeys: Record<string, string> = {};
  if (keyed.length === 0) return { ok: true, fieldKeys };

  // 2) UMA consulta para todas as chaves (antes: 1 SELECT por coluna, em série).
  const allKeys = [...new Set(keyed.map((k) => k.key))];
  const { data: existingRows, error: selectError } = await supabase
    .from("field_definitions")
    .select("field_key, applies_to")
    .in("field_key", allKeys);
  if (selectError) {
    return { ok: false, message: `Falha ao consultar campos: ${selectError.message}` };
  }
  const existingByKey = new Map(
    (existingRows ?? []).map((r) => [r.field_key as string, r])
  );

  // 3) Campos novos: UM insert em lote (dedupe — duas colunas podem gerar a
  // mesma chave; a primeira vence, como no fluxo por coluna).
  const inserts: Record<string, unknown>[] = [];
  const inserting = new Set<string>();
  for (const { spec, key } of keyed) {
    if (existingByKey.has(key) || inserting.has(key)) continue;
    if (!spec.create) {
      return { ok: false, message: `Campo "${key}" não existe mais.` };
    }
    inserting.add(key);
    inserts.push({
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
  }
  if (inserts.length > 0) {
    const { error: insertError } = await supabase
      .from("field_definitions")
      .insert(inserts);
    if (insertError) {
      return { ok: false, message: `Falha ao criar campos: ${insertError.message}` };
    }
  }

  // 4) Campos existentes: garante a fonte no applies_to (vazio = todas, deixa)
  // — só onde falta, em paralelo.
  const updates = [...existingByKey.entries()]
    .filter(([, existing]) => {
      const appliesTo = (existing.applies_to as string[] | null) ?? [];
      return appliesTo.length > 0 && !appliesTo.includes(rt);
    })
    .map(([key, existing]) => {
      const appliesTo = (existing.applies_to as string[] | null) ?? [];
      return supabase
        .from("field_definitions")
        .update({ applies_to: [...appliesTo, rt] })
        .eq("field_key", key);
    });
  if (updates.length > 0) {
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      return { ok: false, message: `Falha ao atualizar campos: ${failed.error.message}` };
    }
  }

  for (const { spec, key } of keyed) fieldKeys[spec.csvColumn] = key;
  return { ok: true, fieldKeys };
}

// ============ Chunks de linhas ============

export interface ImportChunkPayload {
  sourceKey: string;
  mapping: ColumnMapping[];
  dedupColumns: string[];
  // Modo "match por coluna" (upsert em fonte existente) — ver lib/import/csv.ts.
  match?: MatchConfig;
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

  const { sourceKey, mapping, dedupColumns, match, rows } = payload;
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

  // Modo match: valida o alvo, os checkboxes e o write-back no servidor (a UI
  // também valida, mas o payload vem do client).
  if (match) {
    if (!match.insertNew && !match.updateExisting) {
      return {
        ok: false,
        message:
          'Marque ao menos um entre "Incluir novos" e "Atualizar existentes".',
      };
    }
    if (!isValidMatchTarget(match.targetField)) {
      return { ok: false, message: `Campo de match inválido: ${match.targetField}` };
    }
    if (match.targetField.startsWith("custom:")) {
      const key = match.targetField.slice("custom:".length);
      const { data: def } = await db
        .from("field_definitions")
        .select("field_key")
        .eq("field_key", key)
        .maybeSingle();
      if (!def) {
        return { ok: false, message: `Campo de match "${key}" não existe.` };
      }
    }
    if (
      match.writeBack &&
      !(source.builtin && (source.recordType === "lead" || source.recordType === "negocio"))
    ) {
      return {
        ok: false,
        message:
          source.recordType === "venda_site"
            ? "Write-back indisponível: a integração da planilha é somente de entrada."
            : "Write-back só está disponível para as fontes sincronizadas do Bitrix (Leads e Negócios).",
      };
    }
  }

  const result = await ingestRows(
    db,
    {
      sourceKey: source.key,
      recordType: source.recordType,
      mapping,
      dedupColumns,
      match,
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
  // Dados de REGISTROS não afetam os providers do layout raiz (fontes/rótulos):
  // revalida só as superfícies que exibem registros, em vez de "/" + layout
  // (que derrubava o app inteiro do cache a cada import).
  revalidatePath("/registros");
  revalidatePath("/dashboards/[id]", "page");
  revalidatePath("/kanbans/[id]", "page");
  return { ok: true };
}
