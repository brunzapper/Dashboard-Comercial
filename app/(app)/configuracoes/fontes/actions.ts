// Versão: 2.0 | Data: 16/07/2026
// Server Actions da tela Configurações → Fontes.
// v2.0 (16/07/2026): fontes DINÂMICAS — CRUD do catálogo data_sources (0060):
//   criar fonte (key slugificada do nome; record_type = key), editar
//   nome/nome curto/campo de período, excluir fonte sem registros (FK
//   records.record_type -> data_sources restringe). Escrita com o client do
//   usuário — RLS exige manage_field_definitions (admin).
//   saveSourceLabels agora grava só o rótulo "geral" em sync_config (nomes
//   curtos por fonte são canônicos em data_sources.short_label).
"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/records/slug";
import { SOURCE_LABELS_CONFIG_KEY } from "@/lib/config/source-labels";

export interface SourceLabelsActionState {
  ok?: boolean;
  message?: string;
}

export interface SourceActionState {
  ok?: boolean;
  message?: string;
}

// Campos de data aceitos pela barra de período (CHECK da 0060).
const PERIOD_FIELDS = new Set([
  "closed_at",
  "opened_at",
  "source_created_at",
  "source_modified_at",
  "created_at",
  "updated_at",
]);

// Keys que não podem virar fonte: rótulo reservado dos campos gerais e
// palavras que colidiriam com semânticas internas.
const RESERVED_KEYS = new Set(["geral", "gerais", "records", "todas"]);

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

function cleanText(v: FormDataEntryValue | null, max: number): string {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

function readSourceForm(formData: FormData): {
  label: string;
  shortLabel: string;
  periodField: string;
  error?: string;
} {
  const label = cleanText(formData.get("label"), 60);
  const shortLabel = cleanText(formData.get("short_label"), 40);
  const periodField = cleanText(formData.get("default_period_field"), 40);
  if (label.length < 2) {
    return { label, shortLabel, periodField, error: "Informe o nome da fonte." };
  }
  if (!PERIOD_FIELDS.has(periodField)) {
    return { label, shortLabel, periodField, error: "Campo de período inválido." };
  }
  return { label, shortLabel, periodField };
}

export async function createSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireRole("admin");
  const { label, shortLabel, periodField, error } = readSourceForm(formData);
  if (error) return { ok: false, message: error };

  const key = slugify(label).slice(0, 40);
  if (!KEY_RE.test(key) || RESERVED_KEYS.has(key)) {
    return {
      ok: false,
      message:
        "Nome inválido para gerar a chave da fonte: comece com uma letra e use ao menos 2 caracteres.",
    };
  }

  const supabase = await createClient();
  // Colisão com key OU record_type existentes (ex.: fonte "Lead" colidiria
  // com o record_type 'lead' do builtin leads).
  const { data: existing } = await supabase
    .from("data_sources")
    .select("key")
    .or(`key.eq.${key},record_type.eq.${key}`)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, message: `Já existe uma fonte com a chave "${key}".` };
  }

  const { error: insertError } = await supabase.from("data_sources").insert({
    key,
    record_type: key, // fontes novas: mapeamento identidade
    label,
    short_label: shortLabel || label,
    default_period_field: periodField,
    builtin: false,
  });
  if (insertError) {
    return { ok: false, message: `Falha ao criar: ${insertError.message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Fonte "${label}" criada (chave: ${key}).` };
}

export async function updateSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireRole("admin");
  const key = cleanText(formData.get("key"), 40);
  const { label, shortLabel, periodField, error } = readSourceForm(formData);
  if (error) return { ok: false, message: error };

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("data_sources")
    .update({
      label,
      short_label: shortLabel || label,
      default_period_field: periodField,
    })
    .eq("key", key);
  if (updateError) {
    return { ok: false, message: `Falha ao salvar: ${updateError.message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Fonte atualizada." };
}

export async function deleteSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireRole("admin");
  const key = cleanText(formData.get("key"), 40);
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("data_sources")
    .select("key, record_type, builtin")
    .eq("key", key)
    .maybeSingle();
  if (!row) return { ok: false, message: "Fonte não encontrada." };
  if (row.builtin) {
    return { ok: false, message: "Fontes internas não podem ser excluídas." };
  }

  const { count } = await supabase
    .from("records")
    .select("id", { count: "exact", head: true })
    .eq("record_type", row.record_type as string);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `A fonte tem ${count} registro(s). Exclua os registros antes de excluir a fonte.`,
    };
  }

  const { error: deleteError } = await supabase
    .from("data_sources")
    .delete()
    .eq("key", key);
  if (deleteError) {
    // 23503 = FK (registros criados entre a contagem e o delete).
    return { ok: false, message: `Falha ao excluir: ${deleteError.message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Fonte excluída." };
}

/** Grava o rótulo dos campos "gerais" (sync_config; nomes curtos por fonte
 *  agora são editados na própria fonte e vivem em data_sources). Preserva
 *  chaves legadas já salvas no valor. */
export async function saveSourceLabels(
  _prev: SourceLabelsActionState,
  formData: FormData
): Promise<SourceLabelsActionState> {
  await requireRole("admin");
  const geral = cleanText(formData.get("geral"), 40);
  if (!geral) return { ok: false, message: "Informe o rótulo." };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("sync_config")
    .select("value")
    .eq("key", SOURCE_LABELS_CONFIG_KEY)
    .maybeSingle();
  const value = {
    ...((current?.value ?? {}) as Record<string, unknown>),
    geral,
  };
  const { error } = await supabase
    .from("sync_config")
    .upsert({ key: SOURCE_LABELS_CONFIG_KEY, value }, { onConflict: "key" });
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  // Os rótulos entram via provider do layout raiz → revalida o app inteiro.
  revalidatePath("/", "layout");
  return { ok: true, message: "Rótulo salvo." };
}
