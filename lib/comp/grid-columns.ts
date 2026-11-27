// Versão: 1.0 | Data: 28/11/2026
// Colunas RELEVANTES de cada indicador na grade de Lançamentos. A grade
// mostrava sempre Meta | Real. | Ating. | Valor, e num plano por comissão isso
// virava ruído: o indicador que só define a faixa tinha um "Valor" sempre
// vazio, e o que é pago pela comissão exibia um atingimento zerado que não
// entra em conta nenhuma — enquanto a informação que importa (que % vira
// remuneração e quanto o colaborador recebe daquele indicador) não aparecia.
//
// A regra é DERIVADA do config, nunca de uma lista por plano:
// - Meta/Ating.: o indicador tem peso, dispara uma faixa por ATINGIMENTO, ou a
//   fórmula livre do total lê o alvo/atingimento dele.
// - Valor: o indicador tem peso, ou a fórmula do total lê o valor dele.
// - Remun./Recebe: o indicador é a BASE de algum bloco de comissão — o %
//   (ou R$ fixo / por unidade) da faixa aplicada e o valor que o bloco paga.
// - Real.: sempre.
// Decidido por PLANO (as colunas são as mesmas em toda linha). Puro.
import {
  compFactorRef,
  type CompBreakdown,
  type CompCommissionBlock,
  type CompCommissionBlockBreakdown,
  type CompFactor,
  type CompPlanConfig,
} from "@/lib/comp/model";
import { formulaRefs } from "@/lib/records/formulas";
import { fmtMoneyBRL, fmtNumBR } from "@/lib/comp/commission-label";

export type FactorGridColumn =
  | "target"
  | "realized"
  | "attainment"
  | "payout"
  | "rate"
  | "commission";

/** Blocos de comissão que têm o indicador como BASE (ordem do config). */
export function blocksPaidOn(
  config: CompPlanConfig,
  factorId: string
): CompCommissionBlock[] {
  return (config.commissions ?? []).filter(
    (b) => b.basisKind === "factor" && b.basisFactorId === factorId
  );
}

export function factorGridColumns(
  config: CompPlanConfig,
  f: CompFactor
): FactorGridColumn[] {
  const totalRefs = new Set(config.totalFormula ? formulaRefs(config.totalFormula) : []);
  const usesAttainment =
    f.weightPct > 0 ||
    (config.commissions ?? []).some(
      (b) => b.triggerFactorId === f.id && (b.tierBy ?? "attainment") === "attainment"
    ) ||
    totalRefs.has(compFactorRef(f.id, "alvo")) ||
    totalRefs.has(compFactorRef(f.id, "ating"));
  const usesPayout = f.weightPct > 0 || totalRefs.has(compFactorRef(f.id, "valor"));
  const paidOn = blocksPaidOn(config, f.id).length > 0;
  const out: FactorGridColumn[] = [];
  if (usesAttainment) out.push("target");
  out.push("realized");
  if (usesAttainment) out.push("attainment");
  if (usesPayout) out.push("payout");
  if (paidOn) out.push("rate", "commission");
  return out;
}

/** Rótulo do cabeçalho de cada coluna. */
export const FACTOR_GRID_COLUMN_LABELS: Record<FactorGridColumn, string> = {
  target: "Meta",
  realized: "Real.",
  attainment: "Ating.",
  payout: "Valor",
  rate: "Remun.",
  commission: "Recebe",
};

/** Texto da faixa aplicada de UM bloco: "40%", "R$ 500,00 fixo", "R$ 10,00/un.". */
function tierText(b: CompCommissionBlockBreakdown): string {
  if (!b.tier) return "—";
  if (b.kind === "pct") return `${fmtNumBR(b.tier.ratePct ?? 0)}%`;
  if (b.kind === "flat") return `${fmtMoneyBRL(b.tier.amount ?? 0)} fixo`;
  return `${fmtMoneyBRL(b.tier.amount ?? 0)}/un.`;
}

/**
 * O que o indicador paga nesta linha: a faixa aplicada (por bloco em que ele é
 * base) e a soma do que esses blocos pagam. null quando ele não é base de
 * bloco nenhum.
 */
export function factorCommissionCell(
  config: CompPlanConfig,
  breakdown: CompBreakdown,
  factorId: string
): { rate: string; value: number } | null {
  const ids = new Set(blocksPaidOn(config, factorId).map((b) => b.id));
  if (ids.size === 0) return null;
  const blocks = breakdown.commissionBlocks.filter((b) => ids.has(b.blockId));
  return {
    rate: blocks.map(tierText).join(" + ") || "—",
    value: Math.round(blocks.reduce((a, b) => a + b.value, 0) * 100) / 100,
  };
}
