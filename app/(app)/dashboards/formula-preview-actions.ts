// Versão: 1.0 | Data: 20/07/2026
// Server action da PRÉVIA de fórmulas AGREGADAS (FormulaEditor nos editores de
// widget e no campo "Calculado — totais do recorte"): valida a fórmula com o
// MESMO catálogo dos editores (buildAggOperandCatalog) e avalia com
// runCalculatedWidget — o choke point de toda métrica calculada (expande
// aninhados, abaixa @fonte, junta fontes dos operandos; invariante 9 — os RPCs
// ficam intocados). Custa 1-3 RPCs como renderizar um widget: o painel do
// editor só chama após o 1º clique (manualStart) e com debounce.
// Roda sem o período da barra do dashboard (o builder não o conhece) — o valor
// volta com um selo dizendo isso; filtros do widget entram.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import {
  buildCorrespondenceMap,
  loadCorrespondences,
} from "@/lib/correspondences";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import type { Formula } from "@/lib/records/formulas";
import type { FieldDefinition } from "@/lib/records/types";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import { loadCurrencyRates, yearQuarterOf } from "@/lib/widgets/currency";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import type { WidgetFilter } from "@/lib/widgets/types";

export interface AggregatePreviewInput {
  // Tokens da fórmula corrente (JSON de Formula).
  formulaJson: string;
  // Fontes efetivas do cálculo (fontes da métrica > fontes do widget; [] =
  // todas as fontes).
  sources: string[];
  // Filtros do widget no estado atual do builder.
  filters?: WidgetFilter[];
  // Formato do resultado (formatação da resposta — a conta é a mesma).
  resultPercent?: boolean;
  resultCurrency?: string | null;
}

export interface AggregatePreviewResult {
  ok: boolean;
  message?: string;
  value?: string;
  badge?: string;
}

export async function previewAggregateFormula(
  input: AggregatePreviewInput
): Promise<AggregatePreviewResult> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  let formula: Formula | null = null;
  try {
    const parsed = JSON.parse(input.formulaJson) as Formula;
    if (parsed && Array.isArray(parsed.tokens)) formula = parsed;
  } catch {
    formula = null;
  }
  if (!formula || formula.tokens.length === 0) {
    return { ok: false, message: "Defina a fórmula para ver a prévia." };
  }

  const [{ data: fieldsData }, correspondences, sources, rates] =
    await Promise.all([
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent"
        ),
      loadCorrespondences(supabase),
      loadSources(supabase),
      loadCurrencyRates(supabase),
    ]);
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences, sources);

  // Mesmo catálogo dos editores (builder único) — a prévia rejeita exatamente
  // o que o save rejeitaria, com as mesmas mensagens.
  const catalog = buildAggOperandCatalog(
    availableAggCatalogInput(available, allFields, sources, {
      withNested: true,
    })
  );
  const v = validateFormulaForContext(formula, {
    kind: "aggregate",
    catalog,
    sources,
  });
  if (!v.ok) return { ok: false, message: v.error ?? "Fórmula inválida." };

  try {
    const res = await runCalculatedWidget(supabase, {
      formula,
      sources: input.sources ?? [],
      sourceDefs: sources,
      filters: input.filters ?? [],
      period: null,
      correspondencesMap: buildCorrespondenceMap(correspondences),
      currencyMode: input.resultCurrency ? "fixed" : "auto",
      currencyCode: input.resultCurrency ?? null,
      fields: allFields,
      rates,
      conversionPeriod: yearQuarterOf(null),
    });
    const badge = "todo o período — a barra do dashboard não entra na prévia";
    if (res.text != null) return { ok: true, value: res.text, badge };
    if (res.value == null) {
      return {
        ok: true,
        value: "—",
        badge:
          "sem valor (operando ausente ou divisão por zero) · " + badge,
      };
    }
    const num = res.value;
    const value = input.resultPercent
      ? `${(num * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
      : res.currency
        ? num.toLocaleString("pt-BR", {
            style: "currency",
            currency: res.currency,
          })
        : num.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    return { ok: true, value, badge };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Falha ao calcular a prévia.",
    };
  }
}
