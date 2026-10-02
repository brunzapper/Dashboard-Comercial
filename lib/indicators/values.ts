// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): FONTE DO REALIZADO por pedido (lib/indicators/
//   realized-source.ts). Cada pedido pode trazer `realized`: a fórmula do
//   catálogo (padrão), uma métrica calculada PRÓPRIA, recortes por dimensão e
//   uma QUEBRA por dimensão. A fórmula segue pelo `runCalculatedWidget`; a
//   quebra pelo `runWidget` com a métrica ad-hoc calculada (`calc:formula`,
//   o mesmo caminho das métricas calculadas do construtor) — RPCs INTOCADAS.
//   Pedido sem indicador (`key: ""`) é só realizado: sem meta, sem status.
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
import { runWidget } from "@/lib/widgets/engine";
import { buildAvailableFields } from "@/lib/widgets/fields";
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
import {
  DEFAULT_BREAKDOWN_LIMIT,
  effectiveRealized,
  type RealizedSource,
} from "./realized-source";

export interface IndicatorCell {
  month: string; // YYYY-MM
  target: number | null;
  realized: number | null;
  attainment: number | null;
  status: IndicatorStatus;
  /** Fração decorrida do mês por dia útil (0 futuro … 1 fechado). */
  elapsed: number;
}

/** v1.1: uma linha da quebra do realizado (um valor da dimensão). */
export interface IndicatorBreakdownRow {
  label: string;
  /** Realizado por mês (alinhado com `cells`); null = sem dado/futuro. */
  realized: (number | null)[];
  total: number | null;
}

export interface IndicatorSeries {
  key: string;
  /** v1.1: id do pedido (quem pediu casa a resposta por ele). */
  id?: string;
  /** v1.1: há fórmula de realizado efetiva (catálogo ou própria). */
  hasRealized: boolean;
  /** v1.1: quebra do realizado por dimensão (quando pedida). */
  breakdown?: IndicatorBreakdownRow[];
  /** Escopo da série ("global" ou o id canônico do responsável). */
  responsibleId: string | null;
  cells: IndicatorCell[];
  total: { target: number | null; realized: number | null; attainment: number | null };
  /** Por mês, o erro da consulta do realizado (ausente = ok). */
  errors?: Record<string, string>;
}

export interface IndicatorRequest {
  /** Chave do indicador/meta; "" = só realizado (sem meta). */
  key: string;
  responsibleId?: string | null;
  /** v1.1: id devolvido na série (vários pedidos da mesma chave). */
  id?: string;
  /** v1.1: fonte do realizado; ausente = a fórmula do catálogo. */
  realized?: RealizedSource | null;
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
  const effOf = (r: IndicatorRequest) =>
    effectiveRealized(opts.indicators.get(r.key) ?? null, r.realized);
  const needsQueries =
    withRealized && opts.requests.some((r) => effOf(r) != null);

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
  // v1.1: a quebra roda pelo runWidget, que precisa do catálogo de campos.
  const needsAvailable = withRealized && opts.requests.some((r) => effOf(r)?.breakdown);
  const available = needsAvailable
    ? buildAvailableFields(allFields, correspondences, sources)
    : [];
  const runLimited = createTaskLimiter(WIDGET_TASK_CONCURRENCY);

  return Promise.all(
    opts.requests.map(async (req): Promise<IndicatorSeries> => {
      const def = opts.indicators.get(req.key) ?? null;
      const eff = effOf(req);
      const responsibleId = req.responsibleId ?? null;
      const errors: Record<string, string> = {};
      const respFilter: WidgetFilter[] = responsibleId
        ? [{ field: "responsible_id", op: "eq" as const, value: responsibleId }]
        : [];
      const currencyMode = def ? (def.unit === "moeda" ? "fixed" : "none") : "auto";
      const cells = await Promise.all(
        months.map(async ({ key: mk, p }) => {
          const elapsed = monthElapsed(p.year, p.month, opts.todayIso, holidays);
          const [goal, realized] = await Promise.all([
            req.key
              ? resolveGoal(supabase, {
                  scope: responsibleId ? "responsible" : "global",
                  responsibleId,
                  year: p.year,
                  month: p.month,
                  metric: req.key,
                }).catch(() => ({ target: null }))
              : Promise.resolve({ target: null }),
            // Mês futuro não tem realizado — e consultá-lo é custo à toa.
            eff && withRealized && elapsed > 0
              ? runLimited(async () => {
                  const period = monthPeriod(p.year, p.month, sources);
                  const filters: WidgetFilter[] = [...eff.filters, ...respFilter];
                  try {
                    const res = await runCalculatedWidget(rpcClient, {
                      formula: eff.formula,
                      sources: eff.sources,
                      sourceDefs: sources,
                      filters,
                      period,
                      correspondences,
                      currencyMode,
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

      // v1.1: QUEBRA do realizado por dimensão — mês a mês, pelo runWidget
      // com a métrica calculada ad-hoc (mesmo período/recorte da célula).
      let breakdown: IndicatorBreakdownRow[] | undefined;
      if (eff?.breakdown && withRealized) {
        const bd = eff.breakdown;
        const perMonth = await Promise.all(
          months.map(async ({ p }, mi) => {
            if ((cells[mi]?.elapsed ?? 0) <= 0) return null;
            return runLimited(async () => {
              const period = monthPeriod(p.year, p.month, sources);
              try {
                const data = await runWidget(
                  rpcClient,
                  {
                    source: "records",
                    sources: eff.sources,
                    splitBySource: false,
                    dimensions: [
                      { field: bd.field, ...(bd.transform ? { transform: bd.transform } : {}) },
                    ],
                    metrics: [{ field: "calc:formula", agg: "sum", calc: true, formula: eff.formula }],
                    filters: [...eff.filters, ...respFilter],
                    visual_type: "tabela",
                    settings: {},
                  },
                  available,
                  period,
                  allFields,
                  rates,
                  yearQuarterOf(period.to),
                  sources,
                  correspondences
                );
                const m = new Map<string, number>();
                for (const row of data.rows) {
                  const label = String(row.dim_1 ?? "—");
                  const v = Number(row.metric_1);
                  if (Number.isFinite(v)) m.set(label, (m.get(label) ?? 0) + v);
                }
                return m;
              } catch {
                return null;
              }
            });
          })
        );
        breakdown = breakdownRows(perMonth, rollup, bd.limit ?? DEFAULT_BREAKDOWN_LIMIT);
      }
      return {
        key: req.key,
        ...(req.id ? { id: req.id } : {}),
        hasRealized: eff != null,
        ...(breakdown ? { breakdown } : {}),
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

/**
 * v1.1: monta as linhas da quebra — os `limit` valores de maior total; o
 * resto soma em "Outros" (a quebra é de uma QUANTIDADE: somar é o natural; em
 * razão as partes não fecham o total, e o card não promete isso).
 */
export function breakdownRows(
  perMonth: (Map<string, number> | null)[],
  rollup: Parameters<typeof rollupMonths>[1],
  limit: number
): IndicatorBreakdownRow[] {
  const labels = new Map<string, number>();
  for (const m of perMonth) {
    if (!m) continue;
    for (const [k, v] of m) labels.set(k, (labels.get(k) ?? 0) + Math.abs(v));
  }
  const ordered = [...labels.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const top = ordered.slice(0, limit);
  const rest = ordered.slice(limit);
  const row = (label: string, keys: string[]): IndicatorBreakdownRow => {
    const realized = perMonth.map((m) => {
      if (!m) return null;
      let sum: number | null = null;
      for (const k of keys) {
        const v = m.get(k);
        if (v != null) sum = (sum ?? 0) + v;
      }
      return sum ?? 0;
    });
    return { label, realized, total: rollupMonths(realized, rollup) };
  };
  const out = top.map((k) => row(k, [k]));
  if (rest.length > 0) out.push(row("Outros", rest));
  return out;
}
