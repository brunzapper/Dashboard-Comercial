// Versão: 1.2 | Data: 01/10/2026
// Tela de Metas (admin) — Fase 6B.
// v1.2 (01/10/2026): seção "Indicadores" (0149) — o catálogo que explica cada
// chave de meta (unidade, total, direção, dono, fórmula do realizado). O
// catálogo do editor de fórmula sai das MESMAS fontes que o servidor usa para
// validar (lib/indicators/validate.ts).
// v1.1 (20/07/2026): seção "Dias não úteis" (non_working_days, 0081) —
// calendário global consumido pelos utilitários de dia útil.
import { createClient } from "@/lib/supabase/server";
import { requireSettingsArea } from "@/lib/auth/access";
import type { OptionItem } from "@/lib/records/types";
import { GoalsManager, type GoalRow } from "@/components/admin/goals-manager";
import { NonWorkingDaysManager } from "@/components/configuracoes/non-working-days-manager";
import { loadNonWorkingDayRows } from "@/lib/config/non-working-days";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadIndicators } from "@/lib/indicators/load";
import { loadManualAxes, loadManualSeries } from "@/lib/manual-base/load";
import type { FieldDefinition } from "@/lib/records/types";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { IndicatorsManager } from "@/components/admin/indicators-manager";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Metas" };

export default async function MetasPage() {
  await requireSettingsArea("metas");
  const supabase = await createClient();
  const orgId = await getActiveOrgId();

  const [
    { data: goalsData },
    { data: ops },
    { data: resps },
    nonWorkingDays,
    goalMetrics,
    indicators,
    sources,
    correspondences,
    { data: fieldsData },
    manualSeries,
    manualAxes,
  ] =
    await Promise.all([
      supabase
        .from("goals")
        .select(
          "id, period_year, period_month, scope, metric, target, operations(name), responsibles(display_name)"
        )
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: true, nullsFirst: true }),
      supabase.from("operations").select("id, name").order("name"),
      supabase.from("responsibles").select("id, display_name").eq("active", true).order("display_name"),
      loadNonWorkingDayRows(supabase),
      loadGoalMetrics(supabase),
      // v1.2 (01/10/2026): catálogo de indicadores + insumos do editor.
      loadIndicators(supabase, orgId),
      loadSources(supabase, orgId),
      loadCorrespondences(supabase, orgId),
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent, options"
        ),
      loadManualSeries(supabase, orgId),
      loadManualAxes(supabase, orgId),
    ]);
  const allFields = (fieldsData ?? []) as FieldDefinition[];

  const goals: GoalRow[] = (goalsData ?? []).map((g) => ({
    id: g.id as string,
    period_year: g.period_year as number,
    period_month: (g.period_month as number) ?? null,
    scope: g.scope as string,
    operation_name: (g.operations as { name?: string } | null)?.name ?? null,
    responsible_name:
      (g.responsibles as { display_name?: string } | null)?.display_name ?? null,
    metric: g.metric as string,
    target: Number(g.target),
  }));

  const operations: OptionItem[] = (ops ?? []).map((o) => ({
    id: o.id as string,
    label: o.name as string,
  }));
  const responsibles: OptionItem[] = (resps ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Metas</h1>
        <p className="text-muted-foreground text-sm">
          Defina metas por período e escopo (global, operação ou responsável).
          Na leitura, elas se comunicam por roll-up (responsáveis → operação → global).
        </p>
      </div>
      <IndicatorsManager
        indicators={indicators}
        responsibles={responsibles}
        catalog={{
          available: buildAvailableFields(allFields, correspondences, sources),
          allFields,
          sources,
          metrics: goalMetrics,
          manualSeries,
          manualAxes,
        }}
      />
      <GoalsManager
        goals={goals}
        operations={operations}
        responsibles={responsibles}
        metrics={goalMetrics}
      />
      <NonWorkingDaysManager rows={nonWorkingDays} />
    </div>
  );
}
