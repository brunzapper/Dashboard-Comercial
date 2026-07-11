// Versão: 1.1 | Data: 09/07/2026
// Server Actions da tela de Campos (field_definitions). Gravação com o client
// do usuário — a RLS exige `manage_field_definitions` (admin). É a infra de
// "criar campos personalizados": tipo, opções de dropdown, visibilidade e
// editabilidade por papel.
// v1.1 (09/07/2026): Fase 7 — suporta tipos 'booleano'/'calculado', o toggle
//   show_in_builder e a fórmula (validada) dos campos calculados; ao salvar um
//   calculado, recalcula os registros existentes.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NUMERIC_DATA_TYPES, type DataType } from "@/lib/records/types";
import { validateFormula, type Formula } from "@/lib/records/formulas";
import { recalcAllFormulaFields } from "@/lib/records/recalc";
import { CORE_FIELDS } from "@/lib/widgets/fields";

export interface FieldActionState {
  ok?: boolean;
  message?: string;
  // Preenchido no createField bem-sucedido — permite que quem criou o campo (ex.:
  // o editor de widget) já o insira na configuração atual sem readicionar à mão.
  field?: { field_key: string; data_type: DataType };
}

const DATA_TYPES = [
  "texto",
  "numero",
  "data",
  "selecao",
  "moeda",
  "booleano",
  "calculado",
] as const;

// Referências numéricas que podem ser operandos de uma fórmula: colunas do
// núcleo numéricas + campos personalizados numéricos que NÃO sejam calculados
// (evita dependência circular).
async function allowedFormulaRefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  excludeFieldKey?: string
): Promise<Set<string>> {
  const refs = new Set<string>(
    CORE_FIELDS.filter((f) => f.isNumeric).map((f) => f.field)
  );
  const { data } = await supabase
    .from("field_definitions")
    .select("field_key, data_type");
  for (const d of data ?? []) {
    const key = d.field_key as string;
    const dt = d.data_type as DataType;
    if (key === excludeFieldKey) continue;
    if (NUMERIC_DATA_TYPES.includes(dt) && dt !== "calculado") {
      refs.add(`custom:${key}`);
    }
  }
  return refs;
}

function parseFormula(raw: string): Formula | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Formula;
    if (!parsed || !Array.isArray(parsed.tokens)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function parseOptions(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRoles(formData: FormData, name: string): string[] {
  return formData.getAll(name).map(String).filter(Boolean);
}

async function ensureCanManage(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.permissions.includes("manage_field_definitions")) {
    return "Apenas administradores podem gerenciar campos.";
  }
  return null;
}

function readForm(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  const dataType = String(formData.get("data_type") ?? "texto");
  const options = parseOptions(String(formData.get("options") ?? ""));
  const visible = parseRoles(formData, "visible_to_roles");
  const editable = parseRoles(formData, "editable_by_roles");
  const isLocal = formData.get("is_local") === "on";
  const showInBuilder = formData.get("show_in_builder") === "on";
  const writeBack = formData.get("write_back") === "on";
  const sortOrder = Number(formData.get("sort_order") ?? 0) || 0;
  const formula = parseFormula(String(formData.get("formula") ?? ""));
  return { label, dataType, options, visible, editable, isLocal, showInBuilder, writeBack, sortOrder, formula };
}

export async function createField(
  _prev: FieldActionState,
  formData: FormData
): Promise<FieldActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };

  const f = readForm(formData);
  if (!f.label) return { ok: false, message: "Informe o rótulo do campo." };
  if (!DATA_TYPES.includes(f.dataType as (typeof DATA_TYPES)[number])) {
    return { ok: false, message: "Tipo de dado inválido." };
  }
  const fieldKey = slugify(f.label);
  if (!fieldKey) return { ok: false, message: "Rótulo inválido para gerar a chave." };

  const supabase = await createClient();

  if (f.dataType === "calculado") {
    if (!f.formula) return { ok: false, message: "Defina a fórmula do campo calculado." };
    const allowed = await allowedFormulaRefs(supabase, fieldKey);
    const v = validateFormula(f.formula, allowed);
    if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };
  }

  const { error } = await supabase.from("field_definitions").insert({
    field_key: fieldKey,
    label: f.label,
    data_type: f.dataType,
    options: f.dataType === "selecao" ? f.options : [],
    visible_to_roles: f.visible,
    editable_by_roles: f.editable,
    is_local: f.isLocal,
    show_in_builder: f.showInBuilder,
    write_back: f.writeBack,
    formula: f.dataType === "calculado" ? f.formula : null,
    sort_order: f.sortOrder,
  });
  if (error) {
    const msg =
      error.code === "23505"
        ? `Já existe um campo com a chave "${fieldKey}".`
        : error.message;
    return { ok: false, message: msg };
  }
  if (f.dataType === "calculado") await recalcAllFormulaFields();
  revalidatePath("/campos");
  revalidatePath("/registros");
  revalidatePath("/dashboards/[id]", "page");
  return {
    ok: true,
    message: `Campo "${f.label}" criado.`,
    field: { field_key: fieldKey, data_type: f.dataType as DataType },
  };
}

export async function updateField(
  _prev: FieldActionState,
  formData: FormData
): Promise<FieldActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };

  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Campo não identificado." };
  const f = readForm(formData);
  if (!f.label) return { ok: false, message: "Informe o rótulo do campo." };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("field_definitions")
    .select("field_key")
    .eq("id", id)
    .maybeSingle();
  const fieldKey = (existing?.field_key as string | undefined) ?? undefined;

  if (f.dataType === "calculado") {
    if (!f.formula) return { ok: false, message: "Defina a fórmula do campo calculado." };
    const allowed = await allowedFormulaRefs(supabase, fieldKey);
    const v = validateFormula(f.formula, allowed);
    if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };
  }

  const { error } = await supabase
    .from("field_definitions")
    .update({
      label: f.label,
      data_type: f.dataType,
      options: f.dataType === "selecao" ? f.options : [],
      visible_to_roles: f.visible,
      editable_by_roles: f.editable,
      is_local: f.isLocal,
      show_in_builder: f.showInBuilder,
      write_back: f.writeBack,
      formula: f.dataType === "calculado" ? f.formula : null,
      sort_order: f.sortOrder,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  if (f.dataType === "calculado") await recalcAllFormulaFields();
  revalidatePath("/campos");
  revalidatePath("/registros");
  revalidatePath("/dashboards/[id]", "page");
  return { ok: true, message: `Campo "${f.label}" atualizado.` };
}

// Liga/desliga rapidamente se o campo aparece nos seletores (dropdowns do
// construtor + colunas da tabela de Registros). Usado pela config em /campos.
export async function toggleShowInBuilder(formData: FormData): Promise<void> {
  const err = await ensureCanManage();
  if (err) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const next = String(formData.get("show_in_builder") ?? "") === "true";
  const supabase = await createClient();
  await supabase.from("field_definitions").update({ show_in_builder: next }).eq("id", id);
  revalidatePath("/campos");
  revalidatePath("/registros");
}

export async function deleteField(formData: FormData): Promise<void> {
  const err = await ensureCanManage();
  if (err) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("field_definitions").delete().eq("id", id);
  revalidatePath("/campos");
}
