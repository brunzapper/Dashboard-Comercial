// Versão: 1.2 | Data: 22/08/2026
// v1.2: o pino do hiperlink passou a ser o LINK (rich text), não a string da
// fórmula. Foi essa afirmação sobre a string que deixou passar o #ERROR!: a
// fórmula que o script escrevia era válida em US, e a planilha é pt-BR.
// Versão: 1.1 | Data: 17/08/2026
// v1.1: o fake passou a registrar o estilo em LOTE (getRangeList(a1s).setX()),
// o que permite pinar os kinds da memória de cálculo (v3.1 do script):
// `detailMemory` em itálico, `detailTierApplied` em negrito e a escada FORA da
// formatação numérica (o valor do degrau já vem formatado no payload).
// Versão: 1.0 | Data: 16/08/2026
// Guarda do Apps Script do export da Remuneração
// (integrations/apps-script/comp_sheets_webapp.gs). O arquivo não é importável
// pelo app (roda no Google), então aqui ele é AVALIADO num `vm` com stubs
// mínimos de SpreadsheetApp e exercitado com payloads reais — é a única
// cobertura possível de um script que só existe publicado.
//
// O que está pinado é o que o rendering promete ao resto do sistema: abas de
// detalhamento criadas, hiperlinks resolvidos com o `gid` REAL (por isso as
// duas passadas), limpeza das abas `Det-*` órfãs SÓ com payload v3 e as duas
// degradações documentadas (ticket v2 e payload v1).
//
// Regressão que originou o arquivo: numa planilha NOVA, a heurística "aba
// default vazia é reaproveitada" casava em TODA aba (na passada 1 nenhuma tem
// valores ainda) e o script renomeava a mesma aba repetidamente, terminando
// com uma aba só.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";

import { beforeEach, describe, expect, it } from "vitest";

const GS_PATH = path.resolve(
  __dirname,
  "../integrations/apps-script/comp_sheets_webapp.gs"
);

/** Estilo aplicado em lote: método → notações A1 alcançadas. */
type Styles = Record<string, string[]>;

/** Uma chamada setBorder em lote: as faixas alvo + os argumentos crus. */
interface BorderCall {
  ranges: string[];
  args: unknown[];
}

interface FakeSheet {
  _name: string;
  _id: number;
  _values: unknown[][] | null;
  _widths: Record<number, number>;
  _heights: Record<number, number>;
  _styles: Styles;
  /** Links aplicados por rich text: linha A1 → { texto, url }. */
  _links: Record<number, { text: string; url: string }>;
  /** Uma entrada por chamada getRangeList(...).setBorder(...). */
  _borders: BorderCall[];
  /** Uma entrada por chamada autoResizeColumns(from, to). */
  _autoResizeCols: [number, number][];
  /** Colunas que receberam setWrap(true) — as que estouraram o teto. */
  _wrapped: Set<number>;
  /** Linhas de grade do Sheets escondidas nesta aba. */
  _gridlinesHidden: boolean;
  getName(): string;
  setName(n: string): FakeSheet;
  getSheetId(): number;
  getLastRow(): number;
  clear(): FakeSheet;
  [k: string]: unknown;
}

function makeSheet(name: string, id: number): FakeSheet {
  const chain = new Proxy(
    {},
    { get: () => () => chain }
  ) as Record<string, () => unknown>;
  const sh: FakeSheet = {
    _name: name,
    _id: id,
    _values: null,
    _widths: {},
    _heights: {},
    _styles: {},
    _links: {},
    _borders: [],
    _autoResizeCols: [],
    _wrapped: new Set<number>(),
    _gridlinesHidden: false,
    getName() { return sh._name; },
    setName(n: string) { sh._name = n; return sh; },
    getSheetId() { return sh._id; },
    getLastRow() { return sh._values ? sh._values.length : 0; },
    clear() { sh._values = null; return sh; },
    getRange(row?: number, col?: number) {
      return new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "setValues")
              return (v: unknown[][]) => { sh._values = v; return chain; };
            // Link por rich text: é o que substituiu a fórmula =HYPERLINK.
            if (prop === "setRichTextValue")
              return (v: { text: string; url: string }) => {
                if (row != null) sh._links[row] = v;
                return chain;
              };
            // Quebra de linha: só a coluna que estourou o teto de largura.
            if (prop === "setWrap")
              return (on: boolean) => {
                if (col != null && on) sh._wrapped.add(col);
                return chain;
              };
            return () => chain;
          },
        }
      );
    },
    // Estilo vai em LOTE (getRangeList(a1s).setX()): registra método → faixas
    // (+ args crus p/ setBorder, o único que precisa dos parâmetros p/ pinar
    // "isto é caixa externa" × "isto é divisória interna").
    getRangeList(a1s: string[]) {
      const rec: Record<string, (...args: unknown[]) => unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => (...args: unknown[]) => {
            const k = String(prop);
            sh._styles[k] = [...(sh._styles[k] ?? []), ...a1s];
            if (k === "setBorder") sh._borders.push({ ranges: a1s, args });
            return rec;
          },
        }
      ) as Record<string, (...args: unknown[]) => unknown>;
      return rec;
    },
    setColumnWidth(c: number, w: number) { sh._widths[c] = w; return sh; },
    getColumnWidth(c: number) { return sh._widths[c] ?? 100; },
    setRowHeight(r: number, h: number) { sh._heights[r] = h; return sh; },
    setFrozenRows: () => sh,
    setHiddenGridlines(hide: boolean) { sh._gridlinesHidden = hide; return sh; },
    autoResizeRows: () => sh,
    // Simula o ajuste ao conteúdo (≈7px por caractere da célula mais longa) —
    // é o que torna o TETO de largura observável no teste.
    autoResizeColumns(from: number, to: number) {
      sh._autoResizeCols.push([from, to]);
      for (let c = from; c <= to; c++) {
        let max = 0;
        for (const row of sh._values ?? []) {
          max = Math.max(max, String(row[c - 1] ?? "").length);
        }
        sh._widths[c] = Math.max(40, max * 7);
      }
      return sh;
    },
  };
  return sh;
}

function makeSpreadsheet(abas: string[]) {
  let nextId = 100;
  return {
    _sheets: abas.map((n) => makeSheet(n, nextId++)),
    names(): string[] {
      return this._sheets.map((s: FakeSheet) => s.getName());
    },
    getSheets() { return this._sheets.slice(); },
    getSheetByName(n: string) {
      return this._sheets.find((s: FakeSheet) => s.getName() === n) ?? null;
    },
    insertSheet(n: string) {
      const s = makeSheet(n, nextId++);
      this._sheets.push(s);
      return s;
    },
    deleteSheet(s: FakeSheet) {
      this._sheets = this._sheets.filter((x: FakeSheet) => x !== s);
    },
    getSpreadsheetLocale: () => "pt_BR",
    setSpreadsheetLocale: () => undefined,
  };
}

type Gs = {
  gravarPlanilha_: (ss: unknown, data: Record<string, unknown>) => void;
};

function loadGs(): Gs {
  const sandbox: Record<string, unknown> = {
    SpreadsheetApp: {
      BorderStyle: { SOLID_MEDIUM: "SOLID_MEDIUM", SOLID: "SOLID" },
      // Builder encadeável que devolve { text, url } no build().
      newRichTextValue: () => {
        const v: { text: string; url: string } = { text: "", url: "" };
        const b = {
          setText: (t: string) => { v.text = t; return b; },
          setLinkUrl: (u: string) => { v.url = u; return b; },
          build: () => v,
        };
        return b;
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    UrlFetchApp: {},
    DriveApp: {},
    HtmlService: { createHtmlOutput: () => ({ setTitle: () => ({}) }) },
  };
  createContext(sandbox);
  runInContext(readFileSync(GS_PATH, "utf8"), sandbox);
  return sandbox as unknown as Gs;
}

const pad = (cells: (string | number)[]) => {
  const r = cells.slice(0, 7);
  while (r.length < 7) r.push("");
  return r;
};

const detalhe = (nome: string) => ({
  tabName: `Det-${nome}`,
  headers: pad([`Detalhamento — ${nome} — Agosto de 2026`]),
  rows: [
    pad(["← Voltar para a visão geral"]),
    pad(["Vendas", "", "", "", "", 300, "Soma de Valor · 2 registros no recorte"]),
    pad(["Data", "Registro", "Base", "Responsável", "Etapa", "Valor", "Observações"]),
    pad(["01/08/2026", "Negócio 1", "Negócios", nome, "Ganho", 100, ""]),
    pad(["Subtotal — Vendas", "", "", "", "", 300, "confere"]),
    pad([`Total — ${nome}`, "", "", "", "", 1050, ""]),
  ],
  kinds: [
    "detailBack",
    "detailFactorMoney",
    "detailHeader",
    "detailRowMoney",
    "detailSubtotalMoney",
    "memberTotal",
  ],
  links: ["Agosto 2026", null, null, null, null, null],
});

const PAYLOAD_V3 = {
  tabName: "Agosto 2026",
  headers: pad(["Demonstrativo de remuneração — Agosto de 2026"]),
  rows: [
    pad([]),
    pad([]),
    pad(["Ana", "", "", "", "", 1050, "Fatores + Comissão"]),
    pad(["Plano A"]),
    pad(["Total — Ana", "", "", "", "", 1050, ""]),
    pad([]),
    pad([]),
    pad(["Bruno", "", "", "", "", 500, ""]),
    pad(["Plano B"]),
    pad(["Total — Bruno", "", "", "", "", 500, ""]),
  ],
  kinds: [
    "blank", "blank", "section", "planHeader", "memberTotal",
    "blank", "blank", "section", "planHeader", "memberTotal",
  ],
  links: [null, null, "Det-Ana", null, null, null, null, "Det-Bruno", null, null],
  details: [detalhe("Ana"), detalhe("Bruno")],
};

describe("comp_sheets_webapp.gs — rendering v3", () => {
  let gs: Gs;
  beforeEach(() => {
    gs = loadGs();
  });

  it("cria uma aba por colaborador e preserva a aba do mês", () => {
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    expect(ss.names().sort()).toEqual(["Agosto 2026", "Det-Ana", "Det-Bruno"]);
  });

  it("liga com o gid REAL por RICH TEXT, nunca por fórmula (duas passadas)", () => {
    // A fórmula =HYPERLINK escrita por setValues é parseada no LOCALE da
    // planilha; em pt-BR (que o script força) o separador é ';' e a fórmula
    // com ',' virava #ERROR! em toda célula de link. Rich text não tem
    // sintaxe para errar — por isso o pino é o LINK, não a string.
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    const mes = ss.getSheetByName("Agosto 2026")!;
    const gidAna = ss.getSheetByName("Det-Ana")!.getSheetId();
    // +1 da linha-título: a 3ª row (`section` da Ana) está na linha A1 4.
    expect(mes._links[4]).toEqual({ text: "Ana", url: `#gid=${gidAna}` });
    // A célula guarda o RÓTULO, não uma fórmula.
    expect(mes._values![3][0]).toBe("Ana");
    // E a volta aponta p/ a aba do mês.
    const det = ss.getSheetByName("Det-Ana")!;
    expect(det._links[2]).toEqual({
      text: "← Voltar para a visão geral",
      url: `#gid=${mes.getSheetId()}`,
    });
    expect(det._values![1][0]).toBe("← Voltar para a visão geral");
    // Nenhuma célula pode sair como fórmula.
    const todas = [...mes._values!, ...det._values!].flat();
    expect(todas.some((c) => String(c).startsWith("="))).toBe(false);
  });

  it("apaga abas Det-* órfãs, mas nunca a última aba da planilha", () => {
    const ss = makeSpreadsheet(["Agosto 2026", "Det-Antigo"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    expect(ss.names()).not.toContain("Det-Antigo");

    const so = makeSpreadsheet(["Det-Sozinha"]);
    gs.gravarPlanilha_(so, { ...PAYLOAD_V3, details: [] });
    expect(so.names().length).toBeGreaterThan(0);
  });

  it("planilha NOVA: a aba default é reaproveitada UMA vez só", () => {
    // Regressão: na passada 1 nenhuma aba tem valores, então a heurística
    // "uma aba vazia" casaria em todas e renomearia sempre a MESMA.
    const ss = makeSpreadsheet(["Página1"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    expect(ss.names().sort()).toEqual(["Agosto 2026", "Det-Ana", "Det-Bruno"]);
  });

  it("largura ajustada ao conteúdo, com TETO e quebra na coluna que estoura", () => {
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    const mes = ss.getSheetByName("Agosto 2026")!;
    // O ajuste cobre as 7 colunas do grid, nas duas abas.
    expect(mes._autoResizeCols).toEqual([[1, 7]]);
    expect(ss.getSheetByName("Det-Ana")!._autoResizeCols).toEqual([[1, 7]]);
    // Uma altura por linha `section` (as duas pessoas).
    expect(Object.keys(mes._heights)).toHaveLength(2);

    // Com uma memória de cálculo de tamanho REAL, a coluna G estoura o teto:
    // é fixada nele e ganha quebra de linha (sem isso ela empurraria as demais
    // colunas para fora da tela). As curtas seguem justas ao conteúdo.
    const longo = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(longo, {
      ...PAYLOAD_V3,
      rows: [
        ...PAYLOAD_V3.rows,
        pad([
          "Vendas", 50000, 42000, 84, 60, 1080,
          "R$ 3.000,00 × 60% × 84% = R$ 1.512,00 · Meta padrão do plano · Realizado informado manualmente",
        ]),
      ],
      kinds: [...PAYLOAD_V3.kinds, "factorMoney"],
      links: [...PAYLOAD_V3.links, null],
    });
    const sh = longo.getSheetByName("Agosto 2026")!;
    for (const w of Object.values(sh._widths)) expect(w).toBeLessThanOrEqual(420);
    expect(sh._widths[7]).toBe(420);
    expect(sh._wrapped.has(7)).toBe(true);
    expect(sh._wrapped.has(4)).toBe(false);
  });

  it("card da pessoa (visão geral): caixa externa + divisórias verticais, nunca horizontal", () => {
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    const mes = ss.getSheetByName("Agosto 2026")!;
    // Ana: section na linha A1 4, memberTotal na 6. Bruno: 9 e 11.
    const caixaAna = mes._borders.find(
      (b) => b.ranges.includes("A4:G6") && b.args[4] == null && b.args[5] == null
    );
    const verticalAna = mes._borders.find(
      (b) => b.ranges.includes("A4:G6") && b.args[4] === true
    );
    expect(caixaAna).toBeTruthy();
    expect(caixaAna!.args.slice(0, 4)).toEqual([true, true, true, true]);
    expect(verticalAna).toBeTruthy();
    // Nenhuma faixa horizontal (args[5]) é desenhada em nenhuma chamada do card.
    expect(mes._borders.some((b) => b.ranges.includes("A4:G6") && b.args[5] === true)).toBe(false);
    expect(mes._borders.some((b) => b.ranges.includes("A9:G11"))).toBe(true);
  });

  it("tabela de registros (detalhamento): caixa externa + só o cabeçalho com régua horizontal", () => {
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    const det = ss.getSheetByName("Det-Ana")!;
    // detailHeader na linha A1 4, detailSubtotalMoney na 6 (ver `detalhe()`).
    const caixa = det._borders.find(
      (b) => b.ranges.includes("A4:G6") && b.args[4] == null
    );
    expect(caixa).toBeTruthy();
    expect(caixa!.args.slice(0, 4)).toEqual([true, true, true, true]);
    // Só a linha do cabeçalho (A4:G4) ganha a régua horizontal — nenhuma
    // outra linha da tabela (registro ou subtotal) é tocada.
    const regua = det._borders.find(
      (b) => b.ranges.includes("A4:G4") && b.args[2] === true
    );
    expect(regua).toBeTruthy();
    expect(det._borders.some((b) => b.ranges.includes("A5:G5"))).toBe(false);
    expect(det._borders.some((b) => b.ranges.includes("A6:G6"))).toBe(false);
  });

  it("memória e escada: nota em itálico, faixa aplicada em negrito, texto sem moeda", () => {
    // A escada carrega o valor JÁ FORMATADO (a unidade muda por tipo de
    // bloco), então formatar como moeda estragaria a linha da comissão %.
    const det = {
      tabName: "Det-Ana",
      headers: pad(["Detalhamento — Ana — Agosto de 2026"]),
      rows: [
        pad(["Vendas", "", "", "", "", 300, "R$ 1.000,00 × 60% × 90% = R$ 540,00"]),
        pad(["Cada reunião vale R$ 12,50."]),
        pad(["A partir de 0", "", "", "", "", "R$ 10,00", "alcançada"]),
        pad(["A partir de 40", "", "", "", "", "R$ 12,50", "faixa aplicada"]),
        pad(["A partir de 80", "", "", "", "", "R$ 15,00", "não alcançada"]),
        pad(["Total — Ana", "", "", "", "", 1050, ""]),
      ],
      kinds: [
        "detailFactorMoney",
        "detailMemory",
        "detailTier",
        "detailTierApplied",
        "detailTier",
        "memberTotal",
      ],
      links: [null, null, null, null, null, null],
    };
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, { ...PAYLOAD_V3, details: [det] });
    const estilos = ss.getSheetByName("Det-Ana")!._styles;
    // rows[i] mora na linha A1 i+2 (o título ocupa a 1).
    expect(estilos.setFontStyle).toContain("A3:G3"); // detailMemory
    expect(estilos.setFontWeight).toContain("A5:G5"); // detailTierApplied
    expect(estilos.setFontWeight).not.toContain("A4:G4"); // detailTier comum
    // Nenhuma linha da escada entra na formatação numérica (moeda ou %).
    const linhasFormatadas = new Set(
      (estilos.setNumberFormat ?? []).map((a1) =>
        Number(a1.split(":")[0].replace(/[A-Z]/g, ""))
      )
    );
    for (const r of [4, 5, 6]) expect(linhasFormatadas.has(r)).toBe(false);
  });

  it("contexto, resumo da folha e legenda: estilos próprios e link por pessoa", () => {
    // O resumo é a resposta do RH na primeira tela: fundo próprio, caixa em
    // volta e o nome de cada pessoa ligado à aba de detalhe dela.
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, {
      ...PAYLOAD_V3,
      rows: [
        pad(["Competência: Agosto de 2026"]),
        pad(["Desempenho apurado sobre: Julho de 2026"]),
        pad(["Situação: prévia — ainda não publicado"]),
        pad([]),
        pad(["Resumo do mês"]),
        pad(["Colaborador", "Plano", "", "", "", "Total (R$)", "Situação"]),
        pad(["Ana", "Plano A", "", "", "", 1050, "Prévia"]),
        pad(["Total geral", "", "", "", "", 1050, "1 colaborador"]),
        pad(["Como ler este demonstrativo"]),
        pad(["Meta", "", "", "", "", "", "Quanto era esperado no período."]),
      ],
      kinds: [
        "meta", "meta", "meta", "blank",
        "rosterHeader", "rosterHeader", "rosterRow", "rosterTotal",
        "legendHeader", "legend",
      ],
      links: [null, null, null, null, null, null, "Det-Ana", null, null, null],
      details: [detalhe("Ana")],
    });
    const mes = ss.getSheetByName("Agosto 2026")!;
    const est = mes._styles;
    // Contexto e legenda em itálico discreto (rows[i] → linha A1 i+2).
    expect(est.setFontStyle).toContain("A2:G2"); // meta
    expect(est.setFontStyle).toContain("A11:G11"); // legend
    // Cabeçalhos do resumo e o fecho em negrito; a linha da pessoa não.
    expect(est.setFontWeight).toContain("A6:G6");
    expect(est.setFontWeight).toContain("A9:G9"); // rosterTotal
    expect(est.setFontWeight).not.toContain("A8:G8"); // rosterRow
    // Fundo próprio do resumo (nem cabeçalho de tabela, nem bloco de pessoa).
    expect(est.setBackground).toContain("A6:G6");
    // Caixa do resumo, do 1º rosterHeader ao rosterTotal.
    expect(mes._borders.some((b) => b.ranges.includes("A6:G9"))).toBe(true);
    // O nome da pessoa no resumo leva à aba de detalhe dela.
    expect(mes._links[8]).toEqual({
      text: "Ana",
      url: `#gid=${ss.getSheetByName("Det-Ana")!.getSheetId()}`,
    });
    // O total do resumo é moeda.
    expect(est.setNumberFormat).toContain("F9:F9");
  });

  it("linhas de grade do Sheets desligadas em TODA aba", () => {
    // A grade nativa risca a planilha inteira, inclusive o vazio entre um card
    // e outro, competindo com as bordas que o demonstrativo desenha.
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    for (const nome of ["Agosto 2026", "Det-Ana", "Det-Bruno"]) {
      expect(ss.getSheetByName(nome)!._gridlinesHidden).toBe(true);
    }
  });

  it("tabela de registros: divisórias VERTICAIS além da caixa e da régua do cabeçalho", () => {
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    const det = ss.getSheetByName("Det-Ana")!;
    // detailHeader na linha A1 4, detailSubtotalMoney na 6 (ver `detalhe()`).
    const verticais = det._borders.find(
      (b) => b.ranges.includes("A4:G6") && b.args[4] === true
    );
    expect(verticais).toBeTruthy();
    // A caixa externa segue lá, e nenhuma horizontal interna foi adicionada.
    expect(
      det._borders.some(
        (b) => b.ranges.includes("A4:G6") && b.args.slice(0, 4).every((x) => x === true)
      )
    ).toBe(true);
    expect(
      det._borders.some((b) => b.ranges.includes("A4:G6") && b.args[5] === true)
    ).toBe(false);
  });

  it('"Quanto gerou (R$)" sai como moeda mesmo em fator de contagem', () => {
    // A coluna G é sempre reais — é quanto o registro rendeu de remuneração.
    // Um fator de CONTAGEM também gera dinheiro, então a variante não-Money
    // precisa formatar a G (só ela; a F ali é contagem crua).
    const det = {
      tabName: "Det-Ana",
      headers: pad(["Detalhamento — Ana — Agosto de 2026"]),
      rows: [
        pad(["Reuniões", "", "", "", "", 44, "44 × R$ 12,50 = R$ 550,00"]),
        pad(["Data", "Registro", "Origem", "Responsável", "Etapa", "Reuniões", "Quanto gerou (R$)"]),
        pad(["01/08/2026", "Empresa X", "Reuniões", "Ana", "Realizada", 1, 12.5]),
        pad(["Subtotal — Reuniões", "", "", "", 44, 44, ""]),
      ],
      kinds: ["detailFactor", "detailHeader", "detailRow", "detailSubtotal"],
      links: [null, null, null, null],
    };
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, { ...PAYLOAD_V3, details: [det] });
    const fmt = ss.getSheetByName("Det-Ana")!._styles.setNumberFormat ?? [];
    // rows[2] (`detailRow`) mora na linha A1 4: a G entra, a F não.
    expect(fmt).toContain("G4:G4");
    expect(fmt).not.toContain("F4:F4");

    // Na variante Money a G também estava de fora (só a F era formatada).
    const outra = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(outra, PAYLOAD_V3);
    const fmtMoney = outra.getSheetByName("Det-Ana")!._styles.setNumberFormat ?? [];
    // `detailRowMoney` é a 4ª row do fixture → linha A1 5.
    expect(fmtMoney).toContain("F5:F5");
    expect(fmtMoney).toContain("G5:G5");
  });

  it("aba de detalhe malformada é ignorada sem derrubar o export", () => {
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, {
      ...PAYLOAD_V3,
      details: [{ tabName: "Det-Quebrada", rows: [], kinds: ["a"] }],
    });
    expect(ss.names()).toEqual(["Agosto 2026"]);
  });
});

describe("comp_sheets_webapp.gs — degradações documentadas", () => {
  it("ticket v2 (sem details/links): só a aba do mês, abas Det-* preservadas", () => {
    const gs = loadGs();
    const ss = makeSpreadsheet(["Agosto 2026", "Det-Ana"]);
    gs.gravarPlanilha_(ss, {
      ...PAYLOAD_V3,
      links: null,
      details: null,
    });
    // Um ticket antigo não conhece as abas de detalhe — não pode varrê-las.
    expect(ss.names()).toContain("Det-Ana");
    // Sem links, a coluna A fica com o texto puro (nada de fórmula).
    expect(ss.getSheetByName("Agosto 2026")!._values![3][0]).toBe("Ana");
  });

  it("payload v1 (sem kinds): rendering simples do grid cru", () => {
    const gs = loadGs();
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, {
      tabName: "Agosto 2026",
      headers: ["A", "B"],
      rows: [["x", 1]],
      kinds: null,
      details: null,
    });
    expect(ss.getSheetByName("Agosto 2026")!._values).toEqual([
      ["A", "B"],
      ["x", 1],
    ]);
  });
});
