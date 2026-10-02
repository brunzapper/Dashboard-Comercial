// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): FONTE DO REALIZADO — módulo PURO e client-safe,
//   compartilhado pelos nós de indicador da Tree e pelas linhas de meta da
//   Tabela Livre.
//
// O realizado de um indicador vinha SÓ da fórmula do catálogo (Configurações →
// Metas → Indicadores) e nenhuma tela dizia isso — o card mostrava um "Real"
// que ninguém sabia de onde saía nem conseguia trocar. Agora quem exibe o
// indicador pode:
//   * manter a fórmula do catálogo (padrão — ausência de `override`);
//   * trocar por QUALQUER métrica calculada agregada (`override`: fórmula do
//     MESMO catálogo de operandos do construtor + bases);
//   * recortar por dimensão (`filters`, AND sobre a base) — cada recorte pode
//     aparecer no card como etiqueta (`exposed`) ou ficar oculto;
//   * quebrar o realizado por uma dimensão (`breakdown`) — sub-linhas abertas
//     ("exposto") ou recolhidas atrás de um "▸ por <dimensão>".
// Tudo se resolve no ENGINE (lib/indicators/values.ts): a fórmula vai ao
// `runCalculatedWidget` e a quebra ao `runWidget` com a métrica ad-hoc
// calculada — as RPCs de widget ficam INTOCADAS. A validação semântica
// (catálogo/campos) é do servidor (lib/indicators/validate.ts); aqui só o
// contrato estrutural, fail-closed.
import type { Formula } from "@/lib/records/formulas";
import type { SourceKey } from "@/lib/sources";
import { parseUiFilter } from "@/lib/comp/model";
import { TRANSFORM_LABELS, type Transform, type WidgetFilter } from "@/lib/widgets/types";

import {
  MAX_INDICATOR_FILTERS,
  MAX_INDICATOR_FORMULA_TOKENS,
  type IndicatorDef,
} from "./model";

export const MAX_BREAKDOWN_LIMIT = 20;
export const DEFAULT_BREAKDOWN_LIMIT = 8;

export interface RealizedFilter extends WidgetFilter {
  /** Mostrar o recorte como etiqueta no card ("Responsável: Gabriella"). */
  exposed?: boolean;
}

export interface RealizedBreakdown {
  field: string;
  transform?: Transform;
  /** "exposto" = sub-linhas abertas; "recolhido" = atrás de "▸ por …". */
  display: "exposto" | "recolhido";
  /** Quantos valores (os maiores); o resto vira "Outros". */
  limit?: number;
}

export interface RealizedSource {
  v: 1;
  /** Ausente = a fórmula do catálogo de indicadores. */
  override?: { formula: Formula; formulaText?: string; sources: SourceKey[] };
  filters?: RealizedFilter[];
  breakdown?: RealizedBreakdown;
}

/** O que a consulta do realizado efetivamente usa. */
export interface EffectiveRealized {
  formula: Formula;
  sources: SourceKey[];
  filters: WidgetFilter[];
  breakdown?: RealizedBreakdown;
  /** true = fórmula própria (não a do catálogo). */
  own: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseFormula(raw: unknown): Formula | null {
  if (!isRecord(raw) || !Array.isArray(raw.tokens)) return null;
  if (raw.tokens.length === 0 || raw.tokens.length > MAX_INDICATOR_FORMULA_TOKENS) return null;
  if (!raw.tokens.every((t) => isRecord(t) && typeof t.kind === "string")) return null;
  const out: Formula = { tokens: raw.tokens as Formula["tokens"] };
  if (typeof raw.source === "string") out.source = raw.source;
  return out;
}

/** Parse FAIL-CLOSED: jsonb adulterado ⇒ null (o chamador usa o padrão). */
export function parseRealizedSource(raw: unknown): RealizedSource | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const out: RealizedSource = { v: 1 };
  if (raw.override !== undefined) {
    if (!isRecord(raw.override)) return null;
    const formula = parseFormula(raw.override.formula);
    if (!formula) return null;
    const src = raw.override.sources;
    const sources = Array.isArray(src)
      ? src.filter((s): s is string => typeof s === "string" && s !== "")
      : [];
    if (Array.isArray(src) && sources.length !== src.length) return null;
    out.override = { formula, sources };
    if (typeof raw.override.formulaText === "string" && raw.override.formulaText.trim())
      out.override.formulaText = raw.override.formulaText;
  }
  if (raw.filters !== undefined) {
    if (!Array.isArray(raw.filters) || raw.filters.length > MAX_INDICATOR_FILTERS) return null;
    const filters: RealizedFilter[] = [];
    for (const f of raw.filters) {
      const parsed = parseUiFilter(f);
      if (!parsed) return null;
      filters.push(isRecord(f) && f.exposed === true ? { ...parsed, exposed: true } : parsed);
    }
    if (filters.length > 0) out.filters = filters;
  }
  if (raw.breakdown !== undefined) {
    const b = raw.breakdown;
    if (!isRecord(b) || typeof b.field !== "string" || !b.field) return null;
    const bd: RealizedBreakdown = {
      field: b.field,
      display: b.display === "recolhido" ? "recolhido" : "exposto",
    };
    if (typeof b.transform === "string" && b.transform !== "none" && b.transform in TRANSFORM_LABELS) {
      bd.transform = b.transform as Transform;
    }
    const lim = Number(b.limit);
    if (Number.isInteger(lim) && lim >= 1 && lim <= MAX_BREAKDOWN_LIMIT) bd.limit = lim;
    out.breakdown = bd;
  }
  return out;
}

/** A fonte é o padrão puro (nada configurado)? */
export function isDefaultRealized(rs: RealizedSource | null | undefined): boolean {
  return !rs || (!rs.override && !rs.filters?.length && !rs.breakdown);
}

/**
 * Fórmula, bases e recorte efetivos. Sem override, a do indicador (com os
 * filtros dele) + os recortes extras; com override, a própria. Sem fórmula em
 * lugar nenhum ⇒ null (o indicador é só meta/premissa).
 */
export function effectiveRealized(
  def: Pick<IndicatorDef, "realized"> | null | undefined,
  rs: RealizedSource | null | undefined
): EffectiveRealized | null {
  const extra: WidgetFilter[] = (rs?.filters ?? []).map((f) => {
    const { exposed, ...plain } = f;
    void exposed;
    return plain;
  });
  if (rs?.override) {
    return {
      formula: rs.override.formula,
      sources: rs.override.sources,
      filters: extra,
      own: true,
      ...(rs.breakdown ? { breakdown: rs.breakdown } : {}),
    };
  }
  const base = def?.realized;
  if (!base) return null;
  return {
    formula: base.formula,
    sources: base.sources,
    filters: [...base.filters, ...extra],
    own: false,
    ...(rs?.breakdown ? { breakdown: rs.breakdown } : {}),
  };
}

/** Recortes que aparecem no card como etiqueta. */
export function exposedFilters(rs: RealizedSource | null | undefined): RealizedFilter[] {
  return (rs?.filters ?? []).filter((f) => f.exposed === true);
}

/** Chave estável de uma fonte (para casar pedido × série no cliente). */
export function realizedSourceKey(rs: RealizedSource | null | undefined): string {
  return isDefaultRealized(rs) ? "" : JSON.stringify(rs);
}
