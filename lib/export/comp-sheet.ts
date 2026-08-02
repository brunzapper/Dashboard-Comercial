// Versão: 1.0 | Data: 02/08/2026
// Builder PURO do DEMONSTRATIVO de remuneração p/ o Google Planilhas
// (payload v2 do export via Apps Script). Layout "resumo + detalhe" na MESMA
// aba do mês: linha-título (viaja em `headers` — o script v1 a degrada como
// header bold), quadro-resumo (uma linha por pessoa×plano + total geral) e
// blocos de detalhe por pessoa com a MEMÓRIA DE CÁLCULO como protagonista.
// Grid de largura FIXA (COMP_SHEET_COLS, padding "") + `kinds` paralelo às
// rows (1 por linha; whitelist em lib/comp/sheets-export.ts, dono do
// contrato) — o Apps Script formata por kind (moeda/%/bold/fundos/larguras).
// Deriva pelo MESMO computeEntry dos cards via `statementBreakdown`
// (lib/export/comp.ts — nunca entry.total) e TODA frase pt-BR sai de
// lib/comp/commission-label.ts (dono único — nada de texto novo aqui além de
// rótulos de coluna/junção, que são layout). O CSV (compReportCsv) segue
// byte-idêntico e NÃO passa por aqui.
import {
  commissionMemory,
  sheetCommissionSumNote,
  sheetFactorNote,
  sheetTotalNote,
  SHEET_BASE_NOTE,
  SHEET_NO_ENTRY_NOTE,
} from "@/lib/comp/commission-label";
import { roundMoney } from "@/lib/comp/model";
import type {
  CompSheetRowKind,
  CompSheetScope,
} from "@/lib/comp/sheets-export";
import { statementBreakdown, type CompStatementInput } from "./comp";

export const COMP_SHEET_COLS = 7;

type SheetCell = string | number;
type SheetRow = SheetCell[];

export interface CompSheetReport {
  headers: string[]; // linha-título (COMP_SHEET_COLS células; [0] = título)
  rows: SheetRow[]; // largura fixa COMP_SHEET_COLS
  kinds: CompSheetRowKind[]; // kinds.length === rows.length (título fora)
}

/** Completa a linha com "" até a largura fixa do grid. */
function pad(cells: SheetCell[]): SheetRow {
  const out = cells.slice(0, COMP_SHEET_COLS);
  while (out.length < COMP_SHEET_COLS) out.push("");
  return out;
}

/** Demonstrativo derivado uma única vez (resumo e bloco reusam). */
type Derived = {
  input: CompStatementInput;
  derived: ReturnType<typeof statementBreakdown>;
};

export function compSheetReport(
  inputs: CompStatementInput[],
  opts: { scope: CompSheetScope; monthLabel: string }
): CompSheetReport {
  const mine = opts.scope === "minha";
  const title = mine
    ? `Minha remuneração — ${opts.monthLabel}`
    : `Demonstrativo de remuneração — ${opts.monthLabel}`;

  // Agrupa por pessoa (ordem alfabética pt-BR); dentro da pessoa, ordem de
  // chegada (planos ativos). Escopo "minha" = grupo único sem rótulo.
  const groups = new Map<string, Derived[]>();
  for (const input of inputs) {
    const key = mine ? "" : input.memberLabel;
    const list = groups.get(key) ?? [];
    list.push({ input, derived: statementBreakdown(input) });
    groups.set(key, list);
  }
  const ordered = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .flatMap(([, list]) => list);

  const rows: SheetRow[] = [];
  const kinds: CompSheetRowKind[] = [];
  const push = (kind: CompSheetRowKind, cells: SheetCell[]) => {
    rows.push(pad(cells));
    kinds.push(kind);
  };

  // ---------- Quadro-resumo ----------
  push(
    "summaryHeader",
    mine
      ? ["Plano", "", "Base variável (R$)", "Fatores (R$)", "Comissão (R$)", "Bônus (R$)", "Total (R$)"]
      : ["Pessoa", "Plano", "Base variável (R$)", "Fatores (R$)", "Comissão (R$)", "Bônus (R$)", "Total (R$)"]
  );
  let sumFactors = 0;
  let sumCommission = 0;
  let hasCommission = false;
  let sumBonus = 0;
  let sumTotal = 0;
  let hasTotal = false;
  for (const { input, derived } of ordered) {
    const lead: SheetCell[] = mine
      ? [input.planName, ""]
      : [input.memberLabel, input.planName];
    if (!derived) {
      push("summary", [...lead, "", "", "", "", ""]);
      continue;
    }
    const { breakdown } = derived;
    const commission = breakdown.commission?.value ?? null;
    push("summary", [
      ...lead,
      breakdown.base,
      breakdown.factorsTotal,
      commission ?? "",
      breakdown.bonusTotal,
      breakdown.total ?? "",
    ]);
    sumFactors += breakdown.factorsTotal;
    if (commission != null) {
      sumCommission += commission;
      hasCommission = true;
    }
    sumBonus += breakdown.bonusTotal;
    if (breakdown.total != null) {
      sumTotal += breakdown.total;
      hasTotal = true;
    }
  }
  // Base variável NÃO soma (multiplica dentro dos fatores) — C3 vazio.
  push("summaryTotal", [
    "Total geral",
    "",
    "",
    roundMoney(sumFactors),
    hasCommission ? roundMoney(sumCommission) : "",
    roundMoney(sumBonus),
    hasTotal ? roundMoney(sumTotal) : "",
  ]);

  // ---------- Blocos de detalhe (mesma ordem do resumo) ----------
  for (const { input, derived } of ordered) {
    push("blank", []);
    const section = mine
      ? input.planName
      : input.memberLabel
        ? `${input.memberLabel} — ${input.planName}`
        : input.planName;
    push("section", [section]);
    if (!derived) {
      push("info", [SHEET_NO_ENTRY_NOTE]);
      continue;
    }
    const { breakdown, inputs: entryInputs } = derived;
    push("detailHeader", [
      "Item",
      "Alvo",
      "Realizado",
      "Atingimento",
      "Peso",
      "Valor (R$)",
      "Memória de cálculo",
    ]);
    for (const f of input.config.factors) {
      const b = breakdown.byFactor[f.id];
      if (!b) continue;
      push(f.money && !f.targetCurrency ? "factorMoney" : "factor", [
        f.label,
        b.target ?? "",
        b.realized ?? "",
        b.attainmentPct != null ? roundMoney(b.attainmentPct) : "",
        f.weightPct > 0 ? f.weightPct : "",
        // Paridade com o card: peso 0 sem override exibe "—" (aqui vazio).
        f.weightPct === 0 && !b.overridden.payout ? "" : b.payout,
        sheetFactorNote(f, b, breakdown.base),
      ]);
    }
    for (const cb of breakdown.commissionBlocks) {
      const mem = commissionMemory(cb);
      const memo =
        (mem.formula ? `${mem.formula} — ` : "") +
        mem.tierNote +
        (mem.memberTiers ? " · faixas do membro" : "");
      push("commission", [cb.label, "", "", "", "", cb.value, memo]);
    }
    if (
      breakdown.commission != null &&
      (breakdown.commission.overridden || breakdown.commissionBlocks.length > 1)
    ) {
      const calculated = breakdown.commissionBlocks.reduce(
        (a, b) => a + b.value,
        0
      );
      push("commission", [
        "Comissão (total)",
        "",
        "",
        "",
        "",
        breakdown.commission.value,
        sheetCommissionSumNote(breakdown.commission.overridden, calculated),
      ]);
    }
    for (const b of entryInputs.bonuses) {
      push("bonus", [
        b.label ? `Bônus — ${b.label}` : "Bônus",
        "",
        "",
        "",
        "",
        b.amount,
        "",
      ]);
    }
    // Base variável só quando participa do cálculo (fator com peso ou
    // comissão sobre a base) — em plano 100% por unidade a linha é ruído.
    const baseParticipates =
      input.config.factors.some((f) => f.weightPct > 0) ||
      (input.config.commissions ?? []).some((c) => c.basisKind === "base");
    if (baseParticipates) {
      push("info", [
        "Base variável",
        "",
        "",
        "",
        "",
        breakdown.base,
        SHEET_BASE_NOTE,
      ]);
    }
    push("blockTotal", [
      "Total",
      "",
      "",
      "",
      "",
      breakdown.total ?? "",
      sheetTotalNote(breakdown),
    ]);
  }

  return { headers: pad([title]) as string[], rows, kinds };
}
