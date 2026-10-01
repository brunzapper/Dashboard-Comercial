// Versão: 1.0 | Data: 01/10/2026
// Valores dos INDICADORES por mês: meta × realizado × atingimento × status.
//
// Dono ÚNICO da leitura consumida pela Tabela de metas e pelos nós de
// indicador da Tree. Duas fontes, nenhuma nova:
//   * META      — `resolveGoal` por mês (explicit-first + roll-up,
//                 lib/metas/resolve.ts). É o que faz "a operação segue as metas
//                 oficiais do painel": a linha global explícita VENCE a soma
//                 das metas individuais.
//   * REALIZADO — `runCalculatedWidget` por mês com `monthPeriod` (molde exato
//                 do lib/comp/engine.ts). `manual:`/`meta:`/operandos com
//                 escopo funcionam porque passam pelo MESMO choke point; as
//                 RPCs de widget ficam INTOCADAS.
// Falha de UMA célula isola (null + erro), nunca derruba a tabela e nunca
// fabrica 0.
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadNonWorkingDays } from "@/lib/config/non-working-days";
import { monthPeriod } from "@/lib/comp/model";
import {
  businessDayIndexInMonth,
  businessDaysInMonth,
  daysInMonth,
} from "@/lib/date/business-days";
import { resolveGoal } from "@/lib/metas/resolve";
import type { FieldDefinition } from "@/lib/records/types";
import { loadCurrencyRates, yearQuarterOf } from "@/lib/widgets/currency";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import {
  createTaskLimiter,
  WIDGET_TASK_CONCURRENCY,
} from "@/lib/widgets/task-limiter";
import type { WidgetFilter } from "@/lib/widgets/types";

import {
  attainment,
  indicatorStatus,
  parseMonthKey,
  rollupMonths,
  type IndicatorDef,
  type IndicatorStatus,
} from "./model";

export interface IndicatorCell {
  month: string; // YYYY-MM
  target: number | null;
  realized: number | null;
  attainment: number | null;
  status: IndicatorStatus;
  /** Fração decorrida do mês por dia útil (0 futuro … 1 fechado). */
  elapsed: number;
}

export interface IndicatorSeries {
  key: string;
  /** Escopo da série ("global" ou o id canônico do responsável). */
  responsibleId: string | null;
  cells: IndicatorCell[];
  total: { target: number | null; realized: number | null; attainment: number | null };
  /** Por mês, o erro da consulta do realizado (ausente = ok). */
  errors?: Record<string, string>;
}

export interface IndicatorRequest {
  key: string;
  responsibleId?: string | null;
}

/**
 * Quanto do mês já passou, por DIA ÚTIL (a régua do resto do app: goalLine
 * "pace", businessDayAlign). Fechado = 1; futuro = 0.
 */
export function monthElapsed(
  year: number,
  month: number,
  todayIso: string,
  holidays: Set<string>
): number {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const today = todayIso.slice(0, 7);
  if (ym < today) return 1;
  if (ym > today) return 0;
  const total = businessDaysInMonth(year, month, holidays);
  if (total === 0) {
    const d = Number(todayIso.slice(8, 10));
    return d / daysInMonth(year, month);
  }
  return businessDayIndexInMonth(todayIso, holidays) / total;
}

/**
 * Resolve as séries pedidas. `supabase` = client RLS (tabelas, metas);
 * `rpcClient` = o mesmo client com memo/TTL (consultas de widget).
 */
export async function resolveIndicatorValues(
  supabase: SupabaseClient,
  rpcClient: SupabaseClient,
  opts: {
    orgId: string | null;
    indicators: Map<string, IndicatorDef>;
    requests: IndicatorRequest[];
    months: string[];
    todayIso: string;
    /** Pular o realizado (tabela só de metas): zero consulta de widget. */
    withRealized?: boolean;
  }
): Promise<IndicatorSeries[]> {
  const months = opts.months
    .map((m) => ({ key: m, p: parseMonthKey(m) }))
    .filter((m): m is { key: string; p: { year: number; month: number } } => m.p != null);
  const withRealized = opts.withRealized !== false;
  const needsQueries =
    withRealized &&
    opts.requests.some((r) => opts.indicators.get(r.key)?.realized != null);

  const [sources, correspondences, fieldsRes, rates, holidays] = await Promise.all([
    needsQueries ? loadSources(supabase, opts.orgId) : Promise.resolve([]),
    needsQueries ? loadCorrespondences(supabase, opts.orgId) : Promise.resolve([]),
    needsQueries
      ? supabase
          .from("field_definitions")
          .select(
            "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent"
          )
      : Promise.resolve({ data: [] as unknown[] }),
    needsQueries ? loadCurrencyRates(supabase, opts.orgId) : Promise.resolve({}),
    loadNonWorkingDays(supabase),
  ]);
  const allFields = ((fieldsRes as { data: unknown[] | null }).data ??
    []) as FieldDefinition[];
  const runLimited = createTaskLimiter(WIDGET_TASK_CONCURRENCY);

  return Promise.all(
    opts.requests.map(async (req): Promise<IndicatorSeries> => {
      const def = opts.indicators.get(req.key) ?? null;
      const responsibleId = req.responsibleId ?? null;
      const errors: Record<string, string> = {};
      const cells = await Promise.all(
        months.map(async ({ key: mk, p }) => {
          const elapsed = monthElapsed(p.year, p.month, opts.todayIso, holidays);
          const [goal, realized] = await Promise.all([
            resolveGoal(supabase, {
              scope: responsibleId ? "responsible" : "global",
              responsibleId,
              year: p.year,
              month: p.month,
              metric: req.key,
            }).catch(() => ({ target: null })),
            // Mês futuro não tem realizado — e consultá-lo é custo à toa.
            def?.realized && withRealized && elapsed > 0
              ? runLimited(async () => {
                  const period = monthPeriod(p.year, p.month, sources);
                  const filters: WidgetFilter[] = [
                    ...def.realized!.filters,
                    ...(responsibleId
                      ? [{ field: "responsible_id", op: "eq" as const, value: responsibleId }]
                      : []),
                  ];
                  try {
                    const res = await runCalculatedWidget(rpcClient, {
                      formula: def.realized!.formula,
                      sources: def.realized!.sources,
                      sourceDefs: sources,
                      filters,
                      period,
                      correspondences,
                      currencyMode: def.unit === "moeda" ? "fixed" : "none",
                      currencyCode: "BRL",
                      allowNegative: true,
                      fields: allFields,
                      rates,
                      conversionPeriod: yearQuarterOf(period.to),
                    });
                    return res.value;
                  } catch (e) {
                    errors[mk] = e instanceof Error ? e.message : "Falha na consulta.";
                    return null;
                  }
                })
              : Promise.resolve(null),
          ]);
          const target = goal.target;
          const cell: IndicatorCell = {
            month: mk,
            target,
            realized,
            attainment: def ? attainment(realized, target, def.direction) : null,
            status: def
              ? indicatorStatus(realized, target, def, { elapsed })
              : "sem_dado",
            elapsed,
          };
          return cell;
        })
      );
      const rollup = def?.rollup ?? "soma";
      const tTarget = rollupMonths(cells.map((c) => c.target), rollup);
      const tRealized = rollupMonths(cells.map((c) => c.realized), rollup);
      return {
        key: req.key,
        responsibleId,
        cells,
        total: {
          target: tTarget,
          realized: tRealized,
          attainment: def ? attainment(tRealized, tTarget, def.direction) : null,
        },
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      };
    })
  );
}
