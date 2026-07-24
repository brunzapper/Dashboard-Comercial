// Versão: 2.3 | Data: 19/07/2026
// v2.3 (19/07/2026): timezone (0079) — fuso da ORIGEM da fonte (IANA), validado
//   com Intl; vazio = sem conversão. Datetimes ingeridos normalizam p/ Brasília.
// v2.2 (19/07/2026): SUB-FONTES (0078) — CRUD de `sub_sources` (fonte derivada
//   de uma pai, recortada por um filtro). createSubSource/updateSubSource/
//   deleteSubSource; o predicado chega como JSON (WidgetFilter[]) e é saneado.
// v2.1 (16/07/2026): manual_entry (0061) — flag "Permite criação manual" por
//   fonte (criar/editar).
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

import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/records/slug";
import { SOURCE_LABELS_CONFIG_KEY } from "@/lib/config/source-labels";
import type { WidgetFilter } from "@/lib/widgets/types";

// Guard de escrita da área Fontes: papel admin (como sempre) + o override
// individual `deny` da área, que agora barra também a escrita (não só a page).
async function requireFontesWrite(): Promise<void> {
  await requireRole("admin");
  if (await isSettingsAreaDenied("fontes")) redirect("/");
}

// Operadores aceitos no predicado de uma sub-fonte (subconjunto de FilterOp com
// tradução no RPC e no modo lista).
const SUB_FILTER_OPS = new Set([
  "eq",
  "neq",
  "in",
  "ilike",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_null",
  "not_null",
]);

// Saneia o predicado (JSON do form) para WidgetFilter[]: mantém só condições com
// field não-vazio e op reconhecido. Ops sem valor (is_null/not_null) não exigem
// value. Nunca aceita `sources`/`record_types` (o scope é aplicado no engine).
function parseSubFilter(raw: FormDataEntryValue | null): WidgetFilter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? "[]"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: WidgetFilter[] = [];
  for (const c of parsed) {
    if (!c || typeof c !== "object") continue;
    const field = String((c as { field?: unknown }).field ?? "").trim();
    const op = String((c as { op?: unknown }).op ?? "").trim();
    if (!field || !SUB_FILTER_OPS.has(op)) continue;
    const value = (c as { value?: unknown }).value;
    out.push({ field, op: op as WidgetFilter["op"], value });
  }
  return out;
}

export interface SourceLabelsActionState {
  ok?: boolean;
  message?: string;
}

export interface SourceActionState {
  ok?: boolean;
  message?: string;
  // Key da fonte criada (consumida pelo wizard de import ao criar inline).
  key?: string;
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

// Sub-fontes (0082) também aceitam campo personalizado de DATA como campo de
// período ('custom:<field_key>' — ex.: Data Reunião). Formato validado aqui;
// a existência/tipo do campo é conferida na action (validateCustomPeriodField).
const CUSTOM_PERIOD_RE = /^custom:[A-Za-z0-9_]{1,60}$/;

function isSubPeriodField(v: string): boolean {
  return PERIOD_FIELDS.has(v) || CUSTOM_PERIOD_RE.test(v);
}

// Keys que não podem virar fonte: rótulo reservado dos campos gerais e
// palavras que colidiriam com semânticas internas.
const RESERVED_KEYS = new Set(["geral", "gerais", "records", "todas"]);

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

function cleanText(v: FormDataEntryValue | null, max: number): string {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

// Nome IANA real? (o CHECK da 0079 só valida o formato; aqui o Intl decide.)
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function readSourceForm(formData: FormData): {
  label: string;
  shortLabel: string;
  periodField: string;
  manualEntry: boolean;
  timezone: string | null;
  error?: string;
} {
  const label = cleanText(formData.get("label"), 60);
  const shortLabel = cleanText(formData.get("short_label"), 40);
  const periodField = cleanText(formData.get("default_period_field"), 40);
  const manualEntry = String(formData.get("manual_entry") ?? "") === "1";
  const timezone = cleanText(formData.get("timezone"), 64) || null;
  if (label.length < 2) {
    return {
      label,
      shortLabel,
      periodField,
      manualEntry,
      timezone,
      error: "Informe o nome da base.",
    };
  }
  if (!PERIOD_FIELDS.has(periodField)) {
    return {
      label,
      shortLabel,
      periodField,
      manualEntry,
      timezone,
      error: "Campo de período inválido.",
    };
  }
  if (timezone && !isValidTimezone(timezone)) {
    return {
      label,
      shortLabel,
      periodField,
      manualEntry,
      timezone,
      error: "Fuso horário inválido (use um nome IANA, ex.: Europe/Moscow).",
    };
  }
  return { label, shortLabel, periodField, manualEntry, timezone };
}

export async function createSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const { label, shortLabel, periodField, manualEntry, timezone, error } =
    readSourceForm(formData);
  if (error) return { ok: false, message: error };

  const key = slugify(label).slice(0, 40);
  if (!KEY_RE.test(key) || RESERVED_KEYS.has(key)) {
    return {
      ok: false,
      message:
        "Nome inválido para gerar a chave da base: comece com uma letra e use ao menos 2 caracteres.",
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
    return { ok: false, message: `Já existe uma base com a chave "${key}".` };
  }

  // key/record_type são GLOBAIS (multi-org, 0090) mas a RLS esconde as fontes
  // de outras orgs — uma colisão invisível vira sufixo (-2, -3…), nunca erro
  // opaco nem vazamento do nome alheio.
  const orgId = await getActiveOrgId();
  let finalKey = key;
  let insertError: { code?: string; message: string } | null = null;
  for (let n = 1; n <= 5; n++) {
    if (n > 1) finalKey = `${key.slice(0, 37)}_${n}`;
    const { error } = await supabase.from("data_sources").insert({
      key: finalKey,
      record_type: finalKey, // fontes novas: mapeamento identidade
      label,
      short_label: shortLabel || label,
      default_period_field: periodField,
      builtin: false,
      manual_entry: manualEntry,
      timezone,
      ...(orgId ? { organization_id: orgId } : {}),
    });
    insertError = error;
    if (!error || error.code !== "23505") break;
  }
  if (insertError) {
    return { ok: false, message: `Falha ao criar: ${insertError.message}` };
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Base "${label}" criada (chave: ${finalKey}).`,
    key: finalKey,
  };
}

export async function updateSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const key = cleanText(formData.get("key"), 40);
  const { label, shortLabel, periodField, manualEntry, timezone, error } =
    readSourceForm(formData);
  if (error) return { ok: false, message: error };

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("data_sources")
    .update({
      label,
      short_label: shortLabel || label,
      default_period_field: periodField,
      manual_entry: manualEntry,
      timezone,
    })
    .eq("key", key);
  if (updateError) {
    return { ok: false, message: `Falha ao salvar: ${updateError.message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Base atualizada." };
}

export async function deleteSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const key = cleanText(formData.get("key"), 40);
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("data_sources")
    .select("key, record_type, builtin")
    .eq("key", key)
    .maybeSingle();
  if (!row) return { ok: false, message: "Base não encontrada." };
  if (row.builtin) {
    return { ok: false, message: "Bases internas não podem ser excluídas." };
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
  return { ok: true, message: "Base excluída." };
}

/** Grava o rótulo dos campos "gerais" (sync_config; nomes curtos por fonte
 *  agora são editados na própria fonte e vivem em data_sources). Preserva
 *  chaves legadas já salvas no valor. */
export async function saveSourceLabels(
  _prev: SourceLabelsActionState,
  formData: FormData
): Promise<SourceLabelsActionState> {
  await requireFontesWrite();
  const geral = cleanText(formData.get("geral"), 40);
  if (!geral) return { ok: false, message: "Informe o rótulo." };

  // sync_config tem PK (organization_id, key) desde a 0090.
  const orgId = await getActiveOrgId();
  const supabase = await createClient();
  let currentQuery = supabase
    .from("sync_config")
    .select("value")
    .eq("key", SOURCE_LABELS_CONFIG_KEY);
  if (orgId) currentQuery = currentQuery.eq("organization_id", orgId);
  const { data: current } = await currentQuery.maybeSingle();
  const value = {
    ...((current?.value ?? {}) as Record<string, unknown>),
    geral,
  };
  const { error } = await supabase
    .from("sync_config")
    .upsert(
      {
        key: SOURCE_LABELS_CONFIG_KEY,
        value,
        ...(orgId ? { organization_id: orgId } : {}),
      },
      { onConflict: "organization_id,key" }
    );
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  // Os rótulos entram via provider do layout raiz → revalida o app inteiro.
  revalidatePath("/", "layout");
  return { ok: true, message: "Rótulo salvo." };
}

// ============ SUB-FONTES (0078) ============

function readSubSourceForm(formData: FormData): {
  label: string;
  shortLabel: string;
  periodField: string;
  parentKey: string;
  filter: WidgetFilter[];
  error?: string;
} {
  const label = cleanText(formData.get("label"), 60);
  const shortLabel = cleanText(formData.get("short_label"), 40);
  const periodField = cleanText(formData.get("default_period_field"), 40);
  const parentKey = cleanText(formData.get("parent_key"), 40);
  const filter = parseSubFilter(formData.get("filter"));
  if (label.length < 2) {
    return { label, shortLabel, periodField, parentKey, filter, error: "Informe o nome da sub-base." };
  }
  if (!parentKey) {
    return { label, shortLabel, periodField, parentKey, filter, error: "Escolha a base pai." };
  }
  if (!isSubPeriodField(periodField)) {
    return { label, shortLabel, periodField, parentKey, filter, error: "Campo de período inválido." };
  }
  if (filter.length === 0) {
    return { label, shortLabel, periodField, parentKey, filter, error: "Defina ao menos uma condição de filtro." };
  }
  return { label, shortLabel, periodField, parentKey, filter };
}

// Campo 'custom:<key>' como período: o campo precisa existir e ser de DATA.
async function validateCustomPeriodField(
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodField: string
): Promise<string | null> {
  if (!periodField.startsWith("custom:")) return null;
  const fieldKey = periodField.slice("custom:".length);
  const { data } = await supabase
    .from("field_definitions")
    .select("data_type")
    .eq("field_key", fieldKey)
    .maybeSingle();
  if (!data) return `Campo personalizado "${fieldKey}" não encontrado.`;
  if (data.data_type !== "data")
    return `O campo "${fieldKey}" não é um campo de data.`;
  return null;
}

export async function createSubSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const { label, shortLabel, periodField, parentKey, filter, error } =
    readSubSourceForm(formData);
  if (error) return { ok: false, message: error };

  const key = slugify(label).slice(0, 40);
  if (!KEY_RE.test(key) || RESERVED_KEYS.has(key)) {
    return {
      ok: false,
      message:
        "Nome inválido para gerar a chave: comece com uma letra e use ao menos 2 caracteres.",
    };
  }

  const supabase = await createClient();
  const periodError = await validateCustomPeriodField(supabase, periodField);
  if (periodError) return { ok: false, message: periodError };
  // A pai precisa existir como fonte RAIZ (data_sources).
  const { data: parent } = await supabase
    .from("data_sources")
    .select("key")
    .eq("key", parentKey)
    .maybeSingle();
  if (!parent) return { ok: false, message: "Base pai não encontrada." };

  // Colisão de key com fonte raiz OU outra sub-fonte.
  const [{ data: rootHit }, { data: subHit }] = await Promise.all([
    supabase
      .from("data_sources")
      .select("key")
      .or(`key.eq.${key},record_type.eq.${key}`)
      .limit(1),
    supabase.from("sub_sources").select("key").eq("key", key).limit(1),
  ]);
  if ((rootHit && rootHit.length > 0) || (subHit && subHit.length > 0)) {
    return { ok: false, message: `Já existe uma base com a chave "${key}".` };
  }

  const { error: insertError } = await supabase.from("sub_sources").insert({
    key,
    parent_key: parentKey,
    label,
    short_label: shortLabel || label,
    default_period_field: periodField,
    filter,
  });
  if (insertError) {
    return { ok: false, message: `Falha ao criar: ${insertError.message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Sub-base "${label}" criada (chave: ${key}).`, key };
}

export async function updateSubSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const key = cleanText(formData.get("key"), 40);
  const { label, shortLabel, periodField, filter, error } =
    readSubSourceForm(formData);
  if (error) return { ok: false, message: error };

  const supabase = await createClient();
  const periodError = await validateCustomPeriodField(supabase, periodField);
  if (periodError) return { ok: false, message: periodError };
  // parent_key é imutável na edição (troca de pai = record_type diferente).
  const { error: updateError } = await supabase
    .from("sub_sources")
    .update({
      label,
      short_label: shortLabel || label,
      default_period_field: periodField,
      filter,
    })
    .eq("key", key);
  if (updateError) {
    return { ok: false, message: `Falha ao salvar: ${updateError.message}` };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Sub-base atualizada." };
}

export async function deleteSubSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const key = cleanText(formData.get("key"), 40);
  const supabase = await createClient();
  const { error } = await supabase.from("sub_sources").delete().eq("key", key);
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };
  revalidatePath("/", "layout");
  return { ok: true, message: "Sub-base excluída." };
}
