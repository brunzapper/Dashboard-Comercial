// Versão: 1.2 | Data: 17/08/2026
// v1.2: MEMÓRIA DE CÁLCULO no lugar da prosa — a coluna de texto do cabeçalho
// do fator carrega a conta do payout, entra a linha "cada X vale R$ Y", a
// escada de faixas (com as NÃO alcançadas visíveis, que é o que explica a
// aplicada), a coluna "Vale (R$)" por registro e o bloco de comissão do plano.
// A conferência virou numérica (realizado × somado lado a lado).
// Versão: 1.1 | Data: 16/08/2026
// v1.1: um sub-bloco por OPERANDO da fórmula (é assim que o cálculo consulta —
// ver lib/comp/detail.ts). Com um operando só, o cabeçalho do fator já o
// descreve e a conferência mora no subtotal; com dois ou mais, cada operando
// ganha cabeçalho e subtotal próprios e o fator avisa que o valor vem da
// combinação — nada de comparar um Σ que não corresponde ao número.
// Versão: 1.0 | Data: 16/08/2026
// Builder PURO das abas de DETALHAMENTO por colaborador (Det-<Nome>) do export
// p/ Google Planilhas — payload v3. Consome a matriz do núcleo
// lib/comp/detail.ts (que é o mesmo do diálogo de conferência da tela) e a
// converte no grid de largura FIXA (COMP_SHEET_COLS) com `kinds` paralelo às
// rows; o Apps Script formata por kind e resolve os hiperlinks.
//
// A aba é EVIDÊNCIA: cada bloco de fator mostra o realizado OFICIAL no
// cabeçalho e a soma dos registros listados no subtotal, com a nota de
// conferência do commission-label (dono único das frases pt-BR) explicando
// quando os dois divergem. Nunca apresente a soma listada como "o realizado".
//
// A cada export a aba é recriada do zero (clear()) e só com o período pedido —
// abas Det-* órfãs são removidas pelo script.
import {
  DETAIL_BACK_NOTE,
  DETAIL_DIVERGE_MARK,
  DETAIL_EMPTY_NOTE,
  detailTierLabel,
  detailTierMark,
  detailTierValue,
  detailUnitValueNote,
  SOMADOS_LABEL,
} from "@/lib/comp/commission-label";
import type {
  CompDetailCommission,
  CompDetailFactor,
  CompDetailMember,
  CompDetailOperand,
} from "@/lib/comp/detail";
import type {
  CompSheetPayloadSheet,
  CompSheetRowKind,
} from "@/lib/comp/sheets-export";

import { COMP_SHEET_COLS, padSheetRow, type SheetCell, type SheetRow } from "./comp-sheet";

/** Cabeçalho da tabela de registros (a 6ª coluna é o rótulo do valor do fator). */
function detailHeaderCells(valueLabel: string, merged: boolean): SheetCell[] {
  return [
    "Data",
    "Registro",
    "Base",
    // Bloco somado mistura operandos: a coluna diz de qual veio cada linha.
    merged ? "Operando" : "Responsável",
    "Etapa",
    valueLabel,
    "Vale (R$)",
  ];
}

/** Escada de faixas + memória de UM bloco de comissão. */
function pushCommission(
  c: CompDetailCommission,
  push: (kind: CompSheetRowKind, cells: SheetCell[], link?: string | null) => void
) {
  push("detailFactorMoney", [c.label, "", "", "", "", c.value, c.formula ?? ""]);
  push("detailMemory", [c.tierNote]);
  for (const t of c.tiers) {
    push(t.applied ? "detailTierApplied" : "detailTier", [
      detailTierLabel(t.fromPct, c.tierBy, c.triggerMoney),
      "",
      "",
      "",
      "",
      detailTierValue(t, c.kind),
      detailTierMark(t.applied, t.reached),
    ]);
  }
}

function pushOperand(
  operand: CompDetailOperand,
  money: boolean,
  // Rótulo próprio só quando o fator tem mais de um operando — com um só, o
  // cabeçalho do fator já disse tudo e repetir seria ruído.
  withHeader: boolean,
  /** Realizado a confrontar; null quando não há número único a comparar. */
  compareTo: number | null,
  push: (kind: CompSheetRowKind, cells: SheetCell[], link?: string | null) => void
) {
  if (withHeader) {
    push(money ? "detailFactorMoney" : "detailFactor", [
      operand.label,
      "",
      "",
      "",
      "",
      "",
      operand.aggNote,
    ]);
  }
  for (const warning of operand.warnings) push("info", [warning]);
  if (operand.rows.length === 0) {
    push("info", [DETAIL_EMPTY_NOTE]);
    return;
  }
  const merged = operand.label === SOMADOS_LABEL;
  push("detailHeader", detailHeaderCells(operand.valueLabel, merged));
  for (const r of operand.rows) {
    push(money ? "detailRowMoney" : "detailRow", [
      r.date,
      r.title,
      r.sourceLabel,
      merged ? r.origin : r.responsibleLabel,
      r.stage,
      r.value ?? r.valueText,
      r.contribution ?? "",
    ]);
  }
  // Confronto NUMÉRICO (o texto explicativo saiu): realizado e somado lado a
  // lado, com marca discreta só quando divergem.
  const diverge =
    compareTo != null &&
    operand.listedSum != null &&
    Math.abs(compareTo - operand.listedSum) >= 0.01;
  push(money ? "detailSubtotalMoney" : "detailSubtotal", [
    `Subtotal — ${operand.label}`,
    "",
    "",
    "",
    compareTo ?? "",
    operand.listedSum ?? "",
    diverge ? DETAIL_DIVERGE_MARK : "",
  ]);
}

function pushFactor(
  factor: CompDetailFactor,
  push: (kind: CompSheetRowKind, cells: SheetCell[], link?: string | null) => void
) {
  const money = factor.money;
  const multi = factor.operands.length > 1;
  push(money ? "detailFactorMoney" : "detailFactor", [
    factor.label,
    "",
    "",
    "",
    "",
    factor.realized ?? "",
    // Coluna de MEMÓRIA, não de prosa: a conta do valor por atingimento.
    factor.payoutFormula ?? "",
  ]);
  // Quanto cada unidade vale, e as comissões que este fator move (com a escada
  // completa — inclusive as faixas que ficaram acima do alcançado).
  if (factor.unitValue != null) {
    push("detailMemory", [
      detailUnitValueNote(
        factor.unitValue,
        factor.commissions.length > 0 ? "commission" : "weight",
        factor.unitLabel
      ),
    ]);
  }
  for (const c of factor.commissions) pushCommission(c, push);
  for (const warning of factor.warnings) push("info", [warning]);
  if (factor.operands.length === 0) {
    push("info", [DETAIL_EMPTY_NOTE]);
    return;
  }
  // A conferência só existe quando há um número único a confrontar (fórmula de
  // um operando puro) — nesse caso ela mora ao lado do Σ, no subtotal.
  const compareTo =
    !multi && factor.listedForCompare != null ? factor.realized : null;
  for (let i = 0; i < factor.operands.length; i += 1) {
    if (i > 0) push("blank", []);
    pushOperand(factor.operands[i], money, multi, multi ? null : compareTo, push);
  }
}

/**
 * Uma aba por colaborador. `overviewTabName` é o alvo do link "voltar" — o
 * script resolve o `gid` na hora (o payload só carrega o NOME da aba).
 */
export function compDetailSheets(
  members: CompDetailMember[],
  opts: { monthLabel: string; overviewTabName: string }
): CompSheetPayloadSheet[] {
  return members.map((member) => {
    const rows: SheetRow[] = [];
    const kinds: CompSheetRowKind[] = [];
    const links: (string | null)[] = [];
    const push = (
      kind: CompSheetRowKind,
      cells: SheetCell[],
      link: string | null = null
    ) => {
      rows.push(padSheetRow(cells));
      kinds.push(kind);
      links.push(link);
    };

    push("detailBack", [DETAIL_BACK_NOTE], opts.overviewTabName);
    for (const plan of member.plans) {
      push("blank", []);
      push("planHeader", [plan.planName]);
      for (let i = 0; i < plan.factors.length; i += 1) {
        if (i > 0) push("blank", []);
        pushFactor(plan.factors[i], push);
      }
      // A comissão aparece nos DOIS lugares: dentro do fator que a dispara
      // (onde a escada explica o número do fator) e aqui, como bloco do plano
      // — é ela que soma no total, e sem bloco próprio o leitor não a acha.
      for (const c of plan.commissions) {
        push("blank", []);
        pushCommission(c, push);
      }
    }
    push("blank", []);
    push("blank", []);
    push("memberTotal", [
      `Total — ${member.label}`,
      "",
      "",
      "",
      "",
      member.monthTotal ?? "",
      "",
    ]);

    return {
      tabName: member.tabName,
      headers: padSheetRow([
        `Detalhamento — ${member.label} — ${opts.monthLabel}`,
      ]) as string[],
      rows,
      kinds,
      links,
    };
  });
}

export { COMP_SHEET_COLS };
