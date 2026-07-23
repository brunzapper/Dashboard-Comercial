// Versão: 1.5 | Data: 20/07/2026
// v1.5 (20/07/2026): catálogo agregado via builder ÚNICO (lib/widgets/
//   agg-catalog.defsAggCatalogInput) e validação de contexto via
//   validateFormulaForContext (lib/records/formula-validate.ts) — mesmas
//   regras/mensagens que os editores rodam ao vivo; comportamento idêntico.
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
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { slugify } from "@/lib/records/slug";
import { CORE_SELECT_CAPABLE, isCoreDef } from "@/lib/records/core-defs";
import { PERCENT_DATA_TYPES, type DataType } from "@/lib/records/types";
import { formulaCondAggInfo, type Formula } from "@/lib/records/formulas";
import {
  findFormulaCycle,
  formulaReferencesField,
  refCustomKey,
  transitiveFormulaDependents,
} from "@/lib/records/formula-deps";
import type { OperandRef } from "@/lib/records/date-operands";
import { perRecordCalcOperands } from "@/lib/records/calc-operands";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import { recalcAllFormulaFields } from "@/lib/records/recalc";
import {
  buildAggOperandCatalog,
  defsAggCatalogInput,
} from "@/lib/widgets/agg-catalog";

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
  // Linhas core (0086) ficam na lista (guardas de update/delete as encontram);
  // os catálogos de operandos as filtram internamente (isCoreDef).
  source_system: string | null;
}

async function loadDefRows(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<DefRow[]> {
  const { data } = await supabase
    .from("field_definitions")
    .select("id, field_key, label, data_type, formula, applies_to, source_system");
  return (data ?? []).map((d) => ({
    id: d.id as string,
    field_key: d.field_key as string,
    label: ((d.label as string) ?? (d.field_key as string)),
    data_type: d.data_type as DataType,
    formula: (d.formula as Formula | null) ?? null,
    applies_to: (d.applies_to as string[] | null) ?? null,
    source_system: (d.source_system as string | null) ?? null,
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


// Operandos de AGREGAÇÃO (campos 'calculado_agg'): builder ÚNICO compartilhado
// com os editores (lib/widgets/agg-catalog.ts) — servidor e UI montam o MESMO
// catálogo por construção (rótulo é load-bearing no round-trip texto⇄tokens).
// `forbidden` = self + dependentes transitivos (referenciá-los criaria ciclo).
function aggOperandCatalog(
  rows: DefRow[],
  forbidden: Set<string>,
  sources: Sources
): OperandRef[] {
  return buildAggOperandCatalog(defsAggCatalogInput(rows, sources, forbidden));
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
  // Catálogo do CONTEXTO (agregado ou por-registro) — builder único
  // compartilhado com os editores; tokenização e validação usam o mesmo.
  const catalog = isAgg
    ? aggOperandCatalog(rows, forbidden, sources)
    : serverOperandCatalog(rows, forbidden, sources);
  let formula = f.formula;
  if (f.formulaMode === "text") {
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
  // Regras e mensagens do CONTEXTO (estrutura + refs, colocação de
  // SOMASE/CONT.SE/MÉDIASE, mensagens dedicadas do por-registro e do "today")
  // vivem em validateFormulaForContext (lib/records/formula-validate.ts) — o
  // MESMO módulo que os editores rodam ao vivo; warnings não bloqueiam o save.
  const v = validateFormulaForContext(formula, {
    kind: isAgg ? "aggregate" : "record",
    catalog,
  });
  if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };
  if (isAgg) {
    // Condições sobre RELAÇÕES comparam por NOME (19/07/2026): valida o
    // literal contra a lista real — nome inexistente viraria contagem 0
    // SILENCIOSA em runtime; aqui vira erro claro. (Consulta o banco, por isso
    // fica fora do módulo puro.)
    const fk = await validateFkCondNames(supabase, formula);
    if (!fk.ok) return { ok: false, message: fk.message };
  }
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

  // Chave reservada a uma coluna do núcleo (0086): mensagem clara em vez do
  // 23505 genérico do índice único.
  const { data: coreClash } = await supabase
    .from("field_definitions")
    .select("field_key, source_system")
    .eq("field_key", fieldKey)
    .maybeSingle();
  if (coreClash && isCoreDef(coreClash)) {
    return {
      ok: false,
      message: `"${fieldKey}" é uma coluna do núcleo — use outro rótulo (a coluna já existe na aba Núcleo).`,
    };
  }

  let calcFormula: Formula | null = null;
  if (FORMULA_DATA_TYPES.includes(f.dataType)) {
    const r = await resolveAndValidateFormula(supabase, f, fieldKey);
    if (!r.ok) return { ok: false, message: r.message };
    calcFormula = r.formula;
  }

  const currency = resolveCurrencyColumns(f);
  // Carimbo de org (multi-org, 0090): sem ele, o default (Zapper) falharia no
  // WITH CHECK da RLS para um admin de outra org.
  const orgId = await getActiveOrgId();
  const { error } = await supabase.from("field_definitions").insert({
    ...(orgId ? { organization_id: orgId } : {}),
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
    .select("field_key, source_system, data_type")
    .eq("id", id)
    .maybeSingle();
  const fieldKey = (existing?.field_key as string | undefined) ?? undefined;

  // Linha core (0086): branch dedicado — persiste APENAS rótulo/olho/ordem e,
  // na whitelist (pipeline/etapa/...), texto↔selecao + options. Nunca formula,
  // write_back, is_local, moeda, percent, papéis ou applies_to.
  if (existing && isCoreDef(existing)) {
    const key = existing.field_key as string;
    const currentType = existing.data_type as string;
    const typeCapable =
      CORE_SELECT_CAPABLE.has(key) &&
      (f.dataType === "texto" || f.dataType === "selecao");
    if (f.dataType !== currentType && !typeCapable) {
      return {
        ok: false,
        message: "O tipo desta coluna do núcleo é fixo (só as colunas de texto elegíveis alternam entre Texto e Seleção).",
      };
    }
    const patch: Record<string, unknown> = {
      label: f.label,
      show_in_builder: f.showInBuilder,
      sort_order: f.sortOrder,
    };
    if (typeCapable) {
      patch.data_type = f.dataType;
      patch.options = f.dataType === "selecao" ? f.options : [];
    }
    const { error } = await supabase
      .from("field_definitions")
      .update(patch)
      .eq("id", id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/campos");
    revalidatePath("/registros");
    revalidatePath("/dashboards/[id]", "page");
    return { ok: true, message: `Campo "${f.label}" atualizado.` };
  }

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
  if (target && isCoreDef(target)) {
    return {
      ok: false,
      message: "Colunas do núcleo não podem ser excluídas.",
    };
  }
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
