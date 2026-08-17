// Versão: 1.0 | Data: 17/08/2026
// Aritmética "registro → remuneração" do DETALHAMENTO — o elo que faltava
// entre a lista de registros e o dinheiro. Módulo PURO (sem I/O, sem texto:
// as frases seguem em lib/comp/commission-label.ts) consumido pelo núcleo
// lib/comp/detail.ts, que abastece a tela e as abas do export.
//
// Nada aqui recalcula comissão: o valor de um bloco continua saindo de
// `computeEntry`. O que este módulo faz é EXPLICAR aquele valor — quais faixas
// existiam, qual venceu, e quanto UMA unidade do operando vale — reusando
// `resolveCommissionTiers`/`selectCommissionTier`, os mesmos seletores do
// cálculo, para que a explicação não possa divergir do número explicado.
import {
  resolveCommissionTiers,
  selectCommissionTier,
  type CompCommissionBlock,
  type CompCommissionBlockBreakdown,
  type CompFactor,
  type CompFactorBreakdown,
  type CompPlanConfig,
} from "./model";

/** Papel de um fator num bloco de comissão. */
export interface CommissionRole {
  block: CompCommissionBlock;
  /** O atingimento/realizado deste fator escolhe a faixa. */
  isTrigger: boolean;
  /** O realizado deste fator é o multiplicando do payout. */
  isBasis: boolean;
}

/**
 * Blocos de comissão em que o fator entra. Único ponto que resolve a relação
 * fator → bloco (o `computeEntry` só faz o caminho inverso, bloco → fator).
 */
export function commissionRolesOf(
  config: CompPlanConfig,
  factorId: string
): CommissionRole[] {
  const out: CommissionRole[] = [];
  for (const block of config.commissions ?? []) {
    const isTrigger = block.triggerFactorId === factorId;
    const isBasis =
      block.basisKind === "factor" && block.basisFactorId === factorId;
    if (isTrigger || isBasis) out.push({ block, isTrigger, isBasis });
  }
  return out;
}

/** Um degrau da escada de faixas, já resolvido para exibição. */
export interface TierRung {
  /** Limiar na unidade do `tierBy` do bloco (atingimento % ou realizado). */
  fromPct: number;
  ratePct?: number;
  amount?: number;
  /** É a faixa que venceu (a que o cálculo aplicou). */
  applied: boolean;
  /** O gatilho alcançou este limiar (pode haver faixa maior aplicada). */
  reached: boolean;
}

/**
 * Escada COMPLETA do bloco para um membro, com a faixa aplicada marcada — é o
 * que mostra as faixas que o colaborador NÃO alcançou, sem as quais o valor
 * aplicado parece arbitrário. As faixas já vêm crescentes por `fromPct` do
 * parse; a vencedora é a mesma referência devolvida por `selectCommissionTier`.
 */
export function tierLadder(
  block: CompCommissionBlock,
  memberId: string | null | undefined,
  triggerValue: number | null
): TierRung[] {
  const tiers = resolveCommissionTiers(block, memberId);
  const applied = selectCommissionTier(tiers, triggerValue);
  return tiers.map((t) => ({
    fromPct: t.fromPct,
    ...(t.ratePct != null ? { ratePct: t.ratePct } : {}),
    ...(t.amount != null ? { amount: t.amount } : {}),
    applied: t === applied,
    reached: triggerValue != null && triggerValue >= t.fromPct,
  }));
}

/**
 * Quanto UMA unidade do operando vale em reais.
 *
 *  - `commission` — o fator é a BASE de um bloco com faixa aplicada:
 *      per_unit ⇒ o valor fixo da faixa por unidade;
 *      pct      ⇒ a taxa da faixa incide sobre cada unidade.
 *    (`flat` não multiplica nada: o valor da faixa é fixo, então não há valor
 *    por unidade — devolve null.)
 *  - `weight` — o fator PONTUA por atingimento: cada unidade de realizado
 *    move o atingimento em `1/alvo`, e o payout em `base × peso/100 ÷ alvo`.
 *
 * null quando a relação não é linear e um número enganaria: sem faixa/alvo,
 * cap ou piso ATIVO (a partir dali unidade extra não paga), valor manual, ou
 * fator que só serve de gatilho (mover a agulha pode trocar de faixa, mas não
 * há valor por unidade).
 */
export interface UnitValue {
  perUnit: number;
  kind: "commission" | "weight";
  /** Bloco de origem quando kind === "commission". */
  blockId?: string;
}

export function unitValue(
  factor: CompFactor,
  breakdown: CompFactorBreakdown,
  roles: CommissionRole[],
  blocksById: Map<string, CompCommissionBlockBreakdown>
): UnitValue | null {
  // 1) Base de comissão: cada unidade do realizado multiplica direto.
  for (const role of roles) {
    if (!role.isBasis) continue;
    const cb = blocksById.get(role.block.id);
    if (!cb?.tier) continue;
    if (cb.kind === "per_unit" && cb.tier.amount != null)
      return { perUnit: cb.tier.amount, kind: "commission", blockId: cb.blockId };
    if (cb.kind === "pct" && cb.tier.ratePct != null)
      return {
        perUnit: cb.tier.ratePct / 100,
        kind: "commission",
        blockId: cb.blockId,
      };
    // flat: valor fixo da faixa — nada por unidade.
  }

  // 2) Fator que pontua por atingimento.
  if (factor.weightPct <= 0) return null;
  if (breakdown.overridden.payout || breakdown.overridden.attainmentPct)
    return null; // manual é manual: a conta linear não descreve o valor
  const alvo = breakdown.targetBRL;
  if (alvo == null || alvo === 0) return null;
  // Cap/piso ATIVO quebra a linearidade a partir do ponto de corte.
  const attRaw =
    breakdown.realized != null ? (breakdown.realized / alvo) * 100 : null;
  if (attRaw == null) return null;
  if (factor.capPct != null && attRaw > factor.capPct) return null;
  if (factor.floorPct != null && attRaw < factor.floorPct) return null;

  return { perUnit: 0, kind: "weight" };
}

/**
 * Valor por unidade do caminho "weight" — separado porque depende da BASE
 * variável do lançamento, que não é do fator. `base × peso/100 ÷ alvo`.
 */
export function weightUnitValue(
  factor: CompFactor,
  breakdown: CompFactorBreakdown,
  base: number
): number | null {
  const alvo = breakdown.targetBRL;
  if (alvo == null || alvo === 0) return null;
  return (base * (factor.weightPct / 100)) / alvo;
}

/**
 * Resolve o valor por unidade JÁ com a base aplicada — o que a coluna "Vale"
 * usa. Mantém `unitValue` como a decisão (é linear? por qual caminho?) e este
 * como a conta final.
 */
export function resolvedUnitValue(
  factor: CompFactor,
  breakdown: CompFactorBreakdown,
  roles: CommissionRole[],
  blocksById: Map<string, CompCommissionBlockBreakdown>,
  base: number
): UnitValue | null {
  const uv = unitValue(factor, breakdown, roles, blocksById);
  if (!uv) return null;
  if (uv.kind !== "weight") return uv;
  const perUnit = weightUnitValue(factor, breakdown, base);
  return perUnit == null ? null : { perUnit, kind: "weight" };
}
