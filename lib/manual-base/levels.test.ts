// Versão: 1.0 | Data: 18/09/2026
// A regra de níveis, exercitada sobre a FIXTURE LITERAL do pedido que originou
// a feature. Se um destes casos cair, o número que um dashboard mostra mudou.
import { describe, it, expect } from "vitest";

import {
  coordsMatchFilters,
  manualLevels,
  resolveManualLevel,
  type ManualCoordFilter,
} from "./levels";
import { manualLevelKey, type ManualCoords } from "./families";
import type { ManualEntry } from "./types";

let seq = 0;
function entry(value: number, coords: ManualCoords): ManualEntry {
  return {
    id: `e${++seq}`,
    series_id: "s1",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    value,
    responsible_id: null,
    operation_id: null,
    spread: "ancora",
    note: null,
    coords,
  };
}

// "Total de interações com clientes" em agosto, nas QUATRO leituras do MESMO
// 1000 que o usuário descreveu.
const TOTAL = [entry(1000, {})];
const POR_CANAL = [
  entry(500, { canal: "ligacao" }),
  entry(500, { canal: "email" }),
];
const POR_RESP = [
  entry(200, { resp: "paulo" }),
  entry(400, { resp: "gabriella" }),
  entry(350, { resp: "daniela" }),
  // "50 sem responsável direto" — RESIDUAL declarado, não ausência.
  entry(50, { resp: null }),
];
const CRUZAMENTO = [
  entry(100, { canal: "ligacao", resp: "paulo" }),
  entry(250, { canal: "ligacao", resp: "gabriella" }),
  entry(150, { canal: "ligacao", resp: "daniela" }),
];
const TUDO = [...TOTAL, ...POR_CANAL, ...POR_RESP, ...CRUZAMENTO];

const soma = (es: readonly ManualEntry[]) =>
  es.reduce((acc, e) => acc + e.value, 0);

const pedido = (
  dimAxes: string[] = [],
  filters: ManualCoordFilter[] = []
) => ({ dimAxes, filters });

describe("manualLevels", () => {
  it("enumera os níveis presentes, dos mais grossos aos mais finos", () => {
    expect(manualLevels(TUDO).map(manualLevelKey)).toEqual([
      "",
      "canal",
      "resp",
      "canal|resp",
    ]);
  });

  it("não inventa nível: base legada só tem o nível vazio", () => {
    expect(manualLevels(TOTAL).map(manualLevelKey)).toEqual([""]);
  });
});

describe("resolveManualLevel — a regra que impede a contagem dobrada", () => {
  // O caso que justifica a feature inteira: somar os quatro níveis daria 3500.
  it("NUNCA soma níveis entre si", () => {
    expect(soma(TUDO)).toBe(3500);
    const res = resolveManualLevel(TUDO, pedido());
    expect(soma(res!.entries)).toBe(1000);
  });

  it("card sem nada escolhe o nível ∅ — o total lançado à mão vence", () => {
    const res = resolveManualLevel(TUDO, pedido())!;
    expect(res.level).toEqual([]);
    expect(soma(res.entries)).toBe(1000);
    expect(res.collapsed).toEqual([]);
  });

  it("gráfico por Canal escolhe {canal}, não o cruzamento incompleto", () => {
    const res = resolveManualLevel(TUDO, pedido(["canal"]))!;
    expect(res.level).toEqual(["canal"]);
    expect(soma(res.entries)).toBe(1000);
    expect(res.entries).toHaveLength(2);
  });

  it("gráfico por Responsável inclui o residual declarado", () => {
    const res = resolveManualLevel(TUDO, pedido(["resp"]))!;
    expect(res.level).toEqual(["resp"]);
    expect(soma(res.entries)).toBe(1000);
    expect(res.entries).toHaveLength(4);
  });

  it("tabela Canal × Responsável escolhe o cruzamento — e ele soma 500, não 1000", () => {
    const res = resolveManualLevel(TUDO, pedido(["canal", "resp"]))!;
    expect(res.level).toEqual(["canal", "resp"]);
    expect(soma(res.entries)).toBe(500);
    expect(res.collapsed).toEqual([]);
  });

  it("card de um membro: filtro entra no nível pedido e depois soma embora", () => {
    const res = resolveManualLevel(
      TUDO,
      pedido([], [{ axis: "canal", members: ["ligacao"] }])
    )!;
    expect(res.level).toEqual(["canal"]);
    expect(soma(res.entries)).toBe(500);
    expect(res.collapsed).toEqual(["canal"]);
  });

  it("card de uma célula do cruzamento (dois filtros)", () => {
    const res = resolveManualLevel(
      TUDO,
      pedido(
        [],
        [
          { axis: "canal", members: ["ligacao"] },
          { axis: "resp", members: ["paulo"] },
        ]
      )
    )!;
    expect(res.level).toEqual(["canal", "resp"]);
    expect(soma(res.entries)).toBe(100);
  });

  it("dimensão + filtro da OUTRA família cai no cruzamento", () => {
    const res = resolveManualLevel(
      TUDO,
      pedido(["canal"], [{ axis: "resp", members: ["paulo"] }])
    )!;
    expect(res.level).toEqual(["canal", "resp"]);
    expect(soma(res.entries)).toBe(100);
    expect(res.collapsed).toEqual(["resp"]);
  });

  // A decisão de produto "sem o total lançado, soma a família mais grossa".
  it("sem o nível ∅, um card soma embora a família mais grossa", () => {
    const res = resolveManualLevel([...POR_CANAL], pedido())!;
    expect(res.level).toEqual(["canal"]);
    expect(soma(res.entries)).toBe(1000);
    expect(res.collapsed).toEqual(["canal"]);
  });

  it("entre duas famílias disponíveis, a escolha é determinística", () => {
    const a = resolveManualLevel([...POR_CANAL, ...POR_RESP], pedido())!;
    const b = resolveManualLevel([...POR_RESP, ...POR_CANAL], pedido())!;
    expect(a.level).toEqual(b.level);
    expect(soma(a.entries)).toBe(1000);
  });

  it("prefere o nível de MENOS famílias extras", () => {
    // Com só o cruzamento e a margem, um card tem de cair na margem (1000),
    // nunca no cruzamento incompleto (500).
    const res = resolveManualLevel([...POR_CANAL, ...CRUZAMENTO], pedido())!;
    expect(res.level).toEqual(["canal"]);
    expect(soma(res.entries)).toBe(1000);
  });

  it("família que o dado não tem devolve null — é 'não sei', nunca zero", () => {
    expect(resolveManualLevel(TUDO, pedido(["segmento"]))).toBeNull();
    expect(
      resolveManualLevel(TOTAL, pedido([], [{ axis: "canal", members: ["ligacao"] }]))
    ).toBeNull();
  });

  it("célula ausente do nível some da lista (e vale 0 no gráfico), sem trocar de nível", () => {
    // O cruzamento não tem nenhuma linha de e-mail: o nível segue sendo o
    // cruzado, e a barra de e-mail simplesmente não recebe lançamento.
    const res = resolveManualLevel(
      TUDO,
      pedido(["resp"], [{ axis: "canal", members: ["email"] }])
    )!;
    expect(res.level).toEqual(["canal", "resp"]);
    expect(res.entries).toHaveLength(0);
  });

  // A garantia de compatibilidade da entrega.
  it("base LEGADA (todo coords vazio) responde exatamente como antes", () => {
    const legada = [entry(10, {}), entry(20, {}), entry(30, {})];
    const res = resolveManualLevel(legada, pedido())!;
    expect(res.level).toEqual([]);
    expect(res.entries).toHaveLength(3);
    expect(soma(res.entries)).toBe(60);
  });
});

describe("coordsMatchFilters", () => {
  it("o residual é um valor selecionável, distinto de 'não declarado'", () => {
    expect(coordsMatchFilters({ resp: null }, [{ axis: "resp", members: [null] }])).toBe(true);
    expect(coordsMatchFilters({ resp: "paulo" }, [{ axis: "resp", members: [null] }])).toBe(false);
    // Não declara o eixo ⇒ fora (quem o exclui de verdade é a escolha do nível).
    expect(coordsMatchFilters({}, [{ axis: "resp", members: [null] }])).toBe(false);
  });

  it("negate cobre neq/not in, e o residual participa dele", () => {
    expect(
      coordsMatchFilters({ resp: "paulo" }, [
        { axis: "resp", members: ["gabriella"], negate: true },
      ])
    ).toBe(true);
    expect(
      coordsMatchFilters({ resp: null }, [
        { axis: "resp", members: [null], negate: true },
      ])
    ).toBe(false);
  });

  it("in com vários membros", () => {
    const f: ManualCoordFilter = { axis: "resp", members: ["paulo", "daniela"] };
    expect(coordsMatchFilters({ resp: "paulo" }, [f])).toBe(true);
    expect(coordsMatchFilters({ resp: "daniela" }, [f])).toBe(true);
    expect(coordsMatchFilters({ resp: "gabriella" }, [f])).toBe(false);
  });

  it("sem filtro, tudo passa", () => {
    expect(coordsMatchFilters({}, [])).toBe(true);
  });
});
