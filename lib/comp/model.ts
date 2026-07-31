// Versão: 1.0 | Data: 30/07/2026
// Modelo PURO da remuneração variável (0112). Um plano (comp_plans.config,
// jsonb versionado — parse FAIL-CLOSED, padrão kanban_automations) define
// fatores com peso %, fórmula AGREGADA (realizado computado pelo engine via
// runCalculatedWidget — nunca aqui), vínculo `metricKey` com o registry de
// metas (alvos são LINHAS de `goals`, scope 'responsible', id canônico) e,
// opcionalmente, uma fórmula LIVRE de total que compõe as MESMAS variáveis
// efetivas (sincronia total com a estrutura padrão).
// computeEntry deriva o detalhamento NA LEITURA: efetivo = manual ?? calculado
// em cada variável — recompute regrava só o snapshot CRU (computed.realized) e
// nunca toca os overrides; editar peso/base/override atualiza tudo sem
// re-consulta. A fórmula livre avalia SÓ por evaluateFormula sobre o mapa
// `comp:*` montado aqui — nunca parser/avaliador paralelo (invariante 26).
import {
  evaluateFormula,
  type Formula,
  type FormulaToken,
} from "@/lib/records/formulas";
import type { OperandRef } from "@/lib/records/date-operands";
import type { WidgetFilter } from "@/lib/widgets/types";
import { DEFAULT_PERIOD_FIELD, type DashboardPeriod } from "@/lib/widgets/period";
import type { SourceDef } from "@/lib/sources";

// Tetos de sanidade do jsonb (a UI limita antes; o parse rejeita acima).
export const MAX_FACTORS = 12;
export const MAX_BONUSES = 20;
export const MAX_TOTAL_FORMULA_TOKENS = 200;

/** Fator do plano: componente ponderado da remuneração. */
export interface CompFactor {
  id: string; // estável (chave de overrides/targets) — NUNCA regenerar no save
  label: string;
  weightPct: number; // peso literal (Σ não precisa dar 100)
  // Chave no registry goal_metrics (sync_config): os ALVOS por pessoa×mês são
  // linhas de `goals` com esta métrica — a área Metas gerencia os mesmos.
  metricKey: string;
  money: boolean; // formata alvo/realizado como R$ (senão número puro)
  formula: Formula; // fórmula AGREGADA do realizado (contexto "aggregate")
  sources: string[]; // fontes do recorte ([] = todas as fontes)
  filters?: WidgetFilter[]; // recorte extra (sem UI no v1; schema aceita)
  capPct?: number; // teto do atingimento CALCULADO (override manual ignora)
  floorPct?: number; // piso idem
}

export interface CompPlanConfig {
  v: 1;
  factors: CompFactor[];
  // Responsáveis (ids CANÔNICOS) inscritos; ausente/vazio = todos os ativos.
  memberIds?: string[];
  // Fórmula LIVRE do total (operandos comp:*). Ausente/null = composição
  // estruturada: base × Σ(peso% × ating%) + bônus.
  totalFormula?: Formula | null;
}

/** Override manual das variáveis derivadas de um fator (efetivo = manual ?? calculado). */
export interface CompFactorOverride {
  realized?: number;
  attainmentPct?: number;
  payout?: number;
}

export interface CompBonus {
  id: string;
  label: string;
  amount: number;
}

/** comp_entries.inputs — SEM targets (alvos vivem em goals). */
export interface CompEntryInputs {
  overrides: {
    factors: Record<string, CompFactorOverride>;
    total?: number;
  };
  bonuses: CompBonus[];
  note?: string;
}

/** comp_entries.computed — snapshot CRU do recompute (nunca derivados). */
export interface CompComputedRaw {
  v: 1;
  at: string; // ISO do recompute
  realized: Record<string, number | null>; // por fator (null = sem valor)
  errors?: Record<string, string>; // falha de consulta por fator
}

/** Detalhamento efetivo de um fator (derivado na leitura). */
export interface CompFactorBreakdown {
  target: number | null;
  realized: number | null;
  attainmentPct: number | null;
  payout: number;
  overridden: { realized: boolean; attainmentPct: boolean; payout: boolean };
}

/** Detalhamento efetivo da linha (responsável×mês). */
export interface CompBreakdown {
  base: number;
  byFactor: Record<string, CompFactorBreakdown>;
  factorsTotal: number;
  bonusTotal: number;
  // null = fórmula livre presente com resultado inválido (div/0, ref ausente).
  total: number | null;
  totalOverridden: boolean;
  totalFromFormula: boolean;
  totalFormulaError: boolean;
  weightSumPct: number; // p/ o badge "Σ pesos" (sem normalização silenciosa)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Arredondamento de dinheiro (2 casas) — só no nível payout/total. */
export function roundMoney(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function parseFilter(raw: unknown): WidgetFilter | null {
  if (!isRecord(raw)) return null;
  const { field, op } = raw;
  if (typeof field !== "string" || field === "") return null;
  if (typeof op !== "string" || op === "") return null;
  const out = { field, op } as WidgetFilter;
  if ("value" in raw) out.value = raw.value;
  return out;
}

// Fórmula persistida: exige o shape {tokens:[...]} com tokens-objeto. A
// validação semântica (refs/estrutura) é do validateFormulaForContext no save;
// aqui só o contrato estrutural (fail-closed p/ jsonb adulterado).
function parseFormula(raw: unknown, maxTokens?: number): Formula | null {
  if (!isRecord(raw) || !Array.isArray(raw.tokens)) return null;
  if (raw.tokens.length === 0) return null;
  if (maxTokens != null && raw.tokens.length > maxTokens) return null;
  for (const t of raw.tokens) {
    if (!isRecord(t) || typeof t.kind !== "string") return null;
  }
  const out: Formula = { tokens: raw.tokens as FormulaToken[] };
  if (typeof raw.source === "string") out.source = raw.source;
  return out;
}

function parseFactor(raw: unknown): CompFactor | null {
  if (!isRecord(raw)) return null;
  const { id, label, metricKey } = raw;
  if (typeof id !== "string" || id === "") return null;
  if (typeof label !== "string" || label.trim() === "") return null;
  if (typeof metricKey !== "string" || metricKey === "") return null;
  const weightPct = finiteOrNull(raw.weightPct);
  if (weightPct == null || weightPct < 0) return null;
  const formula = parseFormula(raw.formula);
  if (!formula) return null;
  const sourcesRaw = Array.isArray(raw.sources) ? raw.sources : [];
  const sources: string[] = [];
  for (const s of sourcesRaw) {
    if (typeof s !== "string" || s === "") return null;
    sources.push(s);
  }
  const capPct = finiteOrNull(raw.capPct);
  const floorPct = finiteOrNull(raw.floorPct);
  if (capPct != null && floorPct != null && floorPct > capPct) return null;
  const out: CompFactor = {
    id,
    label: label.trim(),
    weightPct,
    metricKey,
    money: raw.money !== false, // default true
    formula,
    sources,
  };
  if (Array.isArray(raw.filters)) {
    const filters: WidgetFilter[] = [];
    for (const f of raw.filters) {
      const parsed = parseFilter(f);
      if (!parsed) return null;
      filters.push(parsed);
    }
    if (filters.length > 0) out.filters = filters;
  }
  if (capPct != null) out.capPct = capPct;
  if (floorPct != null) out.floorPct = floorPct;
  return out;
}

/**
 * Parse FAIL-CLOSED de comp_plans.config: qualquer estrutura fora do contrato
 * (v errado, fator sem id/fórmula, peso não-numérico, floor>cap, ids
 * duplicados, totalFormula acima do teto…) retorna null — o chamador exibe
 * "Configuração do plano inválida", nunca "roda como der".
 */
export function parseCompPlanConfig(raw: unknown): CompPlanConfig | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const factorsRaw = Array.isArray(raw.factors) ? raw.factors : null;
  if (!factorsRaw || factorsRaw.length > MAX_FACTORS) return null;
  const factors: CompFactor[] = [];
  const seen = new Set<string>();
  for (const f of factorsRaw) {
    const parsed = parseFactor(f);
    if (!parsed || seen.has(parsed.id)) return null;
    seen.add(parsed.id);
    factors.push(parsed);
  }
  const out: CompPlanConfig = { v: 1, factors };
  if (Array.isArray(raw.memberIds)) {
    const ids: string[] = [];
    for (const m of raw.memberIds) {
      if (typeof m !== "string" || m === "") return null;
      ids.push(m);
    }
    if (ids.length > 0) out.memberIds = ids;
  }
  if (raw.totalFormula != null) {
    const tf = parseFormula(raw.totalFormula, MAX_TOTAL_FORMULA_TOKENS);
    if (!tf) return null;
    out.totalFormula = tf;
  }
  return out;
}

/**
 * Parse LENIENTE (por chave) de comp_entries.inputs: valor inválido cai, o
 * resto sobrevive — um override corrompido nunca derruba a linha inteira.
 */
export function parseCompEntryInputs(raw: unknown): CompEntryInputs {
  const out: CompEntryInputs = { overrides: { factors: {} }, bonuses: [] };
  if (!isRecord(raw)) return out;
  const ov = isRecord(raw.overrides) ? raw.overrides : {};
  if (isRecord(ov.factors)) {
    for (const [fid, v] of Object.entries(ov.factors)) {
      if (!isRecord(v)) continue;
      const entry: CompFactorOverride = {};
      const realized = finiteOrNull(v.realized);
      const attainmentPct = finiteOrNull(v.attainmentPct);
      const payout = finiteOrNull(v.payout);
      if (realized != null) entry.realized = realized;
      if (attainmentPct != null) entry.attainmentPct = attainmentPct;
      if (payout != null) entry.payout = payout;
      if (Object.keys(entry).length > 0) out.overrides.factors[fid] = entry;
    }
  }
  const total = finiteOrNull(ov.total);
  if (total != null) out.overrides.total = total;
  if (Array.isArray(raw.bonuses)) {
    for (const b of raw.bonuses) {
      if (out.bonuses.length >= MAX_BONUSES) break;
      if (!isRecord(b)) continue;
      const amount = finiteOrNull(b.amount);
      if (typeof b.id !== "string" || b.id === "") continue;
      if (typeof b.label !== "string") continue;
      if (amount == null) continue;
      out.bonuses.push({ id: b.id, label: b.label, amount });
    }
  }
  if (typeof raw.note === "string" && raw.note !== "") out.note = raw.note;
  return out;
}

// Clamp do atingimento CALCULADO (override manual vale verbatim — manual é
// manual; o cap/floor existe p/ domar a derivação, não a exceção).
function clampAtt(att: number | null, factor: CompFactor): number | null {
  if (att == null) return null;
  let v = att;
  if (factor.capPct != null && v > factor.capPct) v = factor.capPct;
  if (factor.floorPct != null && v < factor.floorPct) v = factor.floorPct;
  return v;
}

/** Refs da fórmula livre de total (prefixo comp:f: evita colidir com comp:base). */
export function compFactorRef(
  factorId: string,
  kind: "realizado" | "alvo" | "ating" | "valor"
): string {
  return `comp:f:${factorId}:${kind}`;
}

export const COMP_BASE_REF = "comp:base";
export const COMP_BONUS_REF = "comp:bonus";
export const COMP_FACTORS_REF = "comp:fatores";

/**
 * Catálogo de operandos da fórmula livre de total — derivado do config (os
 * operandos aparecem/somem em sincronia com os fatores). Consumido pelo
 * FormulaEditor (context "record") e pela validação do savePlan: MESMO módulo
 * nos dois lados (nunca listas paralelas).
 */
export function compOperandCatalog(config: CompPlanConfig): OperandRef[] {
  const out: OperandRef[] = [];
  for (const f of config.factors) {
    out.push(
      { ref: compFactorRef(f.id, "realizado"), label: `${f.label} — Realizado`, group: "Fatores" },
      { ref: compFactorRef(f.id, "alvo"), label: `${f.label} — Alvo`, group: "Fatores" },
      { ref: compFactorRef(f.id, "ating"), label: `${f.label} — Ating. (%)`, group: "Fatores" },
      { ref: compFactorRef(f.id, "valor"), label: `${f.label} — Valor (R$)`, group: "Fatores" }
    );
  }
  out.push(
    { ref: COMP_BASE_REF, label: "Base variável", group: "Totais" },
    { ref: COMP_BONUS_REF, label: "Total de bônus", group: "Totais" },
    { ref: COMP_FACTORS_REF, label: "Total dos fatores", group: "Totais" }
  );
  return out;
}

/**
 * Deriva o detalhamento EFETIVO de uma linha: overrides aplicados variável a
 * variável, cap/floor só no calculado, fórmula livre (se houver) sobre as
 * variáveis já efetivas, e `overrides.total` vencendo tudo nos dois modos.
 * `realized` vem de computed.realized (snapshot cru); `targets` vem de `goals`
 * (chaveado por factorId, já dobrado p/ o responsável canônico).
 */
export function computeEntry(
  config: CompPlanConfig,
  baseAmount: number | null | undefined,
  inputs: CompEntryInputs,
  realized: Record<string, number | null>,
  targets: Record<string, number | null>
): CompBreakdown {
  const base =
    typeof baseAmount === "number" && Number.isFinite(baseAmount)
      ? baseAmount
      : 0;
  const byFactor: Record<string, CompFactorBreakdown> = {};
  let factorsTotal = 0;
  let weightSumPct = 0;
  for (const f of config.factors) {
    weightSumPct += f.weightPct;
    const ov = inputs.overrides.factors[f.id] ?? {};
    const target = targets[f.id] ?? null;
    const realizedEff = ov.realized ?? realized[f.id] ?? null;
    const attRaw =
      target != null && target !== 0 && realizedEff != null
        ? (realizedEff / target) * 100
        : null;
    const attEff = ov.attainmentPct ?? clampAtt(attRaw, f);
    const payout =
      ov.payout ??
      (attEff != null
        ? roundMoney(base * (f.weightPct / 100) * (attEff / 100))
        : 0);
    factorsTotal += payout;
    byFactor[f.id] = {
      target,
      realized: realizedEff,
      attainmentPct: attEff,
      payout,
      overridden: {
        realized: ov.realized != null,
        attainmentPct: ov.attainmentPct != null,
        payout: ov.payout != null,
      },
    };
  }
  factorsTotal = roundMoney(factorsTotal);
  const bonusTotal = roundMoney(
    inputs.bonuses.reduce((acc, b) => acc + b.amount, 0)
  );

  let totalComputed: number | null;
  let totalFromFormula = false;
  let totalFormulaError = false;
  if (config.totalFormula) {
    totalFromFormula = true;
    const ctx: Record<string, number | null> = {
      [COMP_BASE_REF]: base,
      [COMP_BONUS_REF]: bonusTotal,
      [COMP_FACTORS_REF]: factorsTotal,
    };
    for (const f of config.factors) {
      const b = byFactor[f.id];
      ctx[compFactorRef(f.id, "realizado")] = b.realized;
      ctx[compFactorRef(f.id, "alvo")] = b.target;
      ctx[compFactorRef(f.id, "ating")] = b.attainmentPct;
      ctx[compFactorRef(f.id, "valor")] = b.payout;
    }
    const r = evaluateFormula(config.totalFormula, ctx);
    if (typeof r === "number" && Number.isFinite(r)) {
      totalComputed = roundMoney(r);
    } else {
      totalComputed = null;
      totalFormulaError = true;
    }
  } else {
    totalComputed = roundMoney(factorsTotal + bonusTotal);
  }

  const totalOverridden = inputs.overrides.total != null;
  const total = totalOverridden ? (inputs.overrides.total as number) : totalComputed;
  return {
    base,
    byFactor,
    factorsTotal,
    bonusTotal,
    total,
    totalOverridden,
    totalFromFormula,
    totalFormulaError,
    weightSumPct,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function lastDayOfMonth(year: number, month: number): number {
  // Dia 0 do mês seguinte em UTC — imune a fuso/DST do runtime.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Período do mês (semântica da barra do dashboard): bounds YYYY-MM-DD +
 * `fieldBySource` cobrindo TODAS as fontes do catálogo (raízes e subs) pela
 * coluna de data padrão de cada uma — sem isso a perna de uma fonte cujo
 * default não é `closed_at` perderia registros em silêncio.
 */
export function monthPeriod(
  year: number,
  month: number,
  catalog: SourceDef[]
): DashboardPeriod {
  const fieldBySource: Record<string, string> = {};
  for (const s of catalog) {
    fieldBySource[s.key] = s.defaultPeriodField || DEFAULT_PERIOD_FIELD;
  }
  return {
    field: DEFAULT_PERIOD_FIELD,
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
    fieldBySource,
  };
}
