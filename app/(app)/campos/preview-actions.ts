// Versão: 1.0 | Data: 20/07/2026
// Server actions da PRÉVIA de campos calculados por-registro (FormulaEditor):
// avalia a fórmula candidata sobre alguns registros REAIS usando exatamente a
// mesma montagem da materialização (record-eval-context + computeFormulaFields
// — nada de caminho paralelo), e expõe o STATUS de casamento entre duas fontes
// (getMatchStatus) para a receita "Ciclo de vendas" orientar o usuário quando
// a conexão entre fontes ainda não existe. Gate: manage_field_definitions
// (mesmo das actions de campos — só admins montam fórmulas).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadMatchRules } from "@/lib/matching";
import { perRecordCalcOperands } from "@/lib/records/calc-operands";
import {
  refCustomKey,
  transitiveFormulaDependents,
} from "@/lib/records/formula-deps";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import {
  computeFormulaFields,
  formulaRefs,
  loadFormulaDefs,
  type Formula,
} from "@/lib/records/formulas";
import { resolveMatchedRecords } from "@/lib/records/matching-engine";
import {
  buildRecordEvalInputs,
  loadRecordEvalMaterials,
  RECORD_EVAL_COLUMNS,
  type RecordEvalRow,
} from "@/lib/records/record-eval-context";
import type { DataType } from "@/lib/records/types";
import { recordTypeOf, sourceLabel } from "@/lib/sources";

// Quantos registros a prévia exibe / quantos candidatos ela avalia para
// escolher os mais informativos (resultado não-nulo, casado presente).
const PREVIEW_ROWS = 5;
const PREVIEW_CANDIDATES = 30;

export interface RecordPreviewInput {
  // Fórmula candidata: tokens (JSON, modo visual) OU texto (modo texto) —
  // mesmo contrato do submit do FieldForm.
  formulaJson?: string;
  formulaText?: string;
  formulaMode: "builder" | "text";
  // Campo em edição (exclui self+dependentes do catálogo, como no save).
  editingKey?: string;
}

export interface RecordPreviewRowOut {
  title: string;
  source: string;
  operands: { label: string; value: string }[];
  result: string;
  // Ex.: "sem registro casado de Leads do Bitrix" — feedback direto quando um
  // operando ↪ não tem casado neste registro.
  note?: string;
}

export interface RecordPreviewResult {
  ok: boolean;
  message?: string;
  rows?: RecordPreviewRowOut[];
}

async function ensureCanManage(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.permissions.includes("manage_field_definitions")) {
    return "Apenas administradores podem gerenciar campos.";
  }
  return null;
}

function fmtNumber(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function fmtResult(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return fmtNumber(v);
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  return String(v);
}

function fmtDateMs(ms: number | null): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export async function previewRecordFormula(
  input: RecordPreviewInput
): Promise<RecordPreviewResult> {
  const denied = await ensureCanManage();
  if (denied) return { ok: false, message: denied };
  const supabase = await createClient();

  const [{ data: defRows }, sources] = await Promise.all([
    supabase
      .from("field_definitions")
      .select("field_key, label, data_type, formula, applies_to"),
    loadSources(supabase),
  ]);
  const rows = (defRows ?? []).map((d) => ({
    field_key: d.field_key as string,
    label: ((d.label as string) ?? (d.field_key as string)),
    data_type: d.data_type as DataType,
    formula: (d.formula as Formula | null) ?? null,
    applies_to: (d.applies_to as string[] | null) ?? null,
  }));

  // Catálogo por-registro SEM self+dependentes — mesmo conjunto do save
  // (serverOperandCatalog em campos/actions.ts).
  const forbidden = input.editingKey
    ? transitiveFormulaDependents(input.editingKey, rows)
    : new Set<string>();
  if (input.editingKey) forbidden.add(input.editingKey);
  const catalog = perRecordCalcOperands(rows, sources).allRefs.filter((o) => {
    const key = refCustomKey(o.ref);
    return key == null || !forbidden.has(key);
  });

  // Resolve a fórmula candidata (mesma semântica do submit).
  let formula: Formula | null = null;
  if (input.formulaMode === "text") {
    const tok = tokenizeFormulaText(input.formulaText ?? "", catalog);
    if (!tok.ok) return { ok: false, message: tok.error };
    formula = tok.formula;
  } else {
    try {
      const parsed = JSON.parse(input.formulaJson ?? "") as Formula;
      if (parsed && Array.isArray(parsed.tokens)) formula = parsed;
    } catch {
      formula = null;
    }
  }
  if (!formula || formula.tokens.length === 0) {
    return { ok: false, message: "Defina a fórmula para ver a prévia." };
  }
  const v = validateFormulaForContext(formula, {
    kind: "record",
    catalog,
    sources,
  });
  if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };

  // Amostra de registros reais (mocks fora), mais recentes primeiro.
  const { data: recData, error: recError } = await supabase
    .from("records")
    .select(RECORD_EVAL_COLUMNS)
    .eq("is_mock", false)
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .limit(PREVIEW_CANDIDATES);
  if (recError) return { ok: false, message: recError.message };
  const sample = (recData ?? []) as RecordEvalRow[];
  if (sample.length === 0) {
    return { ok: false, message: "Nenhum registro para pré-visualizar." };
  }

  // Defs vigentes + a candidata no lugar do campo em edição (aninhamento e
  // dependência funcionam como funcionarão após o save). A prévia avalia como
  // NÚMERO puro — moeda/percentual são formatação do save, não da conta.
  const previewKey = input.editingKey ?? "__preview__";
  const defs = (await loadFormulaDefs(supabase)).filter(
    (d) => d.field_key !== previewKey
  );
  defs.push({
    field_key: previewKey,
    formula,
    currency_mode: null,
    currency_code: null,
    allow_negative: true,
  });

  const materials = await loadRecordEvalMaterials(supabase, defs);
  const matchedByRecord = await resolveMatchedRecords(
    supabase,
    sample.map((r) => ({
      id: r.id,
      related_lead_id: r.related_lead_id as string | null,
    }))
  );

  // Refs da fórmula p/ exibir operandos (até 4) e detectar casado ausente.
  const refs = [...new Set(formulaRefs(formula))];
  const matchSources = [
    ...new Set(
      refs
        .filter((r) => r.startsWith("match:"))
        .map((r) => r.slice("match:".length).split(":")[0])
    ),
  ];
  const labelOf = (ref: string) =>
    catalog.find((o) => o.ref === ref)?.label ?? ref;

  const evaluated = sample.map((r) => {
    const matched = matchedByRecord.get(r.id) ?? {};
    const inputs = buildRecordEvalInputs(r, matched, materials);
    const calc = computeFormulaFields(
      inputs.values,
      inputs.custom,
      defs,
      inputs.conv,
      inputs.dateCtx
    );
    const result = calc[previewKey] ?? null;
    const missing = matchSources.filter((s) => !matched[s]);
    const operands = refs.slice(0, 4).map((ref) => {
      const key = ref.startsWith("custom:") ? ref.slice(7) : null;
      const val =
        ref in inputs.dateCtx
          ? fmtDateMs(inputs.dateCtx[ref])
          : key != null
            ? fmtResult(inputs.custom[key])
            : fmtResult(inputs.values[ref]);
      return { label: labelOf(ref), value: val };
    });
    return {
      row: {
        title: String(r.title ?? "(sem título)"),
        source: sourceLabel(
          // record_type → fonte raiz correspondente (builtin mapeado).
          sources.find((s) => s.recordType === r.record_type && !s.parentKey)
            ?.key ?? String(r.record_type),
          sources
        ),
        operands,
        result: fmtResult(result),
        note:
          missing.length > 0
            ? `sem registro casado de ${missing
                .map((s) => sourceLabel(s, sources))
                .join(", ")}`
            : undefined,
      },
      // Preferir linhas informativas: resultado não-nulo e casados presentes.
      score: (result != null ? 2 : 0) + (missing.length === 0 ? 1 : 0),
    };
  });
  evaluated.sort((a, b) => b.score - a.score);
  return { ok: true, rows: evaluated.slice(0, PREVIEW_ROWS).map((e) => e.row) };
}

export interface MatchStatusResult {
  ok: boolean;
  message?: string;
  // Existe caminho de casamento entre as duas fontes: regra habilitada em
  // match_rules OU o vínculo direto lead→registro (related_lead_id).
  configured: boolean;
  ruleLabel?: string;
  // Nº de pares casados existentes (amostral) — 0 com regra configurada ainda
  // é útil: o auto-match pode não ter rodado.
  pairCount?: number;
}

/** Status do casamento entre duas fontes — usado pela receita "Ciclo de
 *  vendas" para orientar (nunca bloquear) quando a conexão não existe. */
export async function getMatchStatus(
  sourceA: string,
  sourceB: string
): Promise<MatchStatusResult> {
  const denied = await ensureCanManage();
  if (denied) return { ok: false, message: denied, configured: false };
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const rtA = recordTypeOf(sourceA, sources);
  const rtB = recordTypeOf(sourceB, sources);

  const rules = await loadMatchRules(supabase);
  const rule = rules.find(
    (r) =>
      r.enabled &&
      ((r.source_a === rtA && r.source_b === rtB) ||
        (r.source_a === rtB && r.source_b === rtA))
  );
  if (rule) {
    const { count } = await supabase
      .from("record_matches")
      .select("id", { count: "exact", head: true })
      .eq("rule_id", rule.id);
    return {
      ok: true,
      configured: true,
      ruleLabel: rule.label,
      pairCount: count ?? 0,
    };
  }
  // Fallback histórico: leads casam via related_lead_id do outro registro
  // (matching-engine, mesma precedência do RPC 0042).
  if (rtA === "lead" || rtB === "lead") {
    const otherRt = rtA === "lead" ? rtB : rtA;
    const { count } = await supabase
      .from("records")
      .select("id", { count: "exact", head: true })
      .eq("record_type", otherRt)
      .not("related_lead_id", "is", null);
    if ((count ?? 0) > 0) {
      return {
        ok: true,
        configured: true,
        ruleLabel: "vínculo direto com o lead (related_lead_id)",
        pairCount: count ?? 0,
      };
    }
  }
  return { ok: true, configured: false };
}

/** Cobertura de casamento de UMA fonte (a receita "Ciclo de vendas" não sabe a
 *  fonte do registro — o campo materializa para todos): existe ALGUMA regra
 *  habilitada envolvendo a fonte, ou o fallback related_lead_id quando ela é a
 *  fonte de leads. Orienta, nunca bloqueia. */
export async function getMatchCoverage(
  source: string
): Promise<MatchStatusResult> {
  const denied = await ensureCanManage();
  if (denied) return { ok: false, message: denied, configured: false };
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const rt = recordTypeOf(source, sources);

  const rules = await loadMatchRules(supabase);
  const rule = rules.find(
    (r) => r.enabled && (r.source_a === rt || r.source_b === rt)
  );
  if (rule) {
    const { count } = await supabase
      .from("record_matches")
      .select("id", { count: "exact", head: true })
      .eq("rule_id", rule.id);
    return {
      ok: true,
      configured: true,
      ruleLabel: rule.label,
      pairCount: count ?? 0,
    };
  }
  if (rt === "lead") {
    const { count } = await supabase
      .from("records")
      .select("id", { count: "exact", head: true })
      .not("related_lead_id", "is", null);
    if ((count ?? 0) > 0) {
      return {
        ok: true,
        configured: true,
        ruleLabel: "vínculo direto com o lead (related_lead_id)",
        pairCount: count ?? 0,
      };
    }
  }
  return { ok: true, configured: false };
}
