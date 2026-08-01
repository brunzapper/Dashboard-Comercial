// Versão: 1.0 | Data: 01/08/2026
// Rótulos pt-BR da MEMÓRIA DE CÁLCULO da comissão por faixas — helper PURO e
// ÚNICO consumido pela grade de Lançamentos (popover da célula Comissão) e
// pela visão do vendedor (my-comp-view). Nunca duplique estes textos em
// componente: o breakdown (CompCommissionBlockBreakdown, model.ts) já carrega
// os campos derivados (basis/basisLabel/basisMoney/triggerLabel/triggerMoney)
// e este módulo só formata. Também é o dono dos formatadores pt-BR antes
// duplicados em comp-grid/my-comp-view (fmtMoneyBRL/fmtNumBR).

import type { CompCommissionBlockBreakdown } from "./model";

export const fmtMoneyBRL = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const fmtNumBR = (v: number): string =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Linhas legíveis da memória de UM bloco. */
export interface CommissionMemory {
  // A multiplicação/valor: "44 (Reuniões) × R$ 12,50 = R$ 550,00",
  // "20% × R$ 9.450,00 (Vendas) = R$ 1.890,00", "R$ 750,00 (valor fixo da
  // faixa)". null quando não há faixa/gatilho ou o fator-base está sem
  // realizado (o motivo vai em tierNote).
  formula: string | null;
  // Sempre presente: faixa escolhida + gatilho, ou o motivo do zero.
  tierNote: string;
  // Repasse de memberTiersApplied — o caller decide o sufixo "faixas do membro".
  memberTiers: boolean;
}

// Gatilho/limiar na unidade do tierBy: atingimento em %, realizado em R$ ou
// número conforme o fator gatilho (triggerMoney).
function triggerFmt(cb: CompCommissionBlockBreakdown, v: number): string {
  if (cb.tierBy === "attainment") return `${fmtNumBR(v)}%`;
  return cb.triggerMoney ? fmtMoneyBRL(v) : fmtNumBR(v);
}

export function commissionMemory(
  cb: CompCommissionBlockBreakdown
): CommissionMemory {
  const memberTiers = cb.memberTiersApplied;
  if (cb.triggerValue == null) {
    return {
      formula: null,
      tierNote: "sem gatilho apurado (atingimento/realizado vazio)",
      memberTiers,
    };
  }
  if (cb.tier == null) {
    return {
      formula: null,
      tierNote: `nenhuma faixa atingida (gatilho: ${triggerFmt(cb, cb.triggerValue)})`,
      memberTiers,
    };
  }
  const tierNote =
    cb.tierBy === "attainment"
      ? `faixa ≥ ${fmtNumBR(cb.tier.fromPct)}% (atingimento de ${cb.triggerLabel}: ${triggerFmt(cb, cb.triggerValue)})`
      : `faixa a partir de ${triggerFmt(cb, cb.tier.fromPct)} (${cb.triggerLabel}: ${triggerFmt(cb, cb.triggerValue)})`;
  if (cb.kind === "flat") {
    return {
      formula: `${fmtMoneyBRL(cb.tier.amount ?? 0)} (valor fixo da faixa)`,
      tierNote,
      memberTiers,
    };
  }
  // pct/per_unit multiplicam o basis; sem realizado no fator-base o payout é 0.
  if (cb.basis == null) {
    return {
      formula: null,
      tierNote: `${tierNote} — fator-base sem realizado ⇒ ${fmtMoneyBRL(0)}`,
      memberTiers,
    };
  }
  const basisFmt = cb.basisMoney ? fmtMoneyBRL(cb.basis) : fmtNumBR(cb.basis);
  const basisPart = cb.basisLabel ? `${basisFmt} (${cb.basisLabel})` : basisFmt;
  const formula =
    cb.kind === "per_unit"
      ? `${basisPart} × ${fmtMoneyBRL(cb.tier.amount ?? 0)} = ${fmtMoneyBRL(cb.value)}`
      : `${fmtNumBR(cb.tier.ratePct ?? 0)}% × ${basisPart} = ${fmtMoneyBRL(cb.value)}`;
  return { formula, tierNote, memberTiers };
}
