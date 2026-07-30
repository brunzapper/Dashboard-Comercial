// Versão: 1.0 | Data: 30/07/2026
// NÚCLEO da criação de campos por IA (/campos → "Criar com IA"). A IA NUNCA
// escreve: generateFieldsCore valida a ESTRUTURA (lib/import/fields/validate)
// e as FÓRMULAS dos calculados com os MESMOS módulos dos editores/actions
// (lib/records/formula-server.ts — catálogos únicos + tokenizeFormulaText +
// validateFormulaForContext; erros voltam pro laço de autocorreção) e devolve
// a prévia; applyGeneratedFieldsCore re-valida e cria campo a campo via
// createField (choke point de /campos — re-roda gate, colisão de chave core,
// fórmula, carimbo de org e recalc). Fórmula pode referenciar campo SIMPLES
// proposto na MESMA leva: a validação da geração injeta os campos do lote como
// linhas sintéticas no catálogo e o apply cria os não-calculados PRIMEIRO
// (calculado → calculado_agg por último), então o createField revalida com o
// campo já existente. Papéis/visibilidade ficam nos defaults programáticos
// (mesmos do import de CSV); teto de 10 campos por leva.
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { loadSources } from "@/lib/config/sources";
import { DATA_TYPE_LABELS } from "@/lib/records/types";
import { isCoreDef } from "@/lib/records/core-defs";
import {
  aggOperandCatalog,
  forbiddenOperandKeys,
  loadDefRows,
  serverOperandCatalog,
  validateFkCondNames,
  type DefRow,
} from "@/lib/records/formula-server";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import { findFormulaCycle } from "@/lib/records/formula-deps";
import { createField } from "@/app/(app)/campos/actions";
import { buildFieldsPromptText } from "@/lib/import/fields/instructions";
import {
  validateFieldsCreate,
  type FieldsCreateValidation,
} from "@/lib/import/fields/validate";
import type {
  FieldsCreateContext,
  ParsedFieldCreate,
} from "@/lib/import/fields/types";

// Defaults programáticos de papéis (mesmos do prepareImportFields do CSV):
// visível a todos os papéis, editável só por admin — ajustes finos ficam na
// tela de Campos depois.
const DEFAULT_VISIBLE_ROLES = ["admin", "gestor", "vendedor"];
const DEFAULT_EDITABLE_ROLES = ["admin"];

export interface GenerateFieldsInput {
  description: string;
  priorTurns?: string[];
  /** Prévia pendente — a resposta SUBSTITUI a proposta inteira. */
  pendingJson?: string;
}

export interface GenerateFieldsState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** Campos propostos (validados) — a prévia renderiza daqui. */
  fields?: ParsedFieldCreate[];
  summary?: string[];
  warnings?: string[];
}

export interface ApplyFieldsResultItem {
  index: number;
  rotulo: string;
  ok: boolean;
  message?: string;
}

export interface ApplyFieldsState {
  ok: boolean;
  message?: string;
  errors?: string[];
  results?: ApplyFieldsResultItem[];
  createdCount?: number;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

function fieldsCreateContext(rows: DefRow[]): FieldsCreateContext {
  return {
    existing: rows.map((r) => ({ key: r.field_key, core: isCoreDef(r) })),
  };
}

// Linhas SINTÉTICAS dos campos do lote: entram no catálogo de operandos para a
// fórmula de um calculado poder referenciar um campo simples proposto JUNTO.
function syntheticRows(fields: ParsedFieldCreate[]): DefRow[] {
  return fields.map((f, i) => ({
    id: `__ai_new_${i}`,
    field_key: f.fieldKey,
    label: f.rotulo,
    data_type: f.tipo,
    formula: null,
    applies_to: null,
    source_system: null,
  }));
}

// Valida as fórmulas do lote com os MESMOS blocos de resolveAndValidateFormula
// (formula-server) sobre o catálogo aumentado com as linhas sintéticas do
// próprio lote. O apply revalida tudo de novo no createField (com os campos
// anteriores do lote já criados de verdade).
async function validateBatchFormulas(
  supabase: Supabase,
  rows: DefRow[],
  fields: ParsedFieldCreate[]
): Promise<string[]> {
  const errors: string[] = [];
  const withBatch = [...rows, ...syntheticRows(fields)];
  const sources = await loadSources(supabase);
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f.formulaTexto) continue;
    const where = `campo ${i + 1} ("${f.rotulo}")`;
    const isAgg = f.tipo === "calculado_agg";
    const forbidden = forbiddenOperandKeys(withBatch, f.fieldKey);
    const catalog = isAgg
      ? aggOperandCatalog(withBatch, forbidden, sources)
      : serverOperandCatalog(withBatch, forbidden, sources);
    const tok = tokenizeFormulaText(f.formulaTexto, catalog);
    if (!tok.ok) {
      errors.push(`${where}: ${tok.error}`);
      continue;
    }
    const cycle = findFormulaCycle(f.fieldKey, tok.formula, withBatch);
    if (cycle) {
      errors.push(
        `${where}: dependência circular na fórmula (${cycle.join(" → ")}).`
      );
      continue;
    }
    const v = validateFormulaForContext(tok.formula, {
      kind: isAgg ? "aggregate" : "record",
      catalog,
    });
    if (!v.ok) {
      errors.push(`${where}: ${v.error ?? "fórmula inválida."}`);
      continue;
    }
    if (isAgg) {
      const fk = await validateFkCondNames(supabase, tok.formula);
      if (!fk.ok) errors.push(`${where}: ${fk.message}`);
    }
  }
  return errors;
}

function detailOf(f: ParsedFieldCreate): string {
  const parts: string[] = [DATA_TYPE_LABELS[f.tipo]];
  if (f.opcoes) parts.push(`opções: ${f.opcoes.join(", ")}`);
  if (f.formulaTexto) parts.push(`= ${f.formulaTexto}`);
  if (f.moedaModo) {
    parts.push(
      f.moedaModo === "fixed" ? `moeda fixa ${f.moedaCodigo ?? "BRL"}` : "moeda do registro"
    );
  }
  if (f.percentual) parts.push("exibe %");
  return parts.join(" · ");
}

export async function generateFieldsCore(
  input: GenerateFieldsInput
): Promise<GenerateFieldsState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("manage_field_definitions")) {
    return { ok: false, message: "Apenas administradores podem gerenciar campos." };
  }
  const description = input.description.trim();
  if (!description) return { ok: false, message: "Descreva os campos a criar." };

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações.",
    };
  }

  const supabase = await createClient();
  const [rows, sources] = await Promise.all([
    loadDefRows(supabase),
    loadSources(supabase),
  ]);
  const ctx = fieldsCreateContext(rows);

  // Catálogo atual (colisões + convenção de nomes) e operandos REAIS de
  // fórmula (rótulos dos catálogos únicos — os mesmos dos editores).
  const catalogJson = JSON.stringify(
    {
      campos_existentes: rows
        .filter((r) => !isCoreDef(r))
        .map((r) => ({
          chave: r.field_key,
          rotulo: r.label,
          tipo: DATA_TYPE_LABELS[r.data_type] ?? r.data_type,
        })),
      colunas_do_nucleo: rows
        .filter((r) => isCoreDef(r))
        .map((r) => r.field_key),
    },
    null,
    2
  );
  const none = new Set<string>();
  const operandsJson = JSON.stringify(
    {
      por_registro: serverOperandCatalog(rows, none, sources).map((o) => o.label),
      agregacao: aggOperandCatalog(rows, none, sources).map((o) => o.label),
    },
    null,
    2
  );

  let system = buildFieldsPromptText({ catalogJson, operandsJson });
  const pending = (input.pendingJson ?? "").trim();
  if (pending) {
    system += aiSection(
      "PRÉVIA PENDENTE (AINDA NÃO APLICADA)",
      "No turno anterior você propôs os campos abaixo e o usuário AINDA NÃO " +
        "confirmou a criação. Sua resposta deste turno SUBSTITUI a proposta " +
        "INTEIRA: re-inclua os campos que continuarem desejados.\n\n" +
        pending
    );
  }

  const result = await runJsonGenerationLoop<
    Extract<FieldsCreateValidation, { ok: true }>
  >({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    validate: async (raw) => {
      const v = validateFieldsCreate(raw, ctx);
      if (!v.ok) return { ok: false, errors: v.errors };
      const formulaErrors = await validateBatchFormulas(supabase, rows, v.fields);
      if (formulaErrors.length > 0) return { ok: false, errors: formulaErrors };
      return { ok: true, value: v };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }

  const { fields, warnings } = result.value;
  return {
    ok: true,
    message: "Prévia pronta — revise os campos e confirme a criação.",
    fields,
    summary: fields.map((f, i) => `${i + 1}. ${f.rotulo} — ${detailOf(f)}`),
    warnings,
  };
}

// Ordem de criação: simples primeiro, depois calculado, calculado_agg por
// último — um calculado pode referenciar campo simples da MESMA leva (o
// createField revalida com o campo já criado).
function applyOrder(fields: ParsedFieldCreate[]): number[] {
  const rank = (f: ParsedFieldCreate) =>
    f.tipo === "calculado_agg" ? 2 : f.tipo === "calculado" ? 1 : 0;
  return fields
    .map((f, i) => ({ i, r: rank(f) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.i);
}

export async function applyGeneratedFieldsCore(
  raw: string
): Promise<ApplyFieldsState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("manage_field_definitions")) {
    return { ok: false, message: "Apenas administradores podem gerenciar campos." };
  }

  const supabase = await createClient();
  const rows = await loadDefRows(supabase);
  const validation = validateFieldsCreate(raw, fieldsCreateContext(rows));
  if (!validation.ok) {
    return {
      ok: false,
      message: "A proposta tem problemas — peça um ajuste à IA e tente de novo.",
      errors: validation.errors,
    };
  }
  const fields = validation.fields;

  const results: ApplyFieldsResultItem[] = new Array(fields.length);
  let createdCount = 0;
  for (const i of applyOrder(fields)) {
    const f = fields[i];
    const fd = new FormData();
    fd.set("label", f.rotulo);
    fd.set("data_type", f.tipo);
    if (f.opcoes) fd.set("options", f.opcoes.join("\n"));
    if (f.formulaTexto) {
      fd.set("formula_mode", "text");
      fd.set("formula_text", f.formulaTexto);
    }
    if (f.moedaModo) {
      fd.set("currency_mode", f.moedaModo);
      if (f.moedaCodigo) fd.set("currency_code", f.moedaCodigo);
    }
    if (f.percentual) fd.set("show_as_percent", "on");
    fd.set("show_in_builder", "on");
    // allow_negative: default do form (checked) — só relevante nos calculados.
    if (f.formulaTexto) fd.set("allow_negative", "on");
    for (const role of DEFAULT_VISIBLE_ROLES) fd.append("visible_to_roles", role);
    for (const role of DEFAULT_EDITABLE_ROLES) fd.append("editable_by_roles", role);
    const res = await createField({}, fd);
    results[i] = {
      index: i,
      rotulo: f.rotulo,
      ok: Boolean(res.ok),
      message: res.ok ? undefined : res.message,
    };
    if (res.ok) createdCount += 1;
  }

  const total = fields.length;
  const message =
    createdCount === total
      ? `${createdCount} campo(s) criado(s).`
      : createdCount > 0
        ? `${createdCount} de ${total} campos criados — veja os erros por item.`
        : "Nenhum campo criado — veja os erros por item.";
  return { ok: createdCount === total, message, results, createdCount };
}
