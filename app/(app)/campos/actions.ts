// Versão: 1.4 | Data: 19/07/2026
// v1.4 (19/07/2026): aninhamento de campos calculados — os catálogos passam a
//   incluir calculados (por-registro) e calculado_agg (ref plano custom:<key>)
//   como operandos, excluindo o campo em edição + dependentes transitivos;
//   ciclos são rejeitados no save (findFormulaCycle, caminho em rótulos);
//   deleteField ganha guarda de referência (campo usado em fórmula não sai) e
//   retorna FieldActionState. Defs carregadas UMA vez por validação
//   (loadDefRows) — catálogos e grafo veem o mesmo snapshot.
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
import { loadSources } from "@/lib/config/sources";
import { slugify } from "@/lib/records/slug";
import {
  NUMERIC_DATA_TYPES,
  PERCENT_DATA_TYPES,
  type DataType,
} from "@/lib/records/types";
import {
  formulaCondAggInfo,
  formulaRefs,
  formulaUsesCondAgg,
  validateFormula,
  type Formula,
} from "@/lib/records/formulas";
import {
  findFormulaCycle,
  formulaReferencesField,
  refCustomKey,
  transitiveFormulaDependents,
} from "@/lib/records/formula-deps";
import type { OperandRef } from "@/lib/records/date-operands";
import { COND_DATA_TYPES } from "@/lib/records/cond-operands";
import { perRecordCalcOperands } from "@/lib/records/calc-operands";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { recalcAllFormulaFields } from "@/lib/records/recalc";
import {
  aggNestedOperandRefs,
  aggOperandRefs,
  condAggOperandRefs,
  sourceScopedAggOperandRefs,
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

// Linha de field_definitions com o necessário para catálogos de operandos E
// para o grafo de dependências entre calculados (formula-deps). Carregada UMA
// vez por validação/exclusão, para ciclo e catálogos verem o mesmo snapshot.
interface DefRow {
  id: string;
  field_key: string;
  label: string;
  data_type: DataType;
  formula: Formula | null;
  // applies_to (record_types) — decide sob quais fontes o campo entra nos
  // operandos com escopo (sourceScopedAggOperandRefs).
  applies_to: string[] | null;
}

async function loadDefRows(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<DefRow[]> {
  const { data } = await supabase
    .from("field_definitions")
    .select("id, field_key, label, data_type, formula, applies_to");
  return (data ?? []).map((d) => ({
    id: d.id as string,
    field_key: d.field_key as string,
    label: ((d.label as string) ?? (d.field_key as string)),
    data_type: d.data_type as DataType,
    formula: (d.formula as Formula | null) ?? null,
    applies_to: (d.applies_to as string[] | null) ?? null,
  }));
}

// Conjunto PROIBIDO como operando do campo em edição: o próprio campo + seus
// dependentes transitivos (referenciá-los criaria ciclo). Mesma regra da UI
// (fields-manager), para editor e validação concordarem.
function forbiddenOperandKeys(
  rows: DefRow[],
  fieldKey?: string
): Set<string> {
  if (!fieldKey) return new Set();
  const forbidden = transitiveFormulaDependents(fieldKey, rows);
  forbidden.add(fieldKey);
  return forbidden;
}


// Operandos de AGREGAÇÃO (campos 'calculado_agg'): contagem de registros +
// Σ/Média das colunas numéricas do núcleo e dos custom numéricos — incluindo o
// 'calculado' por-registro (é materializado, o RPC agrega) — + outros campos
// 'calculado_agg' como ref plano custom:<key> (aninhamento, 19/07/2026;
// expandido em runtime pelo engine), exceto os do conjunto proibido
// (self + dependentes transitivos). Mesma origem da UI
// (lib/widgets/calc-metrics.aggOperandRefs/aggNestedOperandRefs) para editor e
// servidor concordarem.
function aggOperandCatalog(
  rows: DefRow[],
  forbidden: Set<string>,
  sources: Sources
): OperandRef[] {
  const allowed = rows.filter((d) => !forbidden.has(d.field_key));
  const numeric = [
    ...CORE_FIELDS.filter((f) => f.isNumeric).map((f) => ({
      field: f.field,
      label: f.label,
    })),
    ...allowed
      .filter((d) => NUMERIC_DATA_TYPES.includes(d.data_type))
      .map((d) => ({
        field: `custom:${d.field_key}`,
        label: d.label,
        appliesTo: d.applies_to,
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
    ...allowed
      .filter((d) => d.data_type !== "calculado_agg")
      .map((d) => ({
        field: `custom:${d.field_key}`,
        label: d.label,
        appliesTo: d.applies_to,
      })),
  ];
  // Operandos de SOMASE/CONT.SE/MÉDIASE: campos numéricos crus (alvo) + colunas
  // de condição (texto/seleção/booleano e datas). Mesma montagem dos editores
  // (fields-manager/widget-builder) para catálogo e validação concordarem.
  const customCond = allowed
    .filter((d) => COND_DATA_TYPES.includes(d.data_type))
    .map((d) => ({ field_key: d.field_key, label: d.label }));
  const customDate = allowed
    .filter((d) => d.data_type === "data")
    .map((d) => ({ field_key: d.field_key, label: d.label }));
  const nestedAgg = allowed
    .filter((d) => d.data_type === "calculado_agg")
    .map((d) => ({ field_key: d.field_key, label: d.label }));
  return [
    ...aggOperandRefs(numeric, countable),
    // Variantes com ESCOPO DE FONTE (`agg:…@<fonte>`) — mesma montagem dos
    // editores (fields-manager/widget-builder) p/ rótulo e validação concordarem.
    ...sourceScopedAggOperandRefs(numeric, countable, sources),
    ...aggNestedOperandRefs(nestedAgg),
    ...condAggOperandRefs(numeric, customCond, customDate, sources),
  ];
}

type Sources = Awaited<ReturnType<typeof loadSources>>;

// Catálogo completo de operandos por-registro (números + casados + datas +
// condicionais) com rótulos, para resolver [Rótulo] no editor de texto E montar
// o conjunto permitido do validateFormula. MESMA origem dos editores
// (perRecordCalcOperands, lib/records/calc-operands.ts) — UI e validação nunca
// divergem. O conjunto proibido (ciclo) é filtrado por refCustomKey: cobre
// custom:<k> e agg:*:custom:<k>; match:<fonte>:custom:<k> fica DE FORA de
// propósito (aponta p/ OUTRO registro — não cria aresta de dependência).
function serverOperandCatalog(
  rows: DefRow[],
  forbidden: Set<string>,
  sources: Sources
): OperandRef[] {
  return perRecordCalcOperands(rows, sources).allRefs.filter((o) => {
    const key = refCustomKey(o.ref);
    return key == null || !forbidden.has(key);
  });
}

const FK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valida os literais de NOME das condições sobre relações (responsible_id/
// operation_id) de uma fórmula agregada contra as listas reais — espelho do
// resolve de runtime (resolveFkCondFilters no engine). Nome desconhecido em
// runtime vira recorte vazio (0) SILENCIOSO; no save vira erro claro.
async function validateFkCondNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formula: Formula
): Promise<{ ok: true } | { ok: false; message: string }> {
  const wanted: { ref: "responsible_id" | "operation_id"; value: string }[] = [];
  for (const spec of formulaCondAggInfo(formula).specs) {
    for (const c of spec.conds) {
      if (
        (c.ref === "responsible_id" || c.ref === "operation_id") &&
        typeof c.value === "string" &&
        !FK_UUID_RE.test(c.value)
      ) {
        wanted.push({ ref: c.ref, value: c.value });
      }
    }
  }
  if (wanted.length === 0) return { ok: true };
  const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");
  const [resp, ops] = await Promise.all([
    wanted.some((w) => w.ref === "responsible_id")
      ? supabase.from("responsibles").select("display_name")
      : Promise.resolve({ data: [] as { display_name: string | null }[] }),
    wanted.some((w) => w.ref === "operation_id")
      ? supabase.from("operations").select("name")
      : Promise.resolve({ data: [] as { name: string | null }[] }),
  ]);
  const respNames = new Set(
    (resp.data ?? []).map((r) =>
      norm(String((r as { display_name?: unknown }).display_name ?? ""))
    )
  );
  const opNames = new Set(
    (ops.data ?? []).map((r) => norm(String((r as { name?: unknown }).name ?? "")))
  );
  for (const w of wanted) {
    const found =
      w.ref === "responsible_id"
        ? respNames.has(norm(w.value))
        : opNames.has(norm(w.value));
    if (!found) {
      const kind = w.ref === "responsible_id" ? "o responsável" : "a operação";
      return {
        ok: false,
        message: `Não encontrei ${kind} "${w.value}" — use o nome exatamente como aparece na lista.`,
      };
    }
  }
  return { ok: true };
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
// numéricos (inclusive outros calculados — aninhamento), datas e condicionais;
// 'calculado_agg' aceita refs de agregação (agg:*) + outros 'calculado_agg'
// (custom:<key> plano, expandido em runtime) — refs por-registro crus são
// rejeitados ali, e agg:* é rejeitado aqui (nenhum dos catálogos do
// por-registro contém agg:*). Ciclos de dependência entre calculados são
// rejeitados aqui com o caminho completo (findFormulaCycle).
async function resolveAndValidateFormula(
  supabase: Awaited<ReturnType<typeof createClient>>,
  f: ReturnType<typeof readForm>,
  fieldKey?: string
): Promise<{ ok: true; formula: Formula } | { ok: false; message: string }> {
  const isAgg = f.dataType === "calculado_agg";
  const [rows, sources] = await Promise.all([
    loadDefRows(supabase),
    loadSources(supabase),
  ]);
  const forbidden = forbiddenOperandKeys(rows, fieldKey);
  const aggCatalog = isAgg ? aggOperandCatalog(rows, forbidden, sources) : null;
  let formula = f.formula;
  if (f.formulaMode === "text") {
    const catalog = aggCatalog ?? serverOperandCatalog(rows, forbidden, sources);
    const tok = tokenizeFormulaText(f.formulaText, catalog);
    if (!tok.ok) return { ok: false, message: tok.error };
    formula = tok.formula;
  }
  if (!formula) {
    return { ok: false, message: "Defina a fórmula do campo calculado." };
  }
  // Trava de ciclo do aninhamento (grafo unificado calculado + calculado_agg).
  // O backstop é o conjunto proibido dos catálogos ("Coluna inválida…"), mas a
  // detecção explícita dá a mensagem com o caminho.
  const cycle = findFormulaCycle(fieldKey ?? "", formula, rows);
  if (cycle) {
    const labelOf = (k: string) =>
      k === fieldKey
        ? f.label || k
        : (rows.find((r) => r.field_key === k)?.label ?? k);
    return {
      ok: false,
      message:
        `Dependência circular na fórmula: ${cycle
          .map((k) => `"${labelOf(k)}"`)
          .join(" → ")}. ` +
        "Um campo calculado não pode depender, direta ou indiretamente, de si mesmo.",
    };
  }
  if (isAgg && aggCatalog) {
    const v = validateFormula(formula, new Set(aggCatalog.map((o) => o.ref)));
    if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };
    // Colocação dos refs de SOMASE/CONT.SE/MÉDIASE: campo cru só dentro das
    // funções condicionais; alvo numérico; condição sobre coluna de condição.
    const p = validateCondAggRefs(formula, aggCatalog);
    if (!p.ok) return { ok: false, message: p.error ?? "Fórmula inválida." };
    // Condições sobre RELAÇÕES comparam por NOME (19/07/2026): valida o
    // literal contra a lista real — nome inexistente viraria contagem 0
    // SILENCIOSA em runtime; aqui vira erro claro.
    const fk = await validateFkCondNames(supabase, formula);
    if (!fk.ok) return { ok: false, message: fk.message };
    return { ok: true, formula };
  }
  // SOMASE/CONT.SE/MÉDIASE agregam VÁRIOS registros — não existem no campo
  // calculado por registro (que enxerga um registro só).
  if (formulaUsesCondAgg(formula)) {
    return {
      ok: false,
      message:
        'SOMASE/CONT.SE/MÉDIASE só funcionam em campos "Calculado (totais do recorte)" e métricas de widget — a fórmula por registro enxerga um registro só. Para condição por registro, use SE(...).',
    };
  }
  // Operando de agregação (Σ/Média/Contagem) num campo por registro: mensagem
  // dedicada (antes caía no genérico "Coluna inválida").
  if (formulaRefs(formula).some((r) => r.startsWith("agg:"))) {
    return {
      ok: false,
      message:
        'Operandos agregados (Σ, Média, Contagem) só funcionam em campos "Calculado (totais do recorte)" — o campo calculado por registro enxerga um registro só. Use os valores do próprio registro, ou crie um campo "Calculado (totais do recorte)".',
    };
  }
  // Conjunto permitido = o MESMO catálogo do tokenizador (números + casados +
  // datas + condicionais, sem o conjunto proibido) — validateFormula testa
  // pertencimento à união, então um único conjunto basta.
  const v = validateFormula(
    formula,
    new Set(serverOperandCatalog(rows, forbidden, sources).map((o) => o.ref))
  );
  if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };
  return { ok: true, formula };
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

export async function deleteField(
  _prev: FieldActionState,
  formData: FormData
): Promise<FieldActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Campo não identificado." };
  const supabase = await createClient();
  // Guarda de referência (19/07/2026): campo usado na fórmula de outro (como
  // operando, agregação, alvo/condição de SOMASE ou via registro casado) não
  // pode ser excluído — a ref órfã degradaria para null em silêncio e, num
  // calculado materializado, congelaria o último valor dos dependentes (a
  // exclusão não dispara recalc).
  const rows = await loadDefRows(supabase);
  const target = rows.find((r) => r.id === id);
  const dependents = target
    ? rows.filter(
        (r) => r.id !== id && formulaReferencesField(r.formula, target.field_key)
      )
    : [];
  if (target && dependents.length > 0) {
    const extra =
      dependents.length > 1 ? ` e mais ${dependents.length - 1} campo(s)` : "";
    return {
      ok: false,
      message:
        `Não é possível excluir "${target.label}": o campo é usado na fórmula ` +
        `de "${dependents[0].label}"${extra}. Remova a referência antes de excluir.`,
    };
  }
  const { error } = await supabase.from("field_definitions").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  // Mesmo escopo do create/update: a coluna some da tabela de Registros e dos
  // widgets — sem revalidar, essas telas mostravam o campo excluído até a
  // próxima navegação (dado stale é pior que lento).
  revalidatePath("/campos");
  revalidatePath("/registros");
  revalidatePath("/dashboards/[id]", "page");
  return { ok: true, message: `Campo "${target?.label ?? ""}" excluído.` };
}
