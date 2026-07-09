// Versão: 2.0 | Data: 09/07/2026
// Filtro de período dos dashboards: presets relativos (resolvidos no momento da
// consulta) + intervalo personalizado. Usado em dois lugares:
//  - barra global (searchParams periodo/de/ate/campo);
//  - widget de filtro, com escopo por widget (searchParams pf_<id>/pfd_<id>/
//    pfa_<id>, campo fixo em settings).
// A seleção (URL) cai para um default (config do dashboard/widget) quando
// ausente; o sentinel "all" representa "todo o período" explícito (sobrepõe o
// default). Ao aplicar aos filtros de um widget, substitui os filtros de data
// do próprio widget no mesmo campo.
import type { WidgetFilter } from "./types";

export const PERIOD_PRESETS = {
  hoje: "Hoje",
  ultimos_7: "Últimos 7 dias",
  ultimos_30: "Últimos 30 dias",
  ultimos_90: "Últimos 90 dias",
  esta_semana: "Esta semana",
  semana_passada: "Semana passada",
  este_mes: "Este mês",
  mes_passado: "Mês passado",
  este_trimestre: "Este trimestre",
  este_ano: "Este ano",
  ano_passado: "Ano passado",
} as const;

export type PeriodPresetKey = keyof typeof PERIOD_PRESETS;

export const DEFAULT_PERIOD_FIELD = "closed_at";

// Sentinel de "todo o período" explícito (sobrepõe o default configurado).
export const PERIOD_ALL = "all";

/** Período ativo do dashboard, já resolvido para datas ISO (YYYY-MM-DD). */
export interface DashboardPeriod {
  field: string; // 'closed_at' | 'opened_at' | 'custom:…'
  from: string | null;
  to: string | null;
}

/** Uma seleção de período crua (vinda da URL ou de um default). */
export interface PeriodSelection {
  preset?: string; // chave de PERIOD_PRESETS, PERIOD_ALL, ou ""
  de?: string;
  ate?: string;
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
  const dow = now.getDay(); // 0=domingo
  const mondayOffset = (dow + 6) % 7; // dias desde a última segunda
  switch (preset) {
    case "hoje":
      return { from: iso(now), to: iso(now) };
    case "ultimos_7":
      return { from: iso(new Date(y, m, d - 6)), to: iso(now) };
    case "ultimos_30":
      return { from: iso(new Date(y, m, d - 29)), to: iso(now) };
    case "ultimos_90":
      return { from: iso(new Date(y, m, d - 89)), to: iso(now) };
    case "esta_semana":
      return {
        from: iso(new Date(y, m, d - mondayOffset)),
        to: iso(new Date(y, m, d - mondayOffset + 6)),
      };
    case "semana_passada":
      return {
        from: iso(new Date(y, m, d - mondayOffset - 7)),
        to: iso(new Date(y, m, d - mondayOffset - 1)),
      };
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

/** Uma seleção tem algum valor efetivo (preset ou datas)? */
export function hasSelection(sel: PeriodSelection): boolean {
  return Boolean(sel.preset || sel.de || sel.ate);
}

/**
 * Resolve uma seleção (URL) para um período concreto. Cai para `defaults`
 * quando a seleção está vazia. Preset tem prioridade sobre de/ate. O sentinel
 * PERIOD_ALL (ou nenhum valor sem default) resulta em `null` (sem filtro).
 */
export function resolvePeriodSelection(
  sel: PeriodSelection,
  field: string,
  defaults?: PeriodSelection
): DashboardPeriod | null {
  const eff = hasSelection(sel) ? sel : (defaults ?? {});
  const preset = eff.preset ?? "";
  if (preset === PERIOD_ALL) return null;
  if (preset in PERIOD_PRESETS) {
    const { from, to } = presetRange(preset as PeriodPresetKey);
    return { field, from, to };
  }
  const de = eff.de && DATE_RE.test(eff.de) ? eff.de : null;
  const ate = eff.ate && DATE_RE.test(eff.ate) ? eff.ate : null;
  if (!de && !ate) return null;
  return { field, from: de, to: ate };
}

// Operadores que delimitam o período dentro dos filtros do widget — são os
// que o filtro (global ou por widget) substitui quando atua sobre o mesmo
// campo.
const RANGE_OPS = new Set(["eq", "gt", "gte", "lt", "lte"]);

/**
 * Aplica o período aos filtros de um widget: remove os filtros de intervalo do
 * widget sobre o mesmo campo e anexa os limites. O limite superior inclui o dia
 * inteiro (colunas timestamptz).
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
