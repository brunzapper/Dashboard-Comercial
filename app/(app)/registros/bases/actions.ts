// Versão: 2.6 | Data: 07/08/2026
// v2.6 (07/08/2026): fim do revalidatePath("/", "layout") nos CRUDs — a
//   resposta da action voltava só depois do re-render RSC do layout raiz +
//   página (o formulário ficava travado segundos por operação). O form agora
//   libera quando o INSERT/UPDATE retorna e o CLIENTE dispara router.refresh()
//   pós-sucesso (useRefreshOnActionOk nos managers) — o refresh re-renderiza a
//   rota atual INCLUINDO o layout (sidebar/providers atualizam ~0,3s depois),
//   como transition não-urgente. Outras rotas dinâmicas não guardam cache de
//   cliente (staleTimes dynamic = 0) — sempre re-buscam na navegação.
// v2.5 (28/07/2026): campo de período CUSTOM nas BASES (0110, espelho da 0082
//   das subs) — create/updateSource aceitam 'custom:<field_key>' e
//   validateCustomPeriodField (agora usado por bases E subs) confere também
//   que o campo NÃO é override core (0086) e que o applies_to cobre o
//   record_type da base (fecha o gap: sub aceitava campo de outra base).
// v2.4 (26/07/2026): PASTAS (0107) — CRUD de source_folders (agrupamento de
//   EXIBIÇÃO das bases) + ordenação manual ↑/↓ (sort_order) de pastas, bases
//   (dentro da pasta) e sub-bases (dentro da pai). Excluir pasta devolve as
//   bases para "sem pasta" (FK on delete set null). createSource/updateSource
//   ganham o campo folder_id (vazio = sem pasta).
// v2.3 (19/07/2026): timezone (0079) — fuso da ORIGEM da fonte (IANA), validado
//   com Intl; vazio = sem conversão. Datetimes ingeridos normalizam p/ Brasília.
// v2.2 (19/07/2026): SUB-FONTES (0078) — CRUD de `sub_sources` (fonte derivada
//   de uma pai, recortada por um filtro). createSubSource/updateSubSource/
//   deleteSubSource; o predicado chega como JSON (WidgetFilter[]) e é saneado.
// v2.1 (16/07/2026): manual_entry (0061) — flag "Permite criação manual" por
//   fonte (criar/editar).
// Server Actions da tela Registros → Bases.
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
import { isCoreDef } from "@/lib/records/core-defs";
import { slugify } from "@/lib/records/slug";
import { SOURCE_LABELS_CONFIG_KEY } from "@/lib/config/source-labels";
import { resequenceAfterMove } from "@/lib/source-folders";
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

// Bases (0110) e sub-fontes (0082) também aceitam campo personalizado de DATA
// como campo de período ('custom:<field_key>' — ex.: Data Reunião). Formato
// validado aqui; existência/tipo/applies_to do campo são conferidos na action
// (validateCustomPeriodField).
const CUSTOM_PERIOD_RE = /^custom:[A-Za-z0-9_]{1,60}$/;

function isPeriodFieldValue(v: string): boolean {
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
  // Pasta (0107): uuid de source_folders; null = "sem pasta".
  folderId: string | null;
  error?: string;
} {
  const label = cleanText(formData.get("label"), 60);
  const shortLabel = cleanText(formData.get("short_label"), 40);
  const periodField = cleanText(formData.get("default_period_field"), 40);
  const manualEntry = String(formData.get("manual_entry") ?? "") === "1";
  const timezone = cleanText(formData.get("timezone"), 64) || null;
  const folderId = cleanText(formData.get("folder_id"), 40) || null;
  if (label.length < 2) {
    return {
      label,
      shortLabel,
      periodField,
      manualEntry,
      timezone,
      folderId,
      error: "Informe o nome da base.",
    };
  }
  if (!isPeriodFieldValue(periodField)) {
    return {
      label,
      shortLabel,
      periodField,
      manualEntry,
      timezone,
      folderId,
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
      folderId,
      error: "Fuso horário inválido (use um nome IANA, ex.: Europe/Moscow).",
    };
  }
  return { label, shortLabel, periodField, manualEntry, timezone, folderId };
}

// Pasta escolhida no form precisa existir e ser visível (RLS escopa à org).
async function validateFolderId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  folderId: string | null
): Promise<string | null> {
  if (!folderId) return null;
  const { data } = await supabase
    .from("source_folders")
    .select("id")
    .eq("id", folderId)
    .maybeSingle();
  return data ? null : "Pasta não encontrada.";
}

export async function createSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const {
    label,
    shortLabel,
    periodField,
    manualEntry,
    timezone,
    folderId,
    error,
  } = readSourceForm(formData);
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
  const folderError = await validateFolderId(supabase, folderId);
  if (folderError) return { ok: false, message: folderError };
  // Base nova: record_type = key identidade (na prática só campo global passa
  // — applies_to restrito nunca referencia um record_type que ainda não
  // existe; o form de criação oferece só as colunas core de todo modo).
  const periodError = await validateCustomPeriodField(supabase, periodField, key);
  if (periodError) return { ok: false, message: periodError };
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
      folder_id: folderId,
      ...(orgId ? { organization_id: orgId } : {}),
    });
    insertError = error;
    if (!error || error.code !== "23505") break;
  }
  if (insertError) {
    return { ok: false, message: `Falha ao criar: ${insertError.message}` };
  }
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
  const {
    label,
    shortLabel,
    periodField,
    manualEntry,
    timezone,
    folderId,
    error,
  } = readSourceForm(formData);
  if (error) return { ok: false, message: error };

  const supabase = await createClient();
  const folderError = await validateFolderId(supabase, folderId);
  if (folderError) return { ok: false, message: folderError };
  // Campo custom (0110): o applies_to é conferido contra o record_type da
  // base (fetch só quando necessário — core não consulta nada).
  let recordType: string | null = null;
  if (periodField.startsWith("custom:")) {
    const { data: row } = await supabase
      .from("data_sources")
      .select("record_type")
      .eq("key", key)
      .maybeSingle();
    if (!row) return { ok: false, message: "Base não encontrada." };
    recordType = (row.record_type as string) || key;
  }
  const periodError = await validateCustomPeriodField(
    supabase,
    periodField,
    recordType
  );
  if (periodError) return { ok: false, message: periodError };
  const { error: updateError } = await supabase
    .from("data_sources")
    .update({
      label,
      short_label: shortLabel || label,
      default_period_field: periodField,
      manual_entry: manualEntry,
      timezone,
      folder_id: folderId,
    })
    .eq("key", key);
  if (updateError) {
    return { ok: false, message: `Falha ao salvar: ${updateError.message}` };
  }
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
  // Os rótulos entram via provider do layout raiz — o refresh pós-sucesso do
  // cliente re-renderiza layout+página (useRefreshOnActionOk no manager).
  return { ok: true, message: "Rótulo salvo." };
}

// ============ SUB-FONTES (0078) ============

function readSubSourceForm(formData: FormData): {
  label: string;
  shortLabel: string;
  periodField: string;
  parentKey: string;
  filter: WidgetFilter[];
  ignorePeriod: boolean;
  error?: string;
} {
  const label = cleanText(formData.get("label"), 60);
  const shortLabel = cleanText(formData.get("short_label"), 40);
  const periodField = cleanText(formData.get("default_period_field"), 40);
  const parentKey = cleanText(formData.get("parent_key"), 40);
  const filter = parseSubFilter(formData.get("filter"));
  // ignore_period (0116): sub-base isenta do filtro de período do dashboard.
  const ignorePeriod = String(formData.get("ignore_period") ?? "") === "1";
  const base = { label, shortLabel, periodField, parentKey, filter, ignorePeriod };
  if (label.length < 2) {
    return { ...base, error: "Informe o nome da sub-base." };
  }
  if (!parentKey) {
    return { ...base, error: "Escolha a base pai." };
  }
  if (!isPeriodFieldValue(periodField)) {
    return { ...base, error: "Campo de período inválido." };
  }
  if (filter.length === 0) {
    return { ...base, error: "Defina ao menos uma condição de filtro." };
  }
  return base;
}

// Campo 'custom:<key>' como período (bases 0110 e subs 0082): o campo precisa
// existir, ser de DATA, não ser um override core (0086 — `custom:closed_at`
// resolveria custom_fields->>'closed_at', sempre null) e, quando restrito por
// applies_to, cobrir o record_type da base. recordType null pula esse último
// check (degradação graciosa).
async function validateCustomPeriodField(
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodField: string,
  recordType: string | null
): Promise<string | null> {
  if (!periodField.startsWith("custom:")) return null;
  const fieldKey = periodField.slice("custom:".length);
  const { data } = await supabase
    .from("field_definitions")
    .select("field_key, data_type, applies_to, source_system")
    .eq("field_key", fieldKey)
    .maybeSingle();
  if (!data) return `Campo personalizado "${fieldKey}" não encontrado.`;
  if (isCoreDef(data))
    return `"${fieldKey}" é uma coluna do núcleo — selecione-a diretamente na lista.`;
  if (data.data_type !== "data")
    return `O campo "${fieldKey}" não é um campo de data.`;
  if (
    recordType &&
    Array.isArray(data.applies_to) &&
    data.applies_to.length > 0 &&
    !data.applies_to.includes(recordType)
  )
    return `O campo "${fieldKey}" não se aplica a esta base.`;
  return null;
}

export async function createSubSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const { label, shortLabel, periodField, parentKey, filter, ignorePeriod, error } =
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
  // A pai precisa existir como fonte RAIZ (data_sources). O record_type dela
  // valida o applies_to de um campo custom de período (a sub compartilha o
  // record_type da pai).
  const { data: parent } = await supabase
    .from("data_sources")
    .select("key, record_type")
    .eq("key", parentKey)
    .maybeSingle();
  if (!parent) return { ok: false, message: "Base pai não encontrada." };
  const periodError = await validateCustomPeriodField(
    supabase,
    periodField,
    (parent.record_type as string) || parentKey
  );
  if (periodError) return { ok: false, message: periodError };

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
    ignore_period: ignorePeriod,
  });
  if (insertError) {
    return { ok: false, message: `Falha ao criar: ${insertError.message}` };
  }
  return { ok: true, message: `Sub-base "${label}" criada (chave: ${key}).`, key };
}

export async function updateSubSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const key = cleanText(formData.get("key"), 40);
  const { label, shortLabel, periodField, filter, ignorePeriod, error } =
    readSubSourceForm(formData);
  if (error) return { ok: false, message: error };

  const supabase = await createClient();
  // Campo custom (0082/0110): o applies_to é conferido contra o record_type
  // da PAI da sub (fetch só quando necessário — core não consulta nada).
  let parentRecordType: string | null = null;
  if (periodField.startsWith("custom:")) {
    const { data: subRow } = await supabase
      .from("sub_sources")
      .select("parent_key")
      .eq("key", key)
      .maybeSingle();
    if (!subRow) return { ok: false, message: "Sub-base não encontrada." };
    const { data: parentRow } = await supabase
      .from("data_sources")
      .select("record_type")
      .eq("key", subRow.parent_key as string)
      .maybeSingle();
    parentRecordType =
      (parentRow?.record_type as string | undefined) ??
      (subRow.parent_key as string);
  }
  const periodError = await validateCustomPeriodField(
    supabase,
    periodField,
    parentRecordType
  );
  if (periodError) return { ok: false, message: periodError };
  // parent_key é imutável na edição (troca de pai = record_type diferente).
  const { error: updateError } = await supabase
    .from("sub_sources")
    .update({
      label,
      short_label: shortLabel || label,
      default_period_field: periodField,
      filter,
      ignore_period: ignorePeriod,
    })
    .eq("key", key);
  if (updateError) {
    return { ok: false, message: `Falha ao salvar: ${updateError.message}` };
  }
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
  return { ok: true, message: "Sub-base excluída." };
}

// ============ PASTAS DE BASES (0107) ============
// Agrupamento de EXIBIÇÃO das bases (source_folders) + ordenação manual ↑/↓.
// A ordem regravada é sempre a do LOADER (sort_order asc + desempates) →
// resequenceAfterMove → sort_order = índice do grupo inteiro (normaliza os
// empates herdados do default 0 na primeira reordenação).

function readDir(formData: FormData): "up" | "down" | null {
  const dir = String(formData.get("dir") ?? "");
  return dir === "up" || dir === "down" ? dir : null;
}

export async function createSourceFolder(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const label = cleanText(formData.get("label"), 60);
  if (label.length < 2) return { ok: false, message: "Informe o nome da pasta." };

  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  // Nova pasta entra no fim da lista da org.
  let maxQuery = supabase
    .from("source_folders")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  if (orgId) maxQuery = maxQuery.eq("organization_id", orgId);
  const { data: maxRow } = await maxQuery.maybeSingle();
  const { error } = await supabase.from("source_folders").insert({
    label,
    sort_order: Number(maxRow?.sort_order ?? -1) + 1,
    ...(orgId ? { organization_id: orgId } : {}),
  });
  if (error) return { ok: false, message: `Falha ao criar: ${error.message}` };
  return { ok: true, message: `Pasta "${label}" criada.` };
}

export async function updateSourceFolder(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const id = cleanText(formData.get("id"), 40);
  const label = cleanText(formData.get("label"), 60);
  if (!id) return { ok: false, message: "Pasta inválida." };
  if (label.length < 2) return { ok: false, message: "Informe o nome da pasta." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("source_folders")
    .update({ label })
    .eq("id", id);
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  return { ok: true, message: "Pasta atualizada." };
}

export async function deleteSourceFolder(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const id = cleanText(formData.get("id"), 40);
  if (!id) return { ok: false, message: "Pasta inválida." };
  const supabase = await createClient();
  // FK data_sources.folder_id on delete SET NULL: as bases voltam para "sem
  // pasta" — nunca somem.
  const { error } = await supabase.from("source_folders").delete().eq("id", id);
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };
  return {
    ok: true,
    message: 'Pasta excluída. As bases voltaram para "sem pasta".',
  };
}

export async function reorderSourceFolder(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const id = cleanText(formData.get("id"), 40);
  const dir = readDir(formData);
  if (!id || !dir) return { ok: false, message: "Movimento inválido." };

  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  let query = supabase
    .from("source_folders")
    .select("id")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (orgId) query = query.eq("organization_id", orgId);
  const { data, error } = await query;
  if (error || !data) return { ok: false, message: "Falha ao carregar pastas." };

  const ids = data.map((r) => r.id as string);
  const next = resequenceAfterMove(ids, id, dir);
  const results = await Promise.all(
    next.map((fid, idx) =>
      supabase.from("source_folders").update({ sort_order: idx }).eq("id", fid)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { ok: false, message: `Falha ao reordenar: ${failed.error.message}` };
  }
  return { ok: true };
}

export async function reorderSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const key = cleanText(formData.get("key"), 40);
  const dir = readDir(formData);
  if (!key || !dir) return { ok: false, message: "Movimento inválido." };

  const supabase = await createClient();
  // Grupo = bases da MESMA pasta (ou sem pasta), na ordem do loader.
  const { data: row } = await supabase
    .from("data_sources")
    .select("folder_id")
    .eq("key", key)
    .maybeSingle();
  if (!row) return { ok: false, message: "Base não encontrada." };

  const orgId = await getActiveOrgId();
  let query = supabase
    .from("data_sources")
    .select("key")
    .order("sort_order", { ascending: true })
    .order("builtin", { ascending: false })
    .order("created_at", { ascending: true });
  query =
    row.folder_id == null
      ? query.is("folder_id", null)
      : query.eq("folder_id", row.folder_id as string);
  if (orgId) query = query.eq("organization_id", orgId);
  const { data, error } = await query;
  if (error || !data) return { ok: false, message: "Falha ao carregar bases." };

  const keys = data.map((r) => r.key as string);
  const next = resequenceAfterMove(keys, key, dir);
  const results = await Promise.all(
    next.map((k, idx) =>
      supabase.from("data_sources").update({ sort_order: idx }).eq("key", k)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { ok: false, message: `Falha ao reordenar: ${failed.error.message}` };
  }
  return { ok: true };
}

export async function reorderSubSource(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const key = cleanText(formData.get("key"), 40);
  const dir = readDir(formData);
  if (!key || !dir) return { ok: false, message: "Movimento inválido." };

  const supabase = await createClient();
  // Grupo = sub-bases da MESMA pai, na ordem do loader.
  const { data: row } = await supabase
    .from("sub_sources")
    .select("parent_key")
    .eq("key", key)
    .maybeSingle();
  if (!row) return { ok: false, message: "Sub-base não encontrada." };

  const { data, error } = await supabase
    .from("sub_sources")
    .select("key")
    .eq("parent_key", row.parent_key as string)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error || !data) {
    return { ok: false, message: "Falha ao carregar sub-bases." };
  }

  const keys = data.map((r) => r.key as string);
  const next = resequenceAfterMove(keys, key, dir);
  const results = await Promise.all(
    next.map((k, idx) =>
      supabase.from("sub_sources").update({ sort_order: idx }).eq("key", k)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { ok: false, message: `Falha ao reordenar: ${failed.error.message}` };
  }
  return { ok: true };
}

// ============ Sub-operações automáticas (0106, Parcerias) ============
// Config por base: cada registro da base materializa uma sub-operação sob a
// operação-pai com perfil gerado (lib/operations/auto-operations.ts). A
// gravação usa o client do USUÁRIO (RLS espelha operations_write: admin da
// org); só o "Gerar agora" usa service role — depois do guard de admin.

const AUTO_OP_PROFILE_OPS = new Set(["eq", "eq_ci"]);

export async function saveAutoOperations(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const sourceKey = cleanText(formData.get("source_key"), 40);
  const parentId = String(formData.get("parent_operation_id") ?? "").trim();
  const nameField = String(formData.get("name_field") ?? "").trim() || "title";
  const valueField = String(formData.get("value_field") ?? "").trim();
  const targetField = String(formData.get("target_field") ?? "").trim();
  const targetSource = String(formData.get("target_source") ?? "").trim();
  const profileOp = String(formData.get("profile_op") ?? "eq_ci").trim();
  const enabled = String(formData.get("enabled") ?? "on") !== "off";

  if (!sourceKey) return { ok: false, message: "Base inválida." };
  if (!parentId) return { ok: false, message: "Escolha a operação-pai." };
  if (!valueField) {
    return { ok: false, message: "Escolha o campo do identificador na base." };
  }
  if (!targetField) {
    return { ok: false, message: "Escolha o campo comparado no lead." };
  }
  if (!AUTO_OP_PROFILE_OPS.has(profileOp)) {
    return { ok: false, message: "Operador inválido." };
  }

  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const { error } = await supabase.from("source_auto_operations").upsert(
    {
      source_key: sourceKey,
      parent_operation_id: parentId,
      name_field: nameField,
      value_field: valueField,
      target_field: targetField,
      target_sources: targetSource ? [targetSource] : [],
      profile_op: profileOp,
      enabled,
      // Carimbo de org (multi-org): sem ele, usuário de outra org falharia no
      // WITH CHECK (default é a org legada).
      ...(orgId ? { organization_id: orgId } : {}),
    },
    { onConflict: "source_key" }
  );
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  revalidatePath("/registros/bases");
  return { ok: true, message: "Sub-operações automáticas configuradas." };
}

export async function deleteAutoOperations(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const sourceKey = cleanText(formData.get("source_key"), 40);
  const supabase = await createClient();
  const { error } = await supabase
    .from("source_auto_operations")
    .delete()
    .eq("source_key", sourceKey);
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };
  revalidatePath("/registros/bases");
  return {
    ok: true,
    message:
      "Config removida. As sub-operações já geradas foram mantidas em Operações.",
  };
}

export async function runAutoOperationsNow(
  _prev: SourceActionState,
  formData: FormData
): Promise<SourceActionState> {
  await requireFontesWrite();
  const sourceKey = cleanText(formData.get("source_key"), 40);
  if (!sourceKey) return { ok: false, message: "Base inválida." };
  // Service role SÓ depois do guard de admin acima: a RLS de operations é
  // admin-only e a rotina precisa escrever nelas.
  const { ensureAutoOperationsForSource } = await import(
    "@/lib/operations/auto-operations"
  );
  const { createServiceClient } = await import("@/lib/supabase/service");
  try {
    const res = await ensureAutoOperationsForSource(
      createServiceClient(),
      sourceKey
    );
    if (!res.configured) {
      return { ok: false, message: "Base sem config habilitada." };
    }
    revalidatePath("/registros/bases");
    revalidatePath("/configuracoes/operacoes");
    return {
      ok: true,
      message: `Sub-operações geradas: ${res.created} nova(s), ${res.renamed} renomeada(s), ${res.adopted} adotada(s), ${res.reactivated} reativada(s), ${res.deactivated} inativada(s), ${res.skipped} registro(s) sem identificador.`,
    };
  } catch (e) {
    return { ok: false, message: `Falha ao gerar: ${(e as Error).message}` };
  }
}
