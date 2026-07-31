// Versão: 1.0 | Data: 30/07/2026
// Resolução + validação SERVER-SIDE de fórmulas de campos calculados — extraída
// VERBATIM de app/(app)/campos/actions.ts (v1.5, módulo "use server" que só
// exporta async) para ser compartilhada entre as actions de /campos e o core de
// criação de campos por IA (lib/ai/create-fields.ts). A invariante segue a
// mesma: catálogo/validação de fórmula são ÚNICOS — os catálogos saem dos
// builders compartilhados com os editores (perRecordCalcOperands /
// buildAggOperandCatalog) e as regras de contexto de validateFormulaForContext
// (lib/records/formula-validate.ts). NUNCA monte um caminho paralelo.
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import type { GoalMetricDef } from "@/lib/metas/metrics";
import { formulaCondAggInfo, type Formula } from "@/lib/records/formulas";
import {
  findFormulaCycle,
  refCustomKey,
  transitiveFormulaDependents,
} from "@/lib/records/formula-deps";
import type { OperandRef } from "@/lib/records/date-operands";
import { perRecordCalcOperands } from "@/lib/records/calc-operands";
import { isFkUuid } from "@/lib/widgets/engine";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import type { DataType } from "@/lib/records/types";
import {
  buildAggOperandCatalog,
  defsAggCatalogInput,
} from "@/lib/widgets/agg-catalog";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Sources = Awaited<ReturnType<typeof loadSources>>;

// Linha de field_definitions com o necessário para catálogos de operandos E
// para o grafo de dependências entre calculados (formula-deps). Carregada UMA
// vez por validação/exclusão, para ciclo e catálogos verem o mesmo snapshot.
export interface DefRow {
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

export async function loadDefRows(supabase: Supabase): Promise<DefRow[]> {
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
export function forbiddenOperandKeys(
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
// `goalMetrics` = registry de metas (operandos `meta:<chave>`, 31/07/2026).
export function aggOperandCatalog(
  rows: DefRow[],
  forbidden: Set<string>,
  sources: Sources,
  goalMetrics: GoalMetricDef[]
): OperandRef[] {
  return buildAggOperandCatalog(
    defsAggCatalogInput(rows, sources, goalMetrics, forbidden)
  );
}

// Catálogo completo de operandos por-registro (números + casados + datas +
// condicionais) com rótulos, para resolver [Rótulo] no editor de texto E montar
// o conjunto permitido do validateFormula. MESMA origem dos editores
// (perRecordCalcOperands, lib/records/calc-operands.ts) — UI e validação nunca
// divergem. O conjunto proibido (ciclo) é filtrado por refCustomKey: cobre
// custom:<k> e agg:*:custom:<k>; match:<fonte>:custom:<k> fica DE FORA de
// propósito (aponta p/ OUTRO registro — não cria aresta de dependência).
export function serverOperandCatalog(
  rows: DefRow[],
  forbidden: Set<string>,
  sources: Sources
): OperandRef[] {
  return perRecordCalcOperands(rows, sources).allRefs.filter((o) => {
    const key = refCustomKey(o.ref);
    return key == null || !forbidden.has(key);
  });
}

// Valida os literais de NOME das condições sobre relações (responsible_id/
// operation_id) de uma fórmula agregada contra as listas reais — espelho do
// resolve de runtime (resolveFkFilterNames no engine). Nome desconhecido em
// runtime vira recorte vazio (0) SILENCIOSO; no save vira erro claro.
export async function validateFkCondNames(
  supabase: Supabase,
  formula: Formula
): Promise<{ ok: true } | { ok: false; message: string }> {
  const wanted: { ref: "responsible_id" | "operation_id"; value: string }[] = [];
  for (const spec of formulaCondAggInfo(formula).specs) {
    for (const c of spec.conds) {
      if (
        (c.ref === "responsible_id" || c.ref === "operation_id") &&
        typeof c.value === "string" &&
        !isFkUuid(c.value)
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

export function parseFormula(raw: string): Formula | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Formula;
    if (!parsed || !Array.isArray(parsed.tokens)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Subconjunto do form de /campos que a resolução de fórmula consome — o
// chamador de IA monta este objeto direto (formulaMode "text" + formula_texto).
export interface FormulaResolveInput {
  label: string;
  dataType: string;
  formula: Formula | null;
  // Editor de fórmula: "builder" (tokens prontos em `formula`) ou "text"
  // (estilo Sheets em `formulaText` — tokenizado aqui com o catálogo).
  formulaMode: string;
  formulaText: string;
}

// Resolve a fórmula de um campo calculado (texto → tokens quando o editor for o
// de texto) e valida estrutura + refs. 'calculado' (por-registro) aceita
// numéricos (inclusive outros calculados — aninhamento), datas e condicionais;
// 'calculado_agg' aceita refs de agregação (agg:*) + outros 'calculado_agg'
// (custom:<key> plano, expandido em runtime) — refs por-registro crus são
// rejeitados ali, e agg:* é rejeitado aqui (nenhum dos catálogos do
// por-registro contém agg:*). Ciclos de dependência entre calculados são
// rejeitados aqui com o caminho completo (findFormulaCycle).
export async function resolveAndValidateFormula(
  supabase: Supabase,
  f: FormulaResolveInput,
  fieldKey?: string
): Promise<{ ok: true; formula: Formula } | { ok: false; message: string }> {
  const isAgg = f.dataType === "calculado_agg";
  const [rows, sources, goalMetrics] = await Promise.all([
    loadDefRows(supabase),
    loadSources(supabase),
    loadGoalMetrics(supabase),
  ]);
  const forbidden = forbiddenOperandKeys(rows, fieldKey);
  // Catálogo do CONTEXTO (agregado ou por-registro) — builder único
  // compartilhado com os editores; tokenização e validação usam o mesmo.
  const catalog = isAgg
    ? aggOperandCatalog(rows, forbidden, sources, goalMetrics)
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
