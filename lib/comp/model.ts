// Versão: 1.2 | Data: 31/07/2026
// v1.2: membros por OPERAÇÃO (memberOperationIds) — helpers puros
// resolveOperationMembers/explicitMemberIds combinam manual ∪ operações; a
// resolução opId→ids canônicos é dos CALLERS (loadOperationScopes + canon).
// Modelo PURO da remuneração variável (0112). Um plano (comp_plans.config,
// jsonb versionado — parse FAIL-CLOSED, padrão kanban_automations) define
// fatores com peso %, fórmula AGREGADA (realizado computado pelo engine via
// runCalculatedWidget — nunca aqui), vínculo `metricKey` com o registry de
// metas (alvos são LINHAS de `goals`, scope 'responsible', id canônico) e,
// opcionalmente, uma fórmula LIVRE de total que compõe as MESMAS variáveis
// efetivas (sincronia total com a estrutura padrão).
// v1.1: comissão por FAIXAS de atingimento (config.commission) — % sobre uma
// base (base variável ou realizado de um fator) escolhida pelo atingimento
// EFETIVO do fator gatilho; tabela por membro (memberTiers) vence a do plano.
// O cálculo é NATIVO em computeEntry (nunca fórmula gerada — override por
// membro não caberia numa fórmula por plano) e a fórmula livre compõe via
// ref `comp:comissao` (sem soma automática, semântica do comp:bonus).
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
export const MAX_COMMISSION_TIERS = 12; // por tabela (plano ou membro)
export const MAX_COMMISSION_MEMBER_OVERRIDES = 400;

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

/** Faixa: atingimento >= fromPct ⇒ comissão de ratePct% da base. */
export interface CompCommissionTier {
  fromPct: number; // >= 0; estritamente crescente dentro da tabela
  ratePct: number; // >= 0 (0 = faixa que zera)
}

/**
 * Comissão por faixas: o atingimento EFETIVO do fator gatilho (pós override e
 * cap/floor) escolhe a faixa (maior `fromPct` satisfeito vence, `>=`); a % da
 * faixa incide sobre a base variável da linha ou sobre o realizado EFETIVO de
 * um fator. `memberTiers` (id CANÔNICO) substitui a tabela inteira do plano
 * para aquele membro; entrada órfã (membro fora do plano) nunca é selecionada
 * e nunca é podada no save (memberIds vazio = "todos os ativos", que muda).
 */
export interface CompCommissionConfig {
  triggerFactorId: string;
  basisKind: "base" | "factor";
  basisFactorId?: string; // obrigatório sse basisKind === "factor"
  tiers: CompCommissionTier[]; // >= 1
  memberTiers?: Record<string, CompCommissionTier[]>;
}

export interface CompPlanConfig {
  v: 1;
  factors: CompFactor[];
  // Responsáveis (ids CANÔNICOS) inscritos; ausente/vazio = todos os ativos.
  memberIds?: string[];
  // Operações (ids de `operations`) cujos membros entram no plano: subárvore
  // VIVA de responsible_operations, canonicalizada e intersectada com os
  // ativos pelo CALLER (resolução é I/O — loadOperationScopes; o parse é
  // puro). PRESENÇA da chave ⇒ lista explícita SEMPRE (mesmo resolvendo
  // vazio — nunca cair no "todos os ativos": parceria profile-only não pode
  // inflar o plano em silêncio).
  memberOperationIds?: string[];
  // Fórmula LIVRE do total (operandos comp:*). Ausente/null = composição
  // estruturada: base × Σ(peso% × ating%) + bônus.
  totalFormula?: Formula | null;
  // Comissão por faixas de atingimento (opcional; ausente = sem comissão).
  commission?: CompCommissionConfig;
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
    commission?: number;
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

/** Detalhamento efetivo da comissão por faixas (derivado na leitura). */
export interface CompCommissionBreakdown {
  value: number; // efetivo = manual ?? calculado
  tier: CompCommissionTier | null; // faixa satisfeita (null = nenhuma)
  triggerAttainmentPct: number | null; // ating. EFETIVO usado na seleção
  overridden: boolean;
}

/** Detalhamento efetivo da linha (responsável×mês). */
export interface CompBreakdown {
  base: number;
  byFactor: Record<string, CompFactorBreakdown>;
  factorsTotal: number;
  // null = plano sem comissão (a coluna/linha não existe na UI).
  commission: CompCommissionBreakdown | null;
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

// Tabela de faixas: >= 1, todas finitas e >= 0, fromPct estritamente
// crescente (cobre ordenação E duplicata num só check).
function parseTiers(raw: unknown): CompCommissionTier[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (raw.length > MAX_COMMISSION_TIERS) return null;
  const out: CompCommissionTier[] = [];
  let prev = -Infinity;
  for (const t of raw) {
    if (!isRecord(t)) return null;
    const fromPct = finiteOrNull(t.fromPct);
    const ratePct = finiteOrNull(t.ratePct);
    if (fromPct == null || fromPct < 0 || fromPct <= prev) return null;
    if (ratePct == null || ratePct < 0) return null;
    prev = fromPct;
    out.push({ fromPct, ratePct });
  }
  return out;
}

// Bloco de comissão: FAIL-CLOSED (referência a fator fantasma computaria
// silenciosamente errado — espírito da invariante 26; o editor valida antes
// com mensagem própria, aqui é a muralha contra jsonb adulterado).
function parseCommission(
  raw: unknown,
  factorIds: Set<string>
): CompCommissionConfig | null {
  if (!isRecord(raw)) return null;
  const { triggerFactorId, basisKind } = raw;
  if (typeof triggerFactorId !== "string" || !factorIds.has(triggerFactorId))
    return null;
  if (basisKind !== "base" && basisKind !== "factor") return null;
  const out: CompCommissionConfig = {
    triggerFactorId,
    basisKind,
    tiers: [],
  };
  if (basisKind === "factor") {
    const b = raw.basisFactorId;
    if (typeof b !== "string" || !factorIds.has(b)) return null;
    out.basisFactorId = b;
  }
  const tiers = parseTiers(raw.tiers);
  if (!tiers) return null;
  out.tiers = tiers;
  if (raw.memberTiers != null) {
    if (!isRecord(raw.memberTiers)) return null;
    const entries = Object.entries(raw.memberTiers);
    if (entries.length > MAX_COMMISSION_MEMBER_OVERRIDES) return null;
    const memberTiers: Record<string, CompCommissionTier[]> = {};
    for (const [id, t] of entries) {
      if (id === "") return null;
      const parsed = parseTiers(t);
      if (!parsed) return null;
      memberTiers[id] = parsed;
    }
    if (entries.length > 0) out.memberTiers = memberTiers;
  }
  return out;
}

/**
 * Parse FAIL-CLOSED de comp_plans.config: qualquer estrutura fora do contrato
 * (v errado, fator sem id/fórmula, peso não-numérico, floor>cap, ids
 * duplicados, totalFormula acima do teto, comissão apontando fator
 * inexistente…) retorna null — o chamador exibe "Configuração do plano
 * inválida", nunca "roda como der".
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
  if (Array.isArray(raw.memberOperationIds)) {
    const ids: string[] = [];
    for (const m of raw.memberOperationIds) {
      if (typeof m !== "string" || m === "") return null;
      ids.push(m);
    }
    if (ids.length > 0) out.memberOperationIds = ids;
  }
  if (raw.totalFormula != null) {
    const tf = parseFormula(raw.totalFormula, MAX_TOTAL_FORMULA_TOKENS);
    if (!tf) return null;
    out.totalFormula = tf;
  }
  if (raw.commission != null) {
    const c = parseCommission(raw.commission, seen);
    if (!c) return null;
    out.commission = c;
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
  const commission = finiteOrNull(ov.commission);
  if (commission != null) out.overrides.commission = commission;
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

/**
 * Achata os membros resolvidos das operações do plano: ordem do config →
 * ordem do array resolvido; dedup por id. `operationMembersById` já vem
 * CANONICALIZADO do caller (operationMembersFromScopes no server); operação
 * ausente do mapa (excluída/sem resolução) contribui zero.
 */
export function resolveOperationMembers(
  memberOperationIds: string[] | undefined,
  operationMembersById: Record<string, string[]>
): string[] {
  if (!memberOperationIds || memberOperationIds.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const opId of memberOperationIds) {
    for (const id of operationMembersById[opId] ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Lista EXPLÍCITA de membros do plano (manuais ∪ operações, ordem manual
 * primeiro, dedup) ou null = "todos os ativos". `memberOperationIds` presente
 * ⇒ NUNCA null, mesmo resolvendo vazio (fail-closed — o plano fica sem
 * membros em vez de virar "empresa inteira" em silêncio).
 */
export function explicitMemberIds(
  config: CompPlanConfig,
  operationMemberIds: string[]
): string[] | null {
  const manual = config.memberIds ?? [];
  const hasOps = (config.memberOperationIds?.length ?? 0) > 0;
  if (manual.length === 0 && !hasOps) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...manual, ...operationMemberIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export const COMP_BASE_REF = "comp:base";
export const COMP_BONUS_REF = "comp:bonus";
export const COMP_FACTORS_REF = "comp:fatores";
export const COMP_COMMISSION_REF = "comp:comissao";

/**
 * Tabela de faixas efetiva de um membro: a própria (memberTiers) substitui a
 * do plano INTEIRA; sem memberId (ou sem override) vale a do plano; null =
 * plano sem comissão.
 */
export function resolveCommissionTiers(
  config: CompPlanConfig,
  memberId?: string | null
): CompCommissionTier[] | null {
  const c = config.commission;
  if (!c) return null;
  if (memberId && c.memberTiers?.[memberId]) return c.memberTiers[memberId];
  return c.tiers;
}

/**
 * Faixa satisfeita: maior `fromPct` com atingimento >= fromPct (limiar exato
 * entra). Abaixo da menor faixa, ou atingimento null, nenhuma (⇒ comissão 0).
 */
export function selectCommissionTier(
  tiers: CompCommissionTier[],
  attainmentPct: number | null
): CompCommissionTier | null {
  if (attainmentPct == null) return null;
  let best: CompCommissionTier | null = null;
  for (const t of tiers) {
    if (attainmentPct >= t.fromPct && (best == null || t.fromPct > best.fromPct))
      best = t;
  }
  return best;
}

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
  // Só com comissão configurada — o operando some/aparece em sincronia, e
  // desligar a comissão com a ref em uso reprova a fórmula no save de graça.
  if (config.commission) {
    out.push({
      ref: COMP_COMMISSION_REF,
      label: "Comissão (R$)",
      group: "Totais",
    });
  }
  return out;
}

/**
 * Deriva o detalhamento EFETIVO de uma linha: overrides aplicados variável a
 * variável, cap/floor só no calculado, fórmula livre (se houver) sobre as
 * variáveis já efetivas, e `overrides.total` vencendo tudo nos dois modos.
 * `realized` vem de computed.realized (snapshot cru); `targets` vem de `goals`
 * (chaveado por factorId, já dobrado p/ o responsável canônico). `memberId`
 * (id CANÔNICO da linha) seleciona a tabela de faixas do membro — ausente,
 * vale a do plano.
 */
export function computeEntry(
  config: CompPlanConfig,
  baseAmount: number | null | undefined,
  inputs: CompEntryInputs,
  realized: Record<string, number | null>,
  targets: Record<string, number | null>,
  memberId?: string | null
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

  // Comissão por faixas: o atingimento EFETIVO do gatilho (pós override e
  // cap/floor — byFactor já é efetivo) escolhe a faixa; a % incide sobre a
  // base variável ou o realizado EFETIVO do fator-base. Sem faixa satisfeita
  // ou base ausente ⇒ 0 (nunca fabricar), override manual sempre possível.
  let commission: CompCommissionBreakdown | null = null;
  if (config.commission) {
    const c = config.commission;
    const tiers = resolveCommissionTiers(config, memberId) ?? c.tiers;
    const att = byFactor[c.triggerFactorId]?.attainmentPct ?? null;
    const tier = selectCommissionTier(tiers, att);
    const basis =
      c.basisKind === "base"
        ? base
        : (byFactor[c.basisFactorId ?? ""]?.realized ?? null);
    const calc =
      tier != null && basis != null
        ? roundMoney(basis * (tier.ratePct / 100))
        : 0;
    const ovCommission = inputs.overrides.commission;
    commission = {
      value: ovCommission ?? calc,
      tier,
      triggerAttainmentPct: att,
      overridden: ovCommission != null,
    };
  }
  const commissionValue = commission?.value ?? 0;

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
    // Sem soma automática no modo fórmula — a fórmula compõe explicitamente
    // (mesma semântica do comp:bonus); ref presente só com comissão ativa.
    if (commission != null) ctx[COMP_COMMISSION_REF] = commission.value;
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
    totalComputed = roundMoney(factorsTotal + commissionValue + bonusTotal);
  }

  const totalOverridden = inputs.overrides.total != null;
  const total = totalOverridden ? (inputs.overrides.total as number) : totalComputed;
  return {
    base,
    byFactor,
    factorsTotal,
    commission,
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
