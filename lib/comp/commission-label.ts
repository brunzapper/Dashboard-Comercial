// Versão: 1.12 | Data: 27/08/2026
// v1.12: VOCABULÁRIO DE LEITOR. O demonstrativo é lido por colaboradores e pelo
// RH, não por quem construiu o modelo — então o jargão interno saiu de TODA
// frase visível: "fator" → "indicador", "alvo" → "meta" (o app já se explicava
// com "Alvos são metas", frase-muleta agora removida da grade), "gatilho" →
// "o que define a faixa", "recorte"/"operando" → linguagem comum, e os
// símbolos soltos (⇒, ≥, ≠) viraram palavras. Entram as frases do CONTEXTO do
// topo (competência, mês apurado, situação publicado/prévia, gerado em), do
// RESUMO da folha e da LEGENDA das colunas. Este módulo passa a ser o registro
// ÚNICO dos três exports: o PDF e o CSV deixaram de usar o texto interno.
// v1.11: `detailUnitValueNote` SAIU. A linha "Cada X vale R$ Y" repetia o que
// a fórmula do bloco de comissão diz logo abaixo ("40 (Reuniões) × R$ 12,50 =
// R$ 500,00") e, em fator de dinheiro, era a própria taxa em outras palavras.
// A coluna "Vale (R$)" por registro FICA — lá o número é de cada registro, e
// não está em nenhuma outra coluna.
// Versão: 1.10 | Data: 22/08/2026
// v1.10: `sheetFactorNote` devolve VAZIO para fator de peso 0 — a coluna Valor
// já sai vazia e a frase "não gera valor próprio" (mais o anexo do alvo) era
// comentário repetido em toda linha. Ajuste MANUAL segue sendo dito: é o que
// o leitor não infere das colunas.
// Versão: 1.9 | Data: 22/08/2026
// v1.9: `detailRowPartsNote` — a composição do valor de cada linha do bloco
// fundido (coluna Descrição), que antes ficava só no total do registro.
// Versão: 1.8 | Data: 19/08/2026
// v1.8: a escada de faixas por ATINGIMENTO passa a dizer de que meta os
// percentuais falam — `detailTierLabel` mostra o absoluto de cada degrau e
// `detailTargetNote` declara meta e realizado do gatilho.
// Versão: 1.7 | Data: 17/08/2026
// v1.7: a fusão de operandos passou a ter um bloco PRINCIPAL que recebe os
// demais, então o rótulo genérico `SOMADOS_LABEL` saiu: o bloco usa o rótulo
// do principal e `detailMergedAggNote` diz o que entrou junto.
// `detailSumPartsNote` cobre o subtotal de partes com unidades diferentes.
// Versão: 1.6 | Data: 17/08/2026
// v1.6: MEMÓRIA DE CÁLCULO no lugar da prosa. A conferência virou NUMÉRICA
// (realizado × somado lado a lado, com `DETAIL_DIVERGE_MARK` discreto), então
// `detailReconcileNote` e `DETAIL_COMBINED_NOTE` saíram — no lugar entraram
// a escada de faixas
// (`detailTierLabel`/`detailTierValue`/`detailTierMark`).
// Versão: 1.5 | Data: 16/08/2026
// v1.5: o detalhamento passou a ser por OPERANDO da fórmula, então a
// conferência só compara quando há um número único a confrontar.
// DETAIL_SCOPED_SOURCE_NOTE saiu (o escopo de fonte agora é tratado, não
// avisado); entrou DETAIL_UNSUPPORTED_FIELD_NOTE.
// Versão: 1.4 | Data: 16/08/2026
// v1.4: frases do DETALHAMENTO por registro (`detail*`/`DETAIL_*`) —
// compartilhadas pelo diálogo de conferência da tela e pelas abas Det-<Nome>
// do Google Planilhas (por isso o prefixo `detail`, não `sheet`). A listagem
// é EVIDÊNCIA: as frases confrontam a soma listada com o realizado oficial
// sem nunca afirmar que uma substitui a outra.
// v1.3: demonstrativo por COLABORADOR — `sheetSummaryNote` (composição
// consolidada dos planos da pessoa, no cabeçalho da seção) e
// `SHEET_MEMBER_TOTAL_NOTE` (linha "Total — <nome>"/"Total do mês").
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
      tierNote: "sem base para escolher a faixa (atingimento ou realizado em branco)",
      memberTiers,
    };
  }
  if (cb.tier == null) {
    return {
      formula: null,
      tierNote: `nenhuma faixa alcançada (${cb.triggerLabel}: ${triggerFmt(cb, cb.triggerValue)})`,
      memberTiers,
    };
  }
  const tierNote =
    cb.tierBy === "attainment"
      ? `faixa a partir de ${fmtNumBR(cb.tier.fromPct)}% (atingimento de ${cb.triggerLabel}: ${triggerFmt(cb, cb.triggerValue)})`
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
      tierNote: `${tierNote} — indicador de base sem realizado: ${fmtMoneyBRL(0)}`,
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
          `${f.label}: sem atingimento (meta ou realizado em branco): ${fmtMoneyBRL(0)}`
        );
      }
    } else {
      const real =
        b.realized != null
          ? `realizado ${f.money ? fmtMoneyBRL(b.realized) : fmtNumBR(b.realized)}`
          : "sem realizado";
      lines.push(`${f.label}: ${real} (usado para definir a faixa da comissão)`);
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
// Linguagem p/ leitor externo (RH/colaborador): nada de "gatilho", "recorte",
// "operando" ou símbolo matemático solto (⇒, ≥, ≠). O peso já tem coluna
// própria no demonstrativo — a nota conta só a HISTÓRIA do valor. Desde a
// v1.12 este é o registro ÚNICO: o PDF e o CSV também o consomem.

export const SHEET_BASE_NOTE =
  "Não é somada ao total: multiplica o peso × atingimento de cada indicador e já está refletida no valor deles.";

export const SHEET_NO_ENTRY_NOTE = "Sem lançamento neste mês.";

// ---- Contexto do topo da planilha ----
// Responde, antes de qualquer número, as três perguntas que todo leitor faz:
// de que mês é isto, sobre qual desempenho, e se o valor já é final.

/** Mês do PAGAMENTO (competência do demonstrativo). */
export function sheetCompetenciaNote(monthLabel: string): string {
  return `Competência: ${monthLabel}`;
}

/**
 * Mês do DESEMPENHO, quando difere do de pagamento (planos com apuração sobre
 * o mês anterior). É a primeira dúvida de quem vê metas que não batem com o
 * mês — omitir isso é o que gera a pergunta.
 */
export function sheetApuracaoNote(
  apuradoLabel: string,
  /** false = só parte dos planos desloca; dizer isso evita generalizar errado. */
  allPlans: boolean
): string {
  const base = `Desempenho apurado sobre: ${apuradoLabel}`;
  return allPlans
    ? base
    : `${base} — vale para os planos que apuram sobre o mês anterior`;
}

/**
 * Situação da folha. Status MISTO é dito, nunca arredondado para "publicado" —
 * o RH precisa saber que parte ainda pode mudar.
 */
export function sheetStatusNote(published: number, total: number): string {
  if (total === 0) return "Situação: sem lançamentos";
  if (published >= total) return "Situação: publicado";
  if (published === 0) return "Situação: prévia — ainda não publicado";
  return `Situação: prévia — ${fmtNumBR(total - published)} de ${fmtNumBR(total)} lançamentos ainda não publicados`;
}

export function sheetGeneratedNote(date: Date): string {
  return `Gerado em: ${date.toLocaleDateString("pt-BR")}`;
}

// ---- Resumo da folha (uma linha por pessoa, para o RH) ----
export const SHEET_ROSTER_TITLE = "Resumo do mês";
export const SHEET_ROSTER_HEADERS = [
  "Colaborador",
  "Plano",
  "",
  "",
  "",
  "Total (R$)",
  "Situação",
] as const;
export const SHEET_ROSTER_TOTAL_LABEL = "Total geral";
export const SHEET_ROSTER_PUBLISHED = "Publicado";
export const SHEET_ROSTER_DRAFT = "Prévia";

/** Rodapé do resumo: quantas pessoas ele soma. */
export function sheetRosterTotalNote(people: number): string {
  return people === 1 ? "1 colaborador" : `${fmtNumBR(people)} colaboradores`;
}

// ---- Legenda das colunas ----
// Sete colunas sem definição obrigam o leitor a adivinhar. A legenda fecha a
// planilha porque é consulta, não introdução.
export const SHEET_LEGEND_TITLE = "Como ler este demonstrativo";
export const SHEET_LEGEND: readonly (readonly [string, string])[] = [
  ["Indicador", "O que é medido para calcular a remuneração (ex.: Vendas, Reuniões)."],
  ["Meta", "Quanto era esperado no período."],
  ["Realizado", "Quanto a pessoa efetivamente fez."],
  ["Atingimento", "O realizado dividido pela meta, em porcentagem."],
  ["Peso", "Quanto o indicador pesa no cálculo do valor."],
  ["Valor (R$)", "Quanto o indicador gerou em reais."],
  ["Comissão", "Prêmio por faixa, escolhida pelo atingimento ou pelo realizado."],
  ["Base variável", "Valor de referência que multiplica os indicadores. Não é somada ao total."],
  ["Bônus", "Valores avulsos lançados pela gestão."],
  ["Memória de cálculo", "A conta que levou ao valor daquela linha."],
  ["—", "Não se aplica a esta linha."],
];

/**
 * Nota do fator p/ o demonstrativo (sem prefixo de label — o label vai na
 * coluna Item). Conta principal + anexos discretos com " · ".
 */
export function sheetFactorNote(
  f: CompFactor,
  b: CompFactorBreakdown,
  base: number
): string {
  // Fator de peso 0 não tem conta a mostrar: a coluna Valor já sai vazia, e
  // repetir "não gera valor próprio" em toda linha de todo colaborador é
  // comentário sobre o que a tabela já diz. A célula fica em BRANCO — só uma
  // intervenção MANUAL (que o leitor não tem como inferir das colunas) ainda
  // fala nessa linha.
  const semValorProprio = f.weightPct === 0 && !b.overridden.payout;

  let main = "";
  if (b.overridden.payout) {
    main = "Valor definido manualmente";
  } else if (semValorProprio) {
    main = "";
  } else if (b.attainmentPct != null) {
    main = factorPayoutFormula(base, f.weightPct, b.attainmentPct, b.payout);
  } else {
    main = `Sem atingimento (meta ou realizado em branco): ${fmtMoneyBRL(0)}`;
  }

  const extras: string[] = [];
  // Anexos sobre a META só interessam onde ela vira valor; num indicador de
  // peso 0 a meta já aparece na coluna dela e o resto é ruído.
  if (!semValorProprio) {
    if (b.targetSource === "default") extras.push("Meta padrão do plano");
    if (f.targetCurrency && b.target != null) {
      extras.push(
        b.targetRateMissing
          ? `Sem cotação ${f.targetCurrency} no mês — atingimento não calculado`
          : `Meta em ${f.targetCurrency}` +
              (b.targetBRL != null ? ` (equivale a ${fmtMoneyBRL(b.targetBRL)})` : "")
      );
    }
  }
  if (b.overridden.realized) extras.push("Realizado informado manualmente");
  if (b.overridden.attainmentPct)
    extras.push("Atingimento informado manualmente");
  return [main, ...extras].filter(Boolean).join(" · ");
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

export const SHEET_MEMBER_TOTAL_NOTE = "Soma dos planos acima.";

/**
 * Rótulo da linha de bônus. Compartilhado pelo demonstrativo do mês e pela aba
 * de detalhamento — a mesma linha nos dois lugares, uma única frase.
 */
export function bonusRowLabel(label: string): string {
  return label ? `Bônus — ${label}` : "Bônus";
}

/**
 * Composição consolidada da remuneração da pessoa (cabeçalho da seção do
 * demonstrativo): "Fatores R$ X + Comissão R$ Y + Bônus R$ Z". Componente
 * estruturalmente ausente (commission null = nenhum plano com blocos) ou
 * zerado fica fora; com menos de 2 termos devolve "" (o total na coluna ao
 * lado já conta a história) — mesma convenção de sheetTotalNote.
 */
export function sheetSummaryNote(
  factors: number,
  commission: number | null,
  bonus: number
): string {
  const terms: string[] = [];
  if (factors !== 0) terms.push(`Fatores ${fmtMoneyBRL(factors)}`);
  if (commission != null && commission !== 0)
    terms.push(`Comissão ${fmtMoneyBRL(commission)}`);
  if (bonus !== 0) terms.push(`Bônus ${fmtMoneyBRL(bonus)}`);
  return terms.length >= 2 ? terms.join(" + ") : "";
}

// ============ Frases do DETALHAMENTO por registro ============
// Compartilhadas pelo diálogo de conferência da tela e pelas abas Det-<Nome>
// do Google Planilhas — por isso o prefixo é `detail`, não `sheet`. Regra do
// módulo: a listagem é EVIDÊNCIA; o realizado oficial continua vindo do
// cálculo. As frases nunca afirmam que a soma listada É o realizado.

export const DETAIL_BACK_NOTE = "← Voltar para a visão geral";

export const DETAIL_EMPTY_NOTE =
  "Nenhum registro considerado neste indicador neste período.";

/**
 * Crédito de equipe ligado: a lista traz registros em nome de OUTRAS pessoas.
 * Sem esta frase o líder vê nomes que não são o dele e conclui que a conta
 * está errada — a explicação tem de vir junto do dado, não do suporte.
 */
export function detailTeamNote(names: string[]): string {
  const quem =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
  return `Inclui registros da equipe creditada a este membro: ${quem}.`;
}

export const DETAIL_DROPPED_FILTER_NOTE =
  "Uma das condições deste indicador não pôde ser aplicada a esta lista — os registros abaixo podem ser mais amplos que os usados no cálculo.";

export const DETAIL_UNSUPPORTED_FIELD_NOTE =
  "Esta lista não consegue reproduzir exatamente o filtro usado no cálculo — os registros abaixo podem ser mais amplos que os que entraram no valor.";

/**
 * Nota do bloco que RECEBEU outros operandos (engrenagem): o rótulo do bloco
 * segue sendo o do principal, então é aqui que se diz o que entrou junto —
 * sem isso o subtotal cresceria sem explicação.
 */
export function detailMergedAggNote(
  principal: string,
  folded: string[],
  total: number
): string {
  return detailAggNote([principal, ...folded].join(" + "), total);
}

/**
 * O que compõe o valor de UMA linha do bloco fundido:
 * "R$ 1.000,00 de Implementação + R$ 3.000,00 de MRR do contrato". Sem isto o
 * registro mostra só o total e não se sabe o que entrou nele.
 */
export function detailRowPartsNote(
  parts: { label: string; value: number }[],
  money: boolean
): string {
  const fmt = money ? fmtMoneyBRL : fmtNumBR;
  return parts.map((p) => `${fmt(p.value)} de ${p.label}`).join(" + ");
}

/**
 * Parcelas do subtotal quando as partes não compartilham unidade (soma em R$
 * dobrada com contagem). Somar daria um número sem significado; mostrar as
 * parcelas mantém o cálculo visível.
 */
export function detailSumPartsNote(
  parts: { label: string; value: number; money: boolean }[]
): string {
  return parts
    .map((p) => `${p.label}: ${p.money ? fmtMoneyBRL(p.value) : fmtNumBR(p.value)}`)
    .join(" · ");
}

/** Cabeçalho do bloco: o que a coluna de valor mostra e quantos registros entraram. */
export function detailAggNote(aggLabel: string, total: number): string {
  const registros = total === 1 ? "1 registro" : `${fmtNumBR(total)} registros`;
  return `${aggLabel} · ${registros} considerados`;
}

/** Aviso de janela: a listagem mostra só os primeiros N do recorte. */
export function detailTruncatedNote(shown: number, total: number): string {
  return `Mostrando os ${fmtNumBR(shown)} primeiros de ${fmtNumBR(total)} registros.`;
}

/** Limiar de um degrau da escada, na unidade do gatilho. */
export function detailTierLabel(
  fromPct: number,
  tierBy: "attainment" | "realized",
  money: boolean,
  /**
   * META do gatilho. Com faixas por ATINGIMENTO, "50%" sozinho é percentual de
   * coisa nenhuma — com a meta o degrau mostra também quanto isso é em
   * absoluto. Ausente (sem alvo apurado) mantém só o percentual: inventar o
   * absoluto seria pior que não mostrá-lo.
   */
  target?: number | null
): string {
  if (tierBy === "attainment") {
    const pct = `A partir de ${fmtNumBR(fromPct)}%`;
    if (target == null) return pct;
    const abs = (target * fromPct) / 100;
    return `${pct} (${money ? fmtMoneyBRL(abs) : fmtNumBR(abs)})`;
  }
  return `A partir de ${money ? fmtMoneyBRL(fromPct) : fmtNumBR(fromPct)}`;
}

/**
 * Declara a META que a escada de atingimento usa como referência, com o
 * realizado ao lado. Sem isso o leitor vê "não alcançada" sem saber o alvo.
 * null quando não há meta apurada — aí a escada fala só em percentual.
 */
export function detailTargetNote(
  triggerLabel: string,
  target: number | null,
  realized: number | null,
  money: boolean
): string | null {
  if (target == null) return null;
  const fmt = money ? fmtMoneyBRL : fmtNumBR;
  const meta = `Meta de ${triggerLabel}: ${fmt(target)}`;
  if (realized == null) return meta;
  const pct = target !== 0 ? ` = ${fmtNumBR((realized / target) * 100)}%` : "";
  return `${meta} · realizado ${fmt(realized)}${pct}`;
}

/**
 * Valor do degrau JÁ formatado — a unidade muda por tipo de bloco (% na
 * comissão percentual, R$ nas de valor fixo/por unidade), então mandar texto é
 * mais honesto que um número cru que a planilha formataria de um jeito só.
 */
export function detailTierValue(
  rung: { ratePct?: number; amount?: number },
  kind: "pct" | "flat" | "per_unit"
): string {
  if (kind === "pct")
    return rung.ratePct != null ? `${fmtNumBR(rung.ratePct)}%` : "";
  return rung.amount != null ? fmtMoneyBRL(rung.amount) : "";
}

/** Marcador do degrau: a aplicada, as alcançadas e as que ficaram acima. */
export const DETAIL_TIER_APPLIED = "faixa aplicada";
export const DETAIL_TIER_REACHED = "alcançada";
export const DETAIL_TIER_MISSED = "não alcançada";

export function detailTierMark(applied: boolean, reached: boolean): string {
  if (applied) return DETAIL_TIER_APPLIED;
  return reached ? DETAIL_TIER_REACHED : DETAIL_TIER_MISSED;
}

/** Marca discreta de divergência no subtotal (os números ficam lado a lado). */
export const DETAIL_DIVERGE_MARK = "difere do realizado";

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
