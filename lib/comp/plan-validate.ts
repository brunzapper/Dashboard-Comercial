// Versão: 1.0 | Data: 08/09/2026
// Validação de um SAVE de plano de remuneração, EXTRAÍDA de savePlan
// (app/(app)/operacao/remuneracao/actions.ts) sem mudança de comportamento.
//
// Por que extrair: o parse fail-closed de lib/comp/model.ts é muralha
// ESTRUTURAL contra jsonb adulterado, mas desconhece o banco. Passam por ele e
// quebram em produção: fonte inexistente, campo de membro de OUTRA fonte
// (realizado 0 em silêncio), filtro em `operation_id` (coluna derivada),
// fórmula com ref morta, moeda desabilitada, rótulos de fator duplicados. Essas
// checagens moravam INLINE no savePlan, misturadas com a escrita — então
// qualquer segundo consumidor (a prévia do assistente de IA de remuneração)
// teria de repeti-las, que é exatamente a régua paralela que a invariante 25
// proíbe. Precedente literal: `PROFILE_OPS`/`NO_VALUE_OPS` de
// lib/config/operation-profile.ts, extraídos do choke point para o validador da
// IA de operações.
//
// O savePlan continua sendo a MURALHA (ele chama isto antes de escrever); este
// módulo existe para que a prévia use a MESMA régua e possa devolver mensagens
// por fator ao laço de autocorreção — o parse cru só sabe dizer "Configuração
// do plano inválida", inútil para uma IA corrigir.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import { goalMetricKeyFromLabel } from "@/lib/metas/metrics";
import type { GoalMetricDef } from "@/lib/metas/metrics";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import { validateFkCondNames } from "@/lib/records/formula-server";
import { formulaUsesCondAgg } from "@/lib/records/formulas";
import type { FieldDefinition } from "@/lib/records/types";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { opHasNoValue } from "@/lib/widgets/filter-ops";
import {
  compOperandCatalog,
  factorTargetCurrencies,
  parseCompPlanConfig,
  type CompPlanConfig,
} from "@/lib/comp/model";
import { memberFieldSourceError } from "@/lib/comp/member-field";

// ---------------------------------------------------------------- constantes
// Bounds "amigáveis" pós-parse. Eram literais no meio da action; exportados
// para que o SPEC do assistente de IA possa DERIVÁ-los (e o teste de paridade
// tenha o que fiscalizar) em vez de repeti-los em prosa.

/** Teto de sanidade de qualquer valor digitado (override, bônus, base, alvo). */
export const MAX_ABS_VALUE = 1e12;
/** Peso de fator, em pontos percentuais (Σ não precisa dar 100). */
export const MAX_WEIGHT_PCT = 1000;
/** Limiar de faixa com `tierBy: "attainment"` — atingimento em %. */
export const MAX_TIER_ATTAINMENT_PCT = 100000;
/** Percentual de uma faixa `kind: "pct"`. */
export const MAX_TIER_RATE_PCT = 1000;
/** Sentinela de metricKey: o SERVIDOR gera a chave a partir do rótulo. */
export const AUTO_METRIC_KEY = "__auto__";

/** Sanidade dos valores digitados — mesma régua do `cleanNumber` da action. */
export function cleanCompNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (Math.abs(v) >= MAX_ABS_VALUE) return null;
  return v;
}

export interface CompPlanSaveInput {
  name: string;
  /** CompPlanConfig CRU — re-parseado fail-closed aqui. */
  config: unknown;
}

export type CompPlanValidation =
  | {
      ok: true;
      /** Nome já normalizado (trim). */
      name: string;
      /** Config PARSEADA, com `metricKey: "__auto__"` já resolvido. */
      config: CompPlanConfig;
      /** Chaves a garantir no registry (o caller chama registerGoalMetrics). */
      metricDefs: GoalMetricDef[];
    }
  | { ok: false; message: string };

/**
 * Roda TODA a validação de um save de plano. Faz I/O (catálogo de campos,
 * fontes, moedas, operações, registry) pelo client recebido — que é sempre o
 * do USUÁRIO: a RLS recorta a org, e id de outra org conta como "não
 * encontrado".
 *
 * Mutação consciente: a config devolvida tem `metricKey` resolvido no lugar do
 * sentinela — é ela que vai para o banco.
 */
export async function validateCompPlanSave(
  supabase: SupabaseClient,
  orgId: string | null,
  input: CompPlanSaveInput
): Promise<CompPlanValidation> {
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, message: "Informe o nome do plano." };

  const config = parseCompPlanConfig(input.config);
  if (!config) return { ok: false, message: "Configuração do plano inválida." };
  if (config.factors.length === 0)
    return { ok: false, message: "Adicione ao menos um fator." };

  // Rótulos únicos (case-insensitive): o FormulaEditor referencia operandos por
  // rótulo — duplicata quebraria o round-trip da fórmula livre.
  const labels = new Set<string>();
  for (const f of config.factors) {
    const k = f.label.toLocaleLowerCase("pt-BR");
    if (labels.has(k))
      return {
        ok: false,
        message: `Dois fatores com o mesmo nome ("${f.label}") — renomeie um.`,
      };
    labels.add(k);
    if (f.weightPct < 0 || f.weightPct > MAX_WEIGHT_PCT)
      return { ok: false, message: `Peso inválido no fator "${f.label}".` };
  }

  // Faixas de comissão: bounds amigáveis pós-parse, por kind e por unidade do
  // tierBy (estrutura/ordenação/refs já são muralha do parse fail-closed —
  // espelho do check de peso acima). Vale p/ a tabela do plano E as por membro.
  for (const block of config.commissions ?? []) {
    const tables = [block.tiers, ...Object.values(block.memberTiers ?? {})];
    const fromMax =
      (block.tierBy ?? "attainment") === "attainment"
        ? MAX_TIER_ATTAINMENT_PCT
        : MAX_ABS_VALUE;
    for (const table of tables) {
      for (const t of table) {
        if (t.fromPct > fromMax)
          return {
            ok: false,
            message: "Faixa de comissão inválida (limiar acima do limite).",
          };
        if ((block.kind ?? "pct") === "pct" && (t.ratePct ?? 0) > MAX_TIER_RATE_PCT)
          return {
            ok: false,
            message: "Faixa de comissão inválida (percentual acima do limite).",
          };
        if ((block.kind ?? "pct") !== "pct" && (t.amount ?? 0) >= MAX_ABS_VALUE)
          return {
            ok: false,
            message: "Faixa de comissão inválida (valor acima do limite).",
          };
      }
    }
  }

  // Operações vinculadas ao plano devem existir (RLS recorta a org — id de
  // outra org conta como "não encontrada"); mensagem acionável em vez do
  // silêncio de uma operação fantasma contribuindo zero membros.
  if (config.memberOperationIds?.length) {
    const { data: opRows } = await supabase
      .from("operations")
      .select("id")
      .in("id", config.memberOperationIds);
    const found = new Set(((opRows ?? []) as { id: string }[]).map((o) => o.id));
    if (config.memberOperationIds.some((id) => !found.has(id)))
      return {
        ok: false,
        message:
          "Operação vinculada ao plano não encontrada (removida?) — reabra o seletor de operações e salve novamente.",
      };
  }

  const [sources, correspondences, { data: fieldsData }, registry] =
    await Promise.all([
      loadSources(supabase, orgId),
      loadCorrespondences(supabase, orgId),
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent"
        ),
      loadGoalMetrics(supabase),
    ]);
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences, sources);
  const sourceKeys = new Set(sources.map((s) => s.key));

  // Fórmula do realizado: MESMO catálogo/validação do servidor de fórmulas
  // agregadas (nunca montar catálogo paralelo).
  const aggCatalog = buildAggOperandCatalog(
    availableAggCatalogInput(available, allFields, sources, registry, {
      withNested: true,
    })
  );
  // Moedas habilitadas p/ targetCurrency (uma consulta, fora do loop).
  const usedCurrencies = factorTargetCurrencies(config);
  if (usedCurrencies.length > 0) {
    const { data: curData } = await supabase
      .from("currencies")
      .select("code")
      .eq("enabled", true);
    const enabled = new Set(
      ((curData ?? []) as { code: string }[]).map((c) => c.code)
    );
    for (const code of usedCurrencies) {
      if (!enabled.has(code))
        return {
          ok: false,
          message: `Moeda de alvo "${code}" não está habilitada (Campos → Moedas).`,
        };
    }
  }

  const availableByRef = new Map(available.map((a) => [a.field, a]));
  for (const f of config.factors) {
    for (const s of f.sources) {
      if (!sourceKeys.has(s))
        return {
          ok: false,
          message: `Fonte desconhecida ("${s}") no fator "${f.label}".`,
        };
    }
    // Campo de membro: precisa existir no catálogo e ser filtrável por texto
    // (numérico/data/sintético/agregado não identificam pessoa).
    if (f.memberField) {
      const af = availableByRef.get(f.memberField);
      if (!af || af.isNumeric || af.isDate || af.displayOnly || af.aggCalc)
        return {
          ok: false,
          message: `Campo de membro inválido no fator "${f.label}" — escolha um campo de texto/seleção do registro.`,
        };
      // ... e existir nas fontes EFETIVAS do fator (campo de OUTRA fonte
      // salvaria e computaria 0 em silêncio — o filtro injetado nunca casa).
      const mfErr = memberFieldSourceError(f, allFields, sources);
      if (mfErr) return { ok: false, message: mfErr };
    }
    // Condições do recorte: campo do catálogo (numérico/data valem — comparam
    // valor) e valor presente nos ops com valor. Operação fica FORA: a coluna
    // derivada pode estar NULL e a tradução viva de operação não passa aqui.
    for (const flt of f.filters ?? []) {
      if (flt.field === "operation_id")
        return {
          ok: false,
          message: `Condição do fator "${f.label}": Operação não é filtrável aqui — filtre por responsável ou por um campo do registro.`,
        };
      const af = availableByRef.get(flt.field);
      if (!af || af.displayOnly || af.aggCalc)
        return {
          ok: false,
          message: `Condição do fator "${f.label}": campo desconhecido ("${flt.field}").`,
        };
      if (!opHasNoValue(flt.op)) {
        const empty = Array.isArray(flt.value)
          ? flt.value.length === 0
          : String(flt.value ?? "").trim() === "";
        if (empty)
          return {
            ok: false,
            message: `Condição do fator "${f.label}": informe o valor do filtro.`,
          };
      }
    }
    if (f.defaultTarget != null && cleanCompNumber(f.defaultTarget) == null)
      return {
        ok: false,
        message: `Alvo padrão inválido no fator "${f.label}".`,
      };
    const v = validateFormulaForContext(f.formula, {
      kind: "aggregate",
      catalog: aggCatalog,
      sources,
    });
    if (!v.ok)
      return {
        ok: false,
        message: `Fórmula do fator "${f.label}": ${v.error ?? "inválida."}`,
      };
    const fk = await validateFkCondNames(supabase, f.formula);
    if (!fk.ok)
      return {
        ok: false,
        message: `Fórmula do fator "${f.label}": ${fk.message}`,
      };
  }

  // Chave de métrica de meta: vazia ⇒ automática a partir do rótulo (sufixo em
  // colisão com o registry OU com outro fator do próprio plano).
  const usedKeys = new Set(registry.map((m) => m.key));
  for (const f of config.factors) {
    if (f.metricKey !== AUTO_METRIC_KEY) {
      usedKeys.add(f.metricKey);
      continue;
    }
    const base = `comp_${goalMetricKeyFromLabel(f.label) || "fator"}`.slice(0, 40);
    let candidate = base;
    for (let n = 2; usedKeys.has(candidate) && n <= 20; n++) {
      const suffix = `_${n}`;
      candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    }
    if (usedKeys.has(candidate))
      return {
        ok: false,
        message: `Não foi possível gerar a chave de meta do fator "${f.label}".`,
      };
    f.metricKey = candidate;
    usedKeys.add(candidate);
  }

  // Fórmula LIVRE de total: catálogo comp:* derivado do config (aparece/some
  // em sincronia com os fatores) — kind "record" (variáveis escalares; nada de
  // agg:/SOMASE aqui — as variáveis JÁ são totais).
  if (config.totalFormula) {
    if (formulaUsesCondAgg(config.totalFormula))
      return {
        ok: false,
        message:
          "SOMASE/CONTASE não funcionam na fórmula do total — as variáveis já são totais; condicione com SE(...).",
      };
    const v = validateFormulaForContext(config.totalFormula, {
      kind: "record",
      catalog: compOperandCatalog(config),
    });
    if (!v.ok)
      return {
        ok: false,
        message: `Fórmula do total: ${v.error ?? "inválida."}`,
      };
  }

  return {
    ok: true,
    name,
    config,
    // Rótulo "Plano — Fator"; o registerGoalMetrics pula as existentes (nunca
    // sobrescreve métrica em uso).
    metricDefs: config.factors.map((f) => ({
      key: f.metricKey,
      label: `${name} — ${f.label}`.slice(0, 60),
      money: f.money,
    })),
  };
}
