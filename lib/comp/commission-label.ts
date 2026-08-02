// Versão: 1.2 | Data: 02/08/2026
// v1.2: frases do DEMONSTRATIVO do Google Planilhas (`sheetFactorNote`,
// `sheetCommissionSumNote`, `sheetTotalNote`, SHEET_*_NOTE) — linguagem p/
// RH/gestor, sem jargão interno; consumidas só pelo builder
// `lib/export/comp-sheet.ts`. `entryMemoryLines`/`factorPayoutFormula`/
// `commissionMemory` seguem intocados (grade e PDF pinados).
// v1.1: memória da LINHA inteira — `entryMemoryLines` (linha de detalhe da
// grade de Lançamentos) e `factorPayoutFormula` (conta base × peso × ating.,
// também usada no title do Valor). Este módulo segue sendo o DONO ÚNICO dos
// textos pt-BR da memória de cálculo.
// Rótulos pt-BR da MEMÓRIA DE CÁLCULO da comissão por faixas — helper PURO e
// ÚNICO consumido pela grade de Lançamentos (linha de detalhe + popover da
// célula Comissão), pela Visão geral e pela visão do vendedor (my-comp-view).
// Nunca duplique estes textos em componente: o breakdown
// (CompCommissionBlockBreakdown, model.ts) já carrega os campos derivados
// (basis/basisLabel/basisMoney/triggerLabel/triggerMoney) e este módulo só
// formata. Também é o dono dos formatadores pt-BR antes duplicados em
// comp-grid/my-comp-view (fmtMoneyBRL/fmtNumBR).

import type {
  CompBreakdown,
  CompCommissionBlockBreakdown,
  CompFactor,
  CompFactorBreakdown,
  CompPlanConfig,
} from "./model";

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

/**
 * Conta do Valor por atingimento de um fator com peso — byte-idêntica ao
 * antigo title inline da grade: "R$ 3.000,00 × 40% × 90% = R$ 1.080,00"
 * (mesma fórmula do computeEntry: base × peso/100 × ating./100).
 */
export function factorPayoutFormula(
  base: number,
  weightPct: number,
  attainmentPct: number,
  payout: number
): string {
  return `${fmtMoneyBRL(base)} × ${fmtNumBR(weightPct)}% × ${fmtNumBR(attainmentPct)}% = ${fmtMoneyBRL(payout)}`;
}

/**
 * Memória da LINHA inteira (membro×mês) para a linha de detalhe da grade:
 * um item por fator (conta do payout ou papel de gatilho), um por bloco de
 * comissão (via commissionMemory — nunca reformatar), soma/override da
 * comissão, bônus e a composição do total. A base variável NUNCA soma no
 * total estruturado — ela multiplica DENTRO dos fatores (model.ts) e já
 * aparece na conta de cada um.
 */
export function entryMemoryLines(
  config: CompPlanConfig,
  breakdown: CompBreakdown
): string[] {
  const lines: string[] = [];
  for (const f of config.factors) {
    const b = breakdown.byFactor[f.id];
    if (!b) continue;
    if (f.weightPct > 0) {
      if (b.overridden.payout) {
        // Fórmula aqui mentiria — o payout foi digitado à mão.
        lines.push(`${f.label}: ${fmtMoneyBRL(b.payout)} (manual)`);
      } else if (b.attainmentPct != null) {
        lines.push(
          `${f.label}: ${factorPayoutFormula(breakdown.base, f.weightPct, b.attainmentPct, b.payout)}`
        );
      } else {
        lines.push(
          `${f.label}: sem atingimento (alvo/realizado vazio) ⇒ ${fmtMoneyBRL(0)}`
        );
      }
    } else {
      const real =
        b.realized != null
          ? `realizado ${f.money ? fmtMoneyBRL(b.realized) : fmtNumBR(b.realized)}`
          : "sem realizado";
      lines.push(`${f.label}: ${real} (gatilho/base de comissão)`);
    }
  }
  for (const cb of breakdown.commissionBlocks) {
    const mem = commissionMemory(cb);
    const suffix = mem.memberTiers ? " · faixas do membro" : "";
    lines.push(
      mem.formula != null
        ? `${cb.label}: ${mem.formula} — ${mem.tierNote}${suffix}`
        : `${cb.label}: ${mem.tierNote}${suffix}`
    );
  }
  const comm = breakdown.commission;
  if (comm != null && (comm.overridden || breakdown.commissionBlocks.length > 1)) {
    const calc = breakdown.commissionBlocks.reduce((a, b) => a + b.value, 0);
    lines.push(
      comm.overridden
        ? `Comissão manual ${fmtMoneyBRL(comm.value)} (calculado ${fmtMoneyBRL(calc)})`
        : `Comissão (soma): ${fmtMoneyBRL(comm.value)}`
    );
  }
  if (breakdown.bonusTotal !== 0) {
    lines.push(`Bônus: ${fmtMoneyBRL(breakdown.bonusTotal)}`);
  }
  if (breakdown.totalOverridden) {
    lines.push(
      `Total manual: ${breakdown.total != null ? fmtMoneyBRL(breakdown.total) : "—"}`
    );
  } else if (breakdown.totalFormulaError) {
    lines.push("Fórmula do total sem resultado");
  } else if (breakdown.totalFromFormula) {
    lines.push(
      `Total pela fórmula do plano: ${breakdown.total != null ? fmtMoneyBRL(breakdown.total) : "—"}`
    );
  } else {
    // Composição só quando há o que compor (≥ 2 termos não-zero) — com um
    // termo só, a linha do próprio termo já conta a história.
    const terms: string[] = [];
    if (breakdown.factorsTotal !== 0)
      terms.push(`fatores ${fmtMoneyBRL(breakdown.factorsTotal)}`);
    const commValue = comm?.value ?? 0;
    if (commValue !== 0) terms.push(`comissão ${fmtMoneyBRL(commValue)}`);
    if (breakdown.bonusTotal !== 0)
      terms.push(`bônus ${fmtMoneyBRL(breakdown.bonusTotal)}`);
    if (terms.length >= 2 && breakdown.total != null) {
      lines.push(`Total: ${terms.join(" + ")} = ${fmtMoneyBRL(breakdown.total)}`);
    }
  }
  return lines;
}

// ============ Frases do DEMONSTRATIVO (Google Planilhas) ============
// Linguagem p/ leitor externo (RH/gestor): nada de "gatilho/base de
// comissão", "peso N%" solto ou "não soma no total". O peso já tem coluna
// própria no demonstrativo — a nota conta só a HISTÓRIA do valor.

export const SHEET_BASE_NOTE =
  "Base que multiplica o peso × atingimento de cada fator — já refletida no valor dos fatores acima.";

export const SHEET_NO_ENTRY_NOTE = "Sem lançamento neste mês.";

/**
 * Nota do fator p/ o demonstrativo (sem prefixo de label — o label vai na
 * coluna Item). Conta principal + anexos discretos com " · ".
 */
export function sheetFactorNote(
  f: CompFactor,
  b: CompFactorBreakdown,
  base: number
): string {
  let main: string;
  if (b.overridden.payout) {
    main = "Valor definido manualmente";
  } else if (f.weightPct === 0) {
    main = "Usado no cálculo da comissão — não gera valor próprio";
  } else if (b.attainmentPct != null) {
    main = factorPayoutFormula(base, f.weightPct, b.attainmentPct, b.payout);
  } else {
    main = `Sem atingimento (alvo ou realizado vazio) ⇒ ${fmtMoneyBRL(0)}`;
  }
  const extras: string[] = [];
  if (b.targetSource === "default") extras.push("Alvo padrão do plano");
  if (f.targetCurrency && b.target != null) {
    extras.push(
      b.targetRateMissing
        ? `Sem cotação ${f.targetCurrency} no mês — atingimento não calculado`
        : `Alvo em ${f.targetCurrency}` +
            (b.targetBRL != null ? ` ≈ ${fmtMoneyBRL(b.targetBRL)}` : "")
    );
  }
  if (b.overridden.realized) extras.push("Realizado informado manualmente");
  if (b.overridden.attainmentPct)
    extras.push("Atingimento informado manualmente");
  return [main, ...extras].join(" · ");
}

/** Nota da linha "Comissão (total)" do demonstrativo. */
export function sheetCommissionSumNote(
  overridden: boolean,
  calculated: number
): string {
  return overridden
    ? `Ajuste manual (calculado: ${fmtMoneyBRL(calculated)})`
    : "Soma dos blocos de comissão";
}

/** Nota da linha "Total" do bloco no demonstrativo. */
export function sheetTotalNote(breakdown: CompBreakdown): string {
  if (breakdown.totalOverridden) return "Total definido manualmente";
  if (breakdown.totalFormulaError)
    return "Fórmula do total sem resultado — revise o plano";
  if (breakdown.totalFromFormula)
    return "Total calculado pela fórmula do plano";
  const terms: string[] = [];
  if (breakdown.factorsTotal !== 0)
    terms.push(`Fatores ${fmtMoneyBRL(breakdown.factorsTotal)}`);
  const commValue = breakdown.commission?.value ?? 0;
  if (commValue !== 0) terms.push(`Comissão ${fmtMoneyBRL(commValue)}`);
  if (breakdown.bonusTotal !== 0)
    terms.push(`Bônus ${fmtMoneyBRL(breakdown.bonusTotal)}`);
  return terms.length >= 2 ? terms.join(" + ") : "";
}
