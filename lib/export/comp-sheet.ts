// Versão: 1.3 | Data: 27/08/2026
// v1.3: a planilha passou a ser lida por DOIS públicos com necessidades
// opostas — o colaborador ("quanto eu recebo e por quê?") e o RH ("quem recebe
// quanto, isso é final?"). O demonstrativo por pessoa (v1.1/v1.2) atendia só o
// primeiro. Entram, sem tocar nos cards:
// (a) BLOCO DE CONTEXTO no topo (kind `meta`) — competência, mês APURADO
//     (derivado de apuracaoRef; a diferença entre mês de pagamento e mês de
//     desempenho era invisível na planilha e é a 1ª dúvida de quem lê),
//     situação publicado/prévia (de comp_entries.published_at, com status
//     misto dito por extenso) e data de geração (paridade com o PDF);
// (b) RESUMO DA FOLHA (`rosterHeader`/`rosterRow`/`rosterTotal`) antes dos
//     cards, uma linha por pessoa com link p/ a aba Det-<Nome> — é a resposta
//     do RH na primeira tela; SUBSTITUI o antigo rodapé `summaryTotal` (que
//     obrigava a rolar a planilha inteira e só existia com 2+ pessoas);
// (c) LEGENDA das colunas no fim (`legendHeader`/`legend`);
// (d) peso 0 sem override passa a emitir "—" em vez de célula vazia — vazio
//     lê-se como dado faltando; e a coluna "Alvo" virou "Meta" (vocabulário
//     único, ver commission-label v1.12).
// A consolidação por pessoa virou UM cálculo (`summaries`) que o resumo, o
// cabeçalho do card e o fecho compartilham.
// Versão: 1.2 | Data: 16/08/2026
// v1.2: bloco da pessoa com INÍCIO e FIM marcados e navegação para o detalhe.
// (a) 2 linhas de respiro entre colaboradores (era 1); (b) `memberTotal` passa
// a fechar TODA pessoa — com um único plano o `blockTotal` do plano é
// suprimido (eram duas linhas "Total" idênticas) e o fecho herda a nota do
// total; (c) `links` (paralelo às rows) leva o nome da aba Det-<Nome> que o
// Apps Script transforma em hiperlink na coluna A da linha `section`, e
// `detailTabs` expõe o par rótulo→aba para o call site montar o detalhe.
// O nome da aba sai de `detailTabName` — PURO, para o cliente calcular os
// mesmos nomes que o servidor. O ramo do escopo "minha" saiu junto com o botão
// de export da tela do vendedor (o escopo segue no contrato/banco).
// v1.1: demonstrativo por COLABORADOR ("só blocos por pessoa") — sem
// quadro-resumo no topo: cada pessoa é UMA seção (nome 1×, total consolidado
// + composição no cabeçalho), com um sub-bloco por plano (`planHeader`) e
// `memberTotal` fechando pessoas de 2+ planos; "Total geral" vira rodapé (só
// com 2+ pessoas). "Peso" sai do header do detalhe quando nenhum fator tem
// peso e a linha "Base variável" só entra quando a base participa (comissão
// `flat` ignora o basis; `totalFormula` com comp:base usa a base).
// Builder PURO do DEMONSTRATIVO de remuneração p/ o Google Planilhas
// (payload v2 do export via Apps Script), na MESMA aba do mês: linha-título
// (viaja em `headers` — o script v1 a degrada como header bold) e blocos de
// detalhe por pessoa com a MEMÓRIA DE CÁLCULO como protagonista.
// Grid de largura FIXA (COMP_SHEET_COLS, padding "") + `kinds` paralelo às
// rows (1 por linha; whitelist em lib/comp/sheets-export.ts, dono do
// contrato) — o Apps Script formata por kind (moeda/%/bold/fundos/larguras).
// Deriva pelo MESMO computeEntry dos cards via `statementBreakdown`
// (lib/export/comp.ts — nunca entry.total) e TODA frase pt-BR sai de
// lib/comp/commission-label.ts (dono único — nada de texto novo aqui além de
// rótulos de coluna/junção, que são layout). O CSV (compReportCsv) segue
// byte-idêntico e NÃO passa por aqui.
import {
  bonusRowLabel,
  commissionMemory,
  sheetApuracaoNote,
  sheetCommissionSumNote,
  sheetCompetenciaNote,
  sheetFactorNote,
  sheetGeneratedNote,
  sheetRosterTotalNote,
  sheetStatusNote,
  sheetSummaryNote,
  sheetTotalNote,
  SHEET_BASE_NOTE,
  SHEET_LEGEND,
  SHEET_LEGEND_TITLE,
  SHEET_MEMBER_TOTAL_NOTE,
  SHEET_NO_ENTRY_NOTE,
  SHEET_ROSTER_DRAFT,
  SHEET_ROSTER_HEADERS,
  SHEET_ROSTER_PUBLISHED,
  SHEET_ROSTER_TITLE,
  SHEET_ROSTER_TOTAL_LABEL,
} from "@/lib/comp/commission-label";
import {
  apuracaoRef,
  COMP_BASE_REF,
  roundMoney,
  type CompPlanConfig,
} from "@/lib/comp/model";
import {
  detailTabName,
  type CompSheetRowKind,
} from "@/lib/comp/sheets-export";
import { MONTH_LABELS } from "@/lib/date/month-labels";
import { statementBreakdown, type CompStatementInput } from "./comp";

export const COMP_SHEET_COLS = 7;

export type SheetCell = string | number;
export type SheetRow = SheetCell[];

export interface CompSheetReport {
  headers: string[]; // linha-título (COMP_SHEET_COLS células; [0] = título)
  rows: SheetRow[]; // largura fixa COMP_SHEET_COLS
  kinds: CompSheetRowKind[]; // kinds.length === rows.length (título fora)
  // Paralelo a `rows`: nome da aba de detalhe que a coluna A deve linkar (o
  // `gid` só existe no Apps Script — a fórmula é montada LÁ). null = sem link.
  links: (string | null)[];
  // Pares rótulo→aba na MESMA ordem das seções, p/ o call site pedir o detalhe.
  detailTabs: { label: string; tabName: string }[];
}

/** Completa a linha com "" até a largura fixa do grid. */
export function padSheetRow(cells: SheetCell[]): SheetRow {
  const out = cells.slice(0, COMP_SHEET_COLS);
  while (out.length < COMP_SHEET_COLS) out.push("");
  return out;
}

/** Demonstrativo derivado uma única vez (cabeçalho da pessoa e bloco reusam). */
type Derived = {
  input: CompStatementInput;
  derived: ReturnType<typeof statementBreakdown>;
};

// A base participa quando multiplica algum fator (peso > 0), quando alguma
// comissão incide sobre ela (basisKind "base" — exceto `flat`, que ignora o
// basis e paga o valor fixo da faixa) ou quando a fórmula livre do total a
// referencia (comp:base). Fora disso a linha "Base variável" é ruído.
function baseParticipates(config: CompPlanConfig): boolean {
  if (config.factors.some((f) => f.weightPct > 0)) return true;
  const commissions = config.commissions ?? [];
  if (
    commissions.some(
      (c) => c.basisKind === "base" && (c.kind ?? "pct") !== "flat"
    )
  )
    return true;
  return (config.totalFormula?.tokens ?? []).some(
    (t) => t.kind === "field" && t.ref === COMP_BASE_REF
  );
}

export function compSheetReport(
  inputs: CompStatementInput[],
  opts: {
    monthLabel: string;
    // Mês do PAGAMENTO — usados para derivar a janela apurada (apuracaoRef).
    // Opcionais por compat: sem eles o bloco de contexto omite a linha de
    // apuração em vez de inventá-la.
    year?: number;
    month?: number;
    /** Injetável p/ teste; default = agora. */
    generatedAt?: Date;
  }
): CompSheetReport {
  const title = `Demonstrativo de remuneração — ${opts.monthLabel}`;

  // Agrupa por pessoa (ordem alfabética pt-BR); dentro da pessoa, ordem de
  // chegada (planos ativos).
  const groups = new Map<string, Derived[]>();
  for (const input of inputs) {
    const list = groups.get(input.memberLabel) ?? [];
    list.push({ input, derived: statementBreakdown(input) });
    groups.set(input.memberLabel, list);
  }
  const people = [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b, "pt-BR")
  );

  // Nome da aba de detalhe por pessoa, na ordem já ordenada — determinístico,
  // para o servidor chegar exatamente nos mesmos nomes.
  const taken = new Set<string>();
  const detailTabs = people.map(([label]) => ({
    label,
    tabName: detailTabName(label, taken),
  }));
  const tabByLabel = new Map(detailTabs.map((d) => [d.label, d.tabName]));

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

  // ---- Consolidação por pessoa, UMA vez: o resumo do topo, o cabeçalho do
  // card e o fecho da pessoa leem daqui (nunca dois caminhos p/ o mesmo total).
  const summaries = people.map(([label, list]) => {
    let factors = 0;
    let commission = 0;
    let hasCommission = false;
    let bonus = 0;
    let total = 0;
    let hasTotal = false;
    let entries = 0;
    let publishedEntries = 0;
    for (const { input, derived } of list) {
      if (input.entry) {
        entries += 1;
        if (input.entry.published_at) publishedEntries += 1;
      }
      if (!derived) continue;
      const { breakdown } = derived;
      factors += breakdown.factorsTotal;
      const c = breakdown.commission?.value ?? null;
      if (c != null) {
        commission += c;
        hasCommission = true;
      }
      bonus += breakdown.bonusTotal;
      if (breakdown.total != null) {
        total += breakdown.total;
        hasTotal = true;
      }
    }
    return {
      label,
      list,
      planNames: list.map((d) => d.input.planName).join(" · "),
      factors,
      commission,
      hasCommission,
      bonus,
      total,
      hasTotal,
      entries,
      publishedEntries,
    };
  });

  const grandTotal = summaries.reduce(
    (a, s) => a + (s.hasTotal ? s.total : 0),
    0
  );
  const grandHasTotal = summaries.some((s) => s.hasTotal);

  // ---- Contexto: de que mês é, sobre qual desempenho, e se o valor é final.
  // Vem antes de qualquer número — são as perguntas que o leitor faz primeiro.
  push("meta", [sheetCompetenciaNote(opts.monthLabel)]);
  if (opts.year != null && opts.month != null) {
    const shifted = inputs.filter((i) => i.config.apuracao === "mes_anterior");
    if (shifted.length > 0) {
      const ref = apuracaoRef(opts.year, opts.month, {
        apuracao: "mes_anterior",
      });
      push("meta", [
        sheetApuracaoNote(
          `${MONTH_LABELS[ref.month - 1]} de ${ref.year}`,
          shifted.length === inputs.length
        ),
      ]);
    }
  }
  push("meta", [
    sheetStatusNote(
      summaries.reduce((a, s) => a + s.publishedEntries, 0),
      summaries.reduce((a, s) => a + s.entries, 0)
    ),
  ]);
  push("meta", [sheetGeneratedNote(opts.generatedAt ?? new Date())]);

  // ---- Resumo da folha: a resposta do RH na primeira tela, com link p/ o
  // detalhe de cada pessoa. Os cards por pessoa seguem abaixo, intactos.
  push("blank", []);
  push("rosterHeader", [SHEET_ROSTER_TITLE]);
  push("rosterHeader", [...SHEET_ROSTER_HEADERS]);
  for (const s of summaries) {
    push(
      "rosterRow",
      [
        s.label,
        s.planNames,
        "",
        "",
        "",
        s.hasTotal ? roundMoney(s.total) : "",
        s.entries === 0
          ? SHEET_NO_ENTRY_NOTE
          : s.publishedEntries === s.entries
            ? SHEET_ROSTER_PUBLISHED
            : SHEET_ROSTER_DRAFT,
      ],
      tabByLabel.get(s.label) ?? null
    );
  }
  push("rosterTotal", [
    SHEET_ROSTER_TOTAL_LABEL,
    "",
    "",
    "",
    "",
    grandHasTotal ? roundMoney(grandTotal) : "",
    sheetRosterTotalNote(summaries.length),
  ]);

  for (const {
    label,
    list,
    factors,
    commission,
    hasCommission,
    bonus,
    total,
    hasTotal,
  } of summaries) {

    // Cabeçalho da pessoa (nome 1× + total resumido). Duas linhas de respiro
    // abrem o bloco — o script ainda reforça início/fim com fundo e borda.
    push("blank", []);
    push("blank", []);
    push(
      "section",
      [
        label,
        "",
        "",
        "",
        "",
        hasTotal ? roundMoney(total) : "",
        sheetSummaryNote(
          roundMoney(factors),
          hasCommission ? roundMoney(commission) : null,
          roundMoney(bonus)
        ),
      ],
      tabByLabel.get(label) ?? null
    );

    for (let i = 0; i < list.length; i++) {
      const { input, derived } = list[i];
      if (i > 0) push("blank", []);
      push("planHeader", [input.planName]);
      if (!derived) {
        push("info", [SHEET_NO_ENTRY_NOTE]);
        continue;
      }
      const { breakdown, inputs: entryInputs } = derived;
      push("detailHeader", [
        "Item",
        "Meta",
        "Realizado",
        "Atingimento",
        // Coluna sem uso no plano (nenhum indicador com peso) fica sem rótulo.
        input.config.factors.some((f) => f.weightPct > 0) ? "Peso" : "",
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
          // Peso 0 sem override não gera valor próprio: "—" (e não célula em
          // branco) diz que a ausência é deliberada — a legenda explica o
          // traço. Célula vazia lê-se como dado faltando.
          f.weightPct === 0 && !b.overridden.payout ? "—" : b.payout,
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
        (breakdown.commission.overridden ||
          breakdown.commissionBlocks.length > 1)
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
          bonusRowLabel(b.label),
          "",
          "",
          "",
          "",
          b.amount,
          "",
        ]);
      }
      if (baseParticipates(input.config)) {
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
      // Com um único plano o fecho da pessoa (abaixo) já é este total — duas
      // linhas "Total" idênticas seriam ruído.
      if (list.length > 1) {
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
    }

    // Fecho da pessoa — SEMPRE presente: é ele que marca o fim do bloco (bold
    // + fundo + borda no script). Com um plano, herda a nota daquele total.
    const only = list.length === 1 ? list[0].derived : null;
    push("memberTotal", [
      `Total — ${label}`,
      "",
      "",
      "",
      "",
      hasTotal ? roundMoney(total) : "",
      only ? sheetTotalNote(only.breakdown) : SHEET_MEMBER_TOTAL_NOTE,
    ]);
  }

  // Legenda no FIM: é material de consulta, não de abertura — quem já entende
  // as colunas não deveria rolar por cima dela para chegar aos números.
  // A definição vai na última coluna (a de prosa, que o script quebra e
  // limita); pôr texto longo numa coluna do meio alargaria a planilha inteira.
  push("blank", []);
  push("legendHeader", [SHEET_LEGEND_TITLE]);
  for (const [term, meaning] of SHEET_LEGEND) {
    push("legend", [term, "", "", "", "", "", meaning]);
  }

  return {
    headers: padSheetRow([title]) as string[],
    rows,
    kinds,
    links,
    detailTabs,
  };
}
