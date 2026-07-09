// Versão: 1.0 | Data: 08/07/2026
// Filtro de período global do dashboard: presets relativos (resolvidos no
// momento da consulta) + intervalo personalizado via URL (?periodo/de/ate/
// campo). Ao aplicar, substitui os filtros de data do próprio widget no mesmo
// campo — assim presets como "@month_start" passam a obedecer o período
// escolhido em vez de competir com ele.
import type { WidgetFilter } from "./types";

export const PERIOD_PRESETS = {
  hoje: "Hoje",
  ultimos_7: "Últimos 7 dias",
  ultimos_30: "Últimos 30 dias",
  ultimos_90: "Últimos 90 dias",
  este_mes: "Este mês",
  mes_passado: "Mês passado",
  este_trimestre: "Este trimestre",
  este_ano: "Este ano",
  ano_passado: "Ano passado",
} as const;

export type PeriodPresetKey = keyof typeof PERIOD_PRESETS;

export const DEFAULT_PERIOD_FIELD = "closed_at";

/** Período ativo do dashboard, já resolvido para datas ISO (YYYY-MM-DD). */
export interface DashboardPeriod {
  field: string; // 'closed_at' | 'opened_at' | 'custom:…'
  from: string | null;
  to: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(
  preset: PeriodPresetKey,
  now = new Date()
): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (preset) {
    case "hoje":
      return { from: iso(now), to: iso(now) };
    case "ultimos_7":
      return { from: iso(new Date(y, m, d - 6)), to: iso(now) };
    case "ultimos_30":
      return { from: iso(new Date(y, m, d - 29)), to: iso(now) };
    case "ultimos_90":
      return { from: iso(new Date(y, m, d - 89)), to: iso(now) };
    case "este_mes":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "mes_passado":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "este_trimestre": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case "este_ano":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    case "ano_passado":
      return {
        from: iso(new Date(y - 1, 0, 1)),
        to: iso(new Date(y - 1, 11, 31)),
      };
  }
}

/**
 * Interpreta os searchParams do dashboard. Preset tem prioridade sobre
 * de/ate; sem nenhum dos dois, não há período ativo (null).
 */
export function resolvePeriod(params: {
  periodo?: string;
  de?: string;
  ate?: string;
  campo?: string;
}): DashboardPeriod | null {
  const field = params.campo || DEFAULT_PERIOD_FIELD;
  const periodo = params.periodo ?? "";
  if (periodo in PERIOD_PRESETS) {
    const { from, to } = presetRange(periodo as PeriodPresetKey);
    return { field, from, to };
  }
  const de = params.de && DATE_RE.test(params.de) ? params.de : null;
  const ate = params.ate && DATE_RE.test(params.ate) ? params.ate : null;
  if (!de && !ate) return null;
  return { field, from: de, to: ate };
}

// Operadores que delimitam o período dentro dos filtros do widget — são os
// que o filtro global substitui quando atua sobre o mesmo campo.
const RANGE_OPS = new Set(["eq", "gt", "gte", "lt", "lte"]);

/**
 * Aplica o período global aos filtros de um widget: remove os filtros de
 * intervalo do widget sobre o mesmo campo e anexa os limites globais. O
 * limite superior inclui o dia inteiro (colunas timestamptz).
 */
export function applyPeriodToFilters(
  filters: WidgetFilter[],
  period: DashboardPeriod
): WidgetFilter[] {
  const next = filters.filter(
    (f) => !(f.field === period.field && RANGE_OPS.has(f.op))
  );
  if (period.from) next.push({ field: period.field, op: "gte", value: period.from });
  if (period.to)
    next.push({ field: period.field, op: "lte", value: `${period.to}T23:59:59` });
  return next;
}
