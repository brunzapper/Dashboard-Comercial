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
  DETAIL_EMPTY_NOTE,
  detailReconcileNote,
} from "@/lib/comp/commission-label";
import type {
  CompDetailFactor,
  CompDetailMember,
} from "@/lib/comp/detail";
import type {
  CompSheetPayloadSheet,
  CompSheetRowKind,
} from "@/lib/comp/sheets-export";

import { COMP_SHEET_COLS, padSheetRow, type SheetCell, type SheetRow } from "./comp-sheet";

/** Cabeçalho da tabela de registros (a 6ª coluna é o rótulo do valor do fator). */
function detailHeaderCells(valueLabel: string): SheetCell[] {
  return [
    "Data",
    "Registro",
    "Base",
    "Responsável",
    "Etapa",
    valueLabel,
    "Observações",
  ];
}

function pushFactor(
  factor: CompDetailFactor,
  push: (kind: CompSheetRowKind, cells: SheetCell[], link?: string | null) => void
) {
  const money = factor.money;
  push(money ? "detailFactorMoney" : "detailFactor", [
    factor.label,
    "",
    "",
    "",
    "",
    factor.realized ?? "",
    factor.aggNote,
  ]);
  for (const warning of factor.warnings) push("info", [warning]);
  if (factor.rows.length === 0) {
    push("info", [DETAIL_EMPTY_NOTE]);
    return;
  }
  push("detailHeader", detailHeaderCells(factor.valueLabel));
  for (const r of factor.rows) {
    push(money ? "detailRowMoney" : "detailRow", [
      r.date,
      r.title,
      r.sourceLabel,
      r.responsibleLabel,
      r.stage,
      r.value ?? "",
      r.extras,
    ]);
  }
  push(money ? "detailSubtotalMoney" : "detailSubtotal", [
    `Subtotal — ${factor.label}`,
    "",
    "",
    "",
    "",
    factor.listedSum ?? "",
    detailReconcileNote(factor.realized, factor.listedSum, money),
  ]);
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
