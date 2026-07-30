// Versão: 1.6 | Data: 30/07/2026
// v1.6 (30/07/2026): resolução/validação de fórmula (catálogos, ciclo, nomes de
//   FK) extraída p/ lib/records/formula-server.ts — compartilhada com a criação
//   de campos por IA (lib/ai/create-fields.ts); sem mudança de comportamento.
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
import { slugify } from "@/lib/records/slug";
import { CORE_SELECT_CAPABLE, isCoreDef } from "@/lib/records/core-defs";
import { PERCENT_DATA_TYPES, type DataType } from "@/lib/records/types";
import type { Formula } from "@/lib/records/formulas";
import { formulaReferencesField } from "@/lib/records/formula-deps";
// Resolução/validação de fórmula extraída p/ lib/records/formula-server.ts
// (30/07/2026): compartilhada com o core de criação de campos por IA — a
// invariante "catálogo/validação únicos" segue valendo lá.
import {
  loadDefRows,
  parseFormula,
  resolveAndValidateFormula,
} from "@/lib/records/formula-server";
import { recalcAllFormulaFields } from "@/lib/records/recalc";

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

// (DefRow/loadDefRows/catálogos/resolveAndValidateFormula vivem em
// lib/records/formula-server.ts desde 30/07/2026 — compartilhados com a IA.)

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
  // Editor de fórmula unificado (30/07/2026): envia SEMPRE "text" (o texto é
  // tokenizado no servidor com o catálogo). "builder" é valor LEGADO — só
  // chega de forms antigos em voo; nesse caso vale o hidden `formula` (JSON).
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
