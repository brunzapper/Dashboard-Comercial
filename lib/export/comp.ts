// Versão: 1.0 | Data: 02/08/2026
// Núcleo PURO do CSV de Remuneração (client-safe, sem DOM) — consumido pela
// Visão geral do admin (comp-overview) e pela visão do vendedor
// (my-comp-view). Formato LONGO (uma linha por item: fator/bloco de comissão/
// base/bônus/total) pensado p/ abrir direto no Google Planilhas/Excel pelas
// convenções de lib/export/csv.ts (";" + BOM; números via csvNumber). Deriva
// tudo NA HORA pelo MESMO computeEntry dos cards (nunca entry.total — pode
// estar stale) e a memória da comissão sai SÓ de commissionMemory
// (lib/comp/commission-label.ts, dono único dos textos). Sanitização contra
// CSV injection fica no buildCsv/sanitizeCsvCell — aqui as células saem cruas.
import {
  commissionMemory,
  fmtMoneyBRL,
} from "@/lib/comp/commission-label";
import {
  computeEntry,
  parseCompEntryInputs,
  roundMoney,
  type CompComputedRaw,
  type CompPlanConfig,
} from "@/lib/comp/model";
import { csvNumber } from "@/lib/export/csv";

/** Shape estrutural mínimo de comp_entries (evita importar tipos de components/). */
export interface CompEntryLike {
  responsible_id: string;
  base_amount: number | null;
  inputs: unknown;
  computed: unknown;
}

/** Um demonstrativo (plano × membro × mês) a exportar. */
export interface CompStatementInput {
  planName: string;
  memberLabel: string;
  config: CompPlanConfig; // já parseado (fail-closed no caller)
  baseAmountDefault: number | null;
  entry: CompEntryLike | null; // null = "sem lançamento no mês"
  targets: Record<string, number | null>; // factorId → alvo
  targetRates: Record<string, number | null>; // moeda → R$/unidade
}

export const COMP_CSV_HEADERS = [
  "Plano",
  "Pessoa",
  "Tipo",
  "Item",
  "Alvo",
  "Realizado",
  "Atingimento %",
  "Valor (R$)",
  "Observação",
];

/** Linhas do demonstrativo de UM plano×membro (mesma ordem do CompPlanCard). */
export function compStatementRows(input: CompStatementInput): string[][] {
  const row = (
    tipo: string,
    item: string,
    alvo: string,
    realizado: string,
    ating: string,
    valor: string,
    obs: string
  ): string[] => [
    input.planName,
    input.memberLabel,
    tipo,
    item,
    alvo,
    realizado,
    ating,
    valor,
    obs,
  ];

  if (!input.entry) {
    return [row("Total", "", "", "", "", "", "sem lançamento no mês")];
  }

  const computed = (input.entry.computed ?? null) as CompComputedRaw | null;
  const inputs = parseCompEntryInputs(input.entry.inputs);
  const breakdown = computeEntry(
    input.config,
    input.entry.base_amount ?? input.baseAmountDefault,
    inputs,
    computed?.realized ?? {},
    input.targets,
    input.entry.responsible_id,
    input.targetRates
  );

  const rows: string[][] = [];
  for (const f of input.config.factors) {
    const b = breakdown.byFactor[f.id];
    if (!b) continue;
    const notes: string[] = [`peso ${csvNumber(f.weightPct)}%`];
    if (b.targetSource === "default") notes.push("alvo padrão do plano");
    if (f.targetCurrency && b.target != null) {
      notes.push(
        b.targetRateMissing
          ? `sem cotação ${f.targetCurrency} — atingimento vazio`
          : `alvo em ${f.targetCurrency}` +
              (b.targetBRL != null ? ` ≈ ${fmtMoneyBRL(b.targetBRL)}` : "")
      );
    }
    if (b.overridden.realized) notes.push("realizado manual");
    if (b.overridden.attainmentPct) notes.push("atingimento manual");
    if (b.overridden.payout) notes.push("valor manual");
    if (f.weightPct === 0) notes.push("gatilho/base de comissão");
    rows.push(
      row(
        "Fator",
        f.label,
        b.target != null ? csvNumber(b.target) : "",
        b.realized != null ? csvNumber(b.realized) : "",
        b.attainmentPct != null ? csvNumber(roundMoney(b.attainmentPct)) : "",
        // Paridade com o card: peso 0 sem override exibe "—" (aqui vazio).
        f.weightPct === 0 && !b.overridden.payout ? "" : csvNumber(b.payout),
        notes.join(" · ")
      )
    );
  }

  for (const cb of breakdown.commissionBlocks) {
    const mem = commissionMemory(cb);
    const obs =
      (mem.formula ? `${mem.formula} — ` : "") +
      mem.tierNote +
      (mem.memberTiers ? " · faixas do membro" : "");
    rows.push(row("Comissão", cb.label, "", "", "", csvNumber(cb.value), obs));
  }
  // Linha da soma/override: só quando agrega algo além do bloco único (mesma
  // regra do CompPlanCard).
  if (
    breakdown.commission != null &&
    (breakdown.commission.overridden || breakdown.commissionBlocks.length > 1)
  ) {
    rows.push(
      row(
        "Comissão (total)",
        "",
        "",
        "",
        "",
        csvNumber(breakdown.commission.value),
        breakdown.commission.overridden ? "ajuste manual" : ""
      )
    );
  }

  rows.push(
    row(
      "Base variável",
      "",
      "",
      "",
      "",
      csvNumber(breakdown.base),
      "não soma no total — multiplica os fatores"
    )
  );
  for (const b of inputs.bonuses) {
    rows.push(row("Bônus", b.label, "", "", "", csvNumber(b.amount), ""));
  }

  const totalObs = breakdown.totalOverridden
    ? "total manual"
    : breakdown.totalFormulaError
      ? "fórmula do total sem resultado"
      : breakdown.totalFromFormula
        ? "total pela fórmula do plano"
        : "";
  rows.push(
    row(
      "Total",
      "",
      "",
      "",
      "",
      breakdown.total != null ? csvNumber(breakdown.total) : "",
      totalObs
    )
  );
  return rows;
}

/** Relatório inteiro (concatena demonstrativos na ordem recebida). */
export function compReportCsv(inputs: CompStatementInput[]): {
  headers: string[];
  rows: string[][];
} {
  return {
    headers: COMP_CSV_HEADERS,
    rows: inputs.flatMap(compStatementRows),
  };
}
