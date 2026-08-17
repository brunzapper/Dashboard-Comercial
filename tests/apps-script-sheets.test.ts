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

interface FakeSheet {
  _name: string;
  _id: number;
  _values: unknown[][] | null;
  _widths: Record<number, number>;
  _heights: Record<number, number>;
  _styles: Styles;
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
    getName() { return sh._name; },
    setName(n: string) { sh._name = n; return sh; },
    getSheetId() { return sh._id; },
    getLastRow() { return sh._values ? sh._values.length : 0; },
    clear() { sh._values = null; return sh; },
    getRange() {
      return new Proxy(
        {},
        {
          get: (_t, prop) =>
            prop === "setValues"
              ? (v: unknown[][]) => { sh._values = v; return chain; }
              : () => chain,
        }
      );
    },
    // Estilo vai em LOTE (getRangeList(a1s).setX()): registra método → faixas,
    // que é o único jeito de pinar "este kind saiu em negrito/itálico".
    getRangeList(a1s: string[]) {
      const rec: Record<string, () => unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => () => {
            const k = String(prop);
            sh._styles[k] = [...(sh._styles[k] ?? []), ...a1s];
            return rec;
          },
        }
      ) as Record<string, () => unknown>;
      return rec;
    },
    setColumnWidth(c: number, w: number) { sh._widths[c] = w; return sh; },
    setRowHeight(r: number, h: number) { sh._heights[r] = h; return sh; },
    setFrozenRows: () => sh,
    autoResizeRows: () => sh,
    autoResizeColumns: () => sh,
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
    SpreadsheetApp: { BorderStyle: { SOLID_MEDIUM: "SOLID_MEDIUM" } },
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

  it("resolve o hiperlink com o gid REAL da aba de destino (duas passadas)", () => {
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    const mes = ss.getSheetByName("Agosto 2026")!;
    const gidAna = ss.getSheetByName("Det-Ana")!.getSheetId();
    // +1 da linha-título: a 3ª row (`section` da Ana) está no índice 3.
    expect(mes._values![3][0]).toBe(`=HYPERLINK("#gid=${gidAna}","Ana")`);
    // E a volta aponta p/ a aba do mês.
    const det = ss.getSheetByName("Det-Ana")!;
    expect(det._values![1][0]).toBe(
      `=HYPERLINK("#gid=${mes.getSheetId()}","← Voltar para a visão geral")`
    );
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

  it("larguras próprias nas abas de detalhe e altura extra nas seções", () => {
    const ss = makeSpreadsheet(["Agosto 2026"]);
    gs.gravarPlanilha_(ss, PAYLOAD_V3);
    expect(Object.keys(ss.getSheetByName("Det-Ana")!._widths)).toHaveLength(7);
    // Uma altura por linha `section` (as duas pessoas).
    expect(Object.keys(ss.getSheetByName("Agosto 2026")!._heights)).toHaveLength(2);
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
