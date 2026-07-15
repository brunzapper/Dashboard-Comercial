// Versão: 1.3 | Data: 15/07/2026
// v1.3 (15/07/2026): show_as_percent — lê o checkbox/hidden do form e persiste
//   via resolveShowAsPercent (só tipos elegíveis; nunca junto com moeda).
// Server Actions da tela de Campos (field_definitions). Gravação com o client
// do usuário — a RLS exige `manage_field_definitions` (admin). É a infra de
// "criar campos personalizados": tipo, opções de dropdown, visibilidade e
// editabilidade por papel.
// v1.1 (09/07/2026): Fase 7 — suporta tipos 'booleano'/'calculado', o toggle
//   show_in_builder e a fórmula (validada) dos campos calculados; ao salvar um
//   calculado, recalcula os registros existentes.
// v1.2 (14/07/2026): tipo 'calculado_agg' — fórmula sobre AGREGAÇÕES (refs
//   agg:sum|avg|count). Valida só refs agg:* (rejeita refs por-registro e
//   vice-versa), moeda apenas número|fixa, e NÃO dispara recalc (nada é
//   materializado por registro — o engine de widgets avalia em runtime).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  NUMERIC_DATA_TYPES,
  PERCENT_DATA_TYPES,
  type DataType,
} from "@/lib/records/types";
import {
  formulaUsesCondAgg,
  validateFormula,
  type Formula,
} from "@/lib/records/formulas";
import { allDateOperands, type OperandRef } from "@/lib/records/date-operands";
import { allCondOperands, COND_DATA_TYPES } from "@/lib/records/cond-operands";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { recalcAllFormulaFields } from "@/lib/records/recalc";
import {
  aggOperandRefs,
  condAggOperandRefs,
  validateCondAggRefs,
} from "@/lib/widgets/calc-metrics";
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
  "calculado_agg",
] as const;

// Os dois tipos com fórmula (por-registro e de agregados) compartilham o fluxo
// de resolução/validação/persistência da fórmula.
const FORMULA_DATA_TYPES = ["calculado", "calculado_agg"];

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

// Operandos de AGREGAÇÃO (campos 'calculado_agg'): contagem de registros +
// Σ/Média das colunas numéricas do núcleo e dos custom numéricos — incluindo o
// 'calculado' por-registro (é materializado, o RPC agrega) e EXCLUINDO outros
// 'calculado_agg' (sem aninhamento na v1). Mesma origem da UI
// (lib/widgets/calc-metrics.aggOperandRefs) para editor e servidor concordarem.
async function aggOperandCatalog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  excludeFieldKey?: string
): Promise<OperandRef[]> {
  const { data } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type");
  const numeric = [
    ...CORE_FIELDS.filter((f) => f.isNumeric).map((f) => ({
      field: f.field,
      label: f.label,
    })),
    ...(data ?? [])
      .filter(
        (d) =>
          NUMERIC_DATA_TYPES.includes(d.data_type as DataType) &&
          d.field_key !== excludeFieldKey
      )
      .map((d) => ({
        field: `custom:${d.field_key}`,
        label: ((d.label as string) ?? (d.field_key as string)),
      })),
  ];
  // Contáveis (agg:count:<campo>): datas/numéricos do núcleo + qualquer custom
  // (exceto 'calculado_agg'). Mesmo critério do editor (fields-manager) para que
  // o construtor e a validação concordem.
  const countable = [
    ...CORE_FIELDS.filter((f) => f.isNumeric || f.isDate).map((f) => ({
      field: f.field,
      label: f.label,
    })),
    ...(data ?? [])
      .filter(
        (d) =>
          (d.data_type as DataType) !== "calculado_agg" &&
          d.field_key !== excludeFieldKey
      )
      .map((d) => ({
        field: `custom:${d.field_key}`,
        label: ((d.label as string) ?? (d.field_key as string)),
      })),
  ];
  // Operandos de SOMASE/CONT.SE/MÉDIASE: campos numéricos crus (alvo) + colunas
  // de condição (texto/seleção/booleano e datas). Mesma montagem dos editores
  // (fields-manager/widget-builder) para catálogo e validação concordarem.
  const customCond = (data ?? [])
    .filter(
      (d) =>
        COND_DATA_TYPES.includes(d.data_type as DataType) &&
        d.field_key !== excludeFieldKey
    )
    .map((d) => ({
      field_key: d.field_key as string,
      label: ((d.label as string) ?? (d.field_key as string)),
    }));
  const customDate = (data ?? [])
    .filter(
      (d) => (d.data_type as DataType) === "data" && d.field_key !== excludeFieldKey
    )
    .map((d) => ({
      field_key: d.field_key as string,
      label: ((d.label as string) ?? (d.field_key as string)),
    }));
  return [
    ...aggOperandRefs(numeric, countable),
    ...condAggOperandRefs(numeric, customCond, customDate),
  ];
}

// Refs de DATA permitidos numa fórmula: datas do próprio registro + custom
// `data` + datas do registro casado (match:<fonte>:<data>). Mesma origem do
// construtor (lib/records/date-operands), para UI e validação concordarem.
async function allowedFormulaDateRefs(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Set<string>> {
  const { data } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type")
    .eq("data_type", "data");
  const customDateFields = (data ?? []).map((d) => ({
    field_key: d.field_key as string,
    label: (d.label as string) ?? (d.field_key as string),
  }));
  return new Set(allDateOperands(customDateFields).map((o) => o.ref));
}

// Refs CONDICIONAIS permitidos numa fórmula (SE/E/OU e comparações): colunas
// textuais/booleanas do núcleo + custom texto/seleção/booleano + as mesmas do
// registro casado. Mesma origem do editor (lib/records/cond-operands).
async function allowedFormulaCondRefs(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Set<string>> {
  const { data } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type")
    .in("data_type", COND_DATA_TYPES);
  const customCondFields = (data ?? []).map((d) => ({
    field_key: d.field_key as string,
    label: (d.label as string) ?? (d.field_key as string),
  }));
  return new Set(allCondOperands(customCondFields).map((o) => o.ref));
}

// Catálogo completo de operandos (numéricos + datas + condicionais) com rótulos,
// para resolver [Rótulo] no editor de texto — mesma montagem da UI
// (components/campos/fields-manager.tsx), para editor e servidor concordarem.
async function serverOperandCatalog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  excludeFieldKey?: string
): Promise<OperandRef[]> {
  const { data } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type");
  const fields = (data ?? []).map((d) => ({
    field_key: d.field_key as string,
    label: ((d.label as string) ?? (d.field_key as string)),
    data_type: d.data_type as DataType,
  }));
  const numeric: OperandRef[] = [
    ...CORE_FIELDS.filter((f) => f.isNumeric).map((f) => ({
      ref: f.field,
      label: f.label,
      group: "Números",
    })),
    ...fields
      .filter(
        (f) =>
          NUMERIC_DATA_TYPES.includes(f.data_type) &&
          f.data_type !== "calculado" &&
          f.field_key !== excludeFieldKey
      )
      .map((f) => ({ ref: `custom:${f.field_key}`, label: f.label, group: "Números" })),
  ];
  const dates = allDateOperands(fields.filter((f) => f.data_type === "data"));
  const conds = allCondOperands(fields.filter((f) => COND_DATA_TYPES.includes(f.data_type)));
  return [...numeric, ...dates, ...conds];
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

// Resolve a fórmula de um campo calculado (texto → tokens quando o editor for o
// de texto) e valida estrutura + refs. 'calculado' (por-registro) aceita
// numéricos, datas e condicionais; 'calculado_agg' aceita SÓ refs de agregação
// (agg:*) — refs por-registro são rejeitadas ali, e agg:* é rejeitado aqui
// (nenhum dos catálogos do por-registro contém agg:*).
async function resolveAndValidateFormula(
  supabase: Awaited<ReturnType<typeof createClient>>,
  f: ReturnType<typeof readForm>,
  fieldKey?: string
): Promise<{ ok: true; formula: Formula } | { ok: false; message: string }> {
  const isAgg = f.dataType === "calculado_agg";
  let formula = f.formula;
  if (f.formulaMode === "text") {
    const catalog = isAgg
      ? await aggOperandCatalog(supabase, fieldKey)
      : await serverOperandCatalog(supabase, fieldKey);
    const tok = tokenizeFormulaText(f.formulaText, catalog);
    if (!tok.ok) return { ok: false, message: tok.error };
    formula = tok.formula;
  }
  if (!formula) {
    return { ok: false, message: "Defina a fórmula do campo calculado." };
  }
  if (isAgg) {
    const catalog = await aggOperandCatalog(supabase, fieldKey);
    const v = validateFormula(formula, new Set(catalog.map((o) => o.ref)));
    if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };
    // Colocação dos refs de SOMASE/CONT.SE/MÉDIASE: campo cru só dentro das
    // funções condicionais; alvo numérico; condição sobre coluna de condição.
    const p = validateCondAggRefs(formula, catalog);
    if (!p.ok) return { ok: false, message: p.error ?? "Fórmula inválida." };
    return { ok: true, formula };
  }
  // SOMASE/CONT.SE/MÉDIASE agregam VÁRIOS registros — não existem no campo
  // calculado por registro (que enxerga um registro só).
  if (formulaUsesCondAgg(formula)) {
    return {
      ok: false,
      message:
        'SOMASE/CONT.SE/MÉDIASE só funcionam em campos "Calculado (totais)" e métricas de widget — a fórmula por registro enxerga um registro só. Para condição por registro, use SE(...).',
    };
  }
  const [allowed, allowedDates, allowedConds] = await Promise.all([
    allowedFormulaRefs(supabase, fieldKey),
    allowedFormulaDateRefs(supabase),
    allowedFormulaCondRefs(supabase),
  ]);
  const v = validateFormula(formula, allowed, allowedDates, allowedConds);
  if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };
  return { ok: true, formula };
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
  const allowNegative = formData.get("allow_negative") === "on";
  const writeBack = formData.get("write_back") === "on";
  const sortOrder = Number(formData.get("sort_order") ?? 0) || 0;
  const formula = parseFormula(String(formData.get("formula") ?? ""));
  // Editor de fórmula: "builder" (botões, hidden `formula`) ou "text" (estilo
  // Sheets, hidden `formula_text` — tokenizado no servidor com o catálogo).
  const formulaMode = String(formData.get("formula_mode") ?? "builder");
  const formulaText = String(formData.get("formula_text") ?? "");
  const currencyCodeRaw = String(formData.get("currency_code") ?? "").trim().toUpperCase();
  const currencyModeRaw = String(formData.get("currency_mode") ?? "").trim();
  // Exibição percentual: checkbox (tipo numero) ou hidden derivado do combobox
  // "Formato do resultado" (calculado/calculado_agg) — ambos enviam "on".
  const showAsPercent = formData.get("show_as_percent") === "on";
  return {
    label,
    dataType,
    options,
    visible,
    editable,
    isLocal,
    showInBuilder,
    allowNegative,
    writeBack,
    sortOrder,
    formula,
    formulaMode,
    formulaText,
    currencyCodeRaw,
    currencyModeRaw,
    showAsPercent,
  };
}

// Resolve os campos de moeda a persistir conforme o tipo:
//  - 'moeda'     → currency_mode 'inherit' (padrão; moeda do registro) ou
//    'fixed' + currency_code (default BRL).
//  - 'calculado' e 'calculado_agg' → currency_mode ('inherit' = moeda automática
//    dos operandos | 'fixed') + currency_code (só p/ fixed).
//  - demais      → ambos null (não é moeda).
function resolveCurrencyColumns(f: {
  dataType: string;
  currencyCodeRaw: string;
  currencyModeRaw: string;
}): { currency_code: string | null; currency_mode: string | null } {
  if (f.dataType === "moeda") {
    if (f.currencyModeRaw === "fixed") {
      return {
        currency_code: /^[A-Z]{3}$/.test(f.currencyCodeRaw) ? f.currencyCodeRaw : "BRL",
        currency_mode: "fixed",
      };
    }
    return { currency_code: null, currency_mode: "inherit" };
  }
  if (f.dataType === "calculado" || f.dataType === "calculado_agg") {
    if (f.currencyModeRaw === "inherit") {
      return { currency_code: null, currency_mode: "inherit" };
    }
    if (f.currencyModeRaw === "fixed") {
      return {
        currency_code: /^[A-Z]{3}$/.test(f.currencyCodeRaw) ? f.currencyCodeRaw : "BRL",
        currency_mode: "fixed",
      };
    }
    return { currency_code: null, currency_mode: null };
  }
  return { currency_code: null, currency_mode: null };
}

// Exibição percentual: só tipos elegíveis e nunca junto com moeda (percent ×
// moeda são mutuamente exclusivos — o form já garante, isto é a trava do server).
function resolveShowAsPercent(
  f: { dataType: string; showAsPercent: boolean },
  currency: { currency_mode: string | null }
): boolean {
  if (!PERCENT_DATA_TYPES.includes(f.dataType as DataType)) return false;
  if (currency.currency_mode) return false;
  return f.showAsPercent;
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

  let calcFormula: Formula | null = null;
  if (FORMULA_DATA_TYPES.includes(f.dataType)) {
    const r = await resolveAndValidateFormula(supabase, f, fieldKey);
    if (!r.ok) return { ok: false, message: r.message };
    calcFormula = r.formula;
  }

  const currency = resolveCurrencyColumns(f);
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
    formula: calcFormula,
    // Só relevante nos calculados; demais tipos gravam o default (true) para o
    // checkbox ausente no form nunca virar false.
    allow_negative: FORMULA_DATA_TYPES.includes(f.dataType) ? f.allowNegative : true,
    currency_code: currency.currency_code,
    currency_mode: currency.currency_mode,
    show_as_percent: resolveShowAsPercent(f, currency),
    sort_order: f.sortOrder,
  });
  if (error) {
    const msg =
      error.code === "23505"
        ? `Já existe um campo com a chave "${fieldKey}".`
        : error.message;
    return { ok: false, message: msg };
  }
  // Só o calculado por-registro materializa valores; o de agregados é avaliado
  // em runtime pelo engine de widgets — nada a recalcular.
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

  let calcFormula: Formula | null = null;
  if (FORMULA_DATA_TYPES.includes(f.dataType)) {
    const r = await resolveAndValidateFormula(supabase, f, fieldKey);
    if (!r.ok) return { ok: false, message: r.message };
    calcFormula = r.formula;
  }

  const currency = resolveCurrencyColumns(f);
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
      formula: calcFormula,
      allow_negative: FORMULA_DATA_TYPES.includes(f.dataType) ? f.allowNegative : true,
      currency_code: currency.currency_code,
      currency_mode: currency.currency_mode,
      show_as_percent: resolveShowAsPercent(f, currency),
      sort_order: f.sortOrder,
    })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  // Recalcula os campos calculados materializados: ao salvar um 'calculado'
  // (fórmula/moeda mudou) e também ao salvar um 'moeda' (a moeda do campo pode
  // ter mudado — valores e carimbos de calculados que o usam ficariam velhos).
  if (f.dataType === "calculado" || f.dataType === "moeda") {
    await recalcAllFormulaFields();
  }
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
