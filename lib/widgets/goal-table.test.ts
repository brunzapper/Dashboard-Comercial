// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): exibição — saneamento das chaves novas, padrão pelo
//   estilo (resolveGoalTableDisplay) e etiqueta de nível (splitLevelTag).
import { describe, expect, it } from "vitest";

import {
  goalTableRequests,
  labelHasUnit,
  resolveGoalTableDisplay,
  sanitizeGoalTableSettings,
  splitLevelTag,
  sumColumn,
} from "./goal-table";

const deps = () => ({ knownKeys: new Set(["mrr", "clientes"]), where: "w", warnings: [] as string[] });

describe("sanitizeGoalTableSettings", () => {
  it("descarta indicador desconhecido com aviso", () => {
    const d = deps();
    const out = sanitizeGoalTableSettings(
      { rows: [{ indicator: "mrr", bold: true }, { indicator: "xpto" }] },
      d
    );
    expect(out?.rows).toEqual([{ indicator: "mrr", bold: true }]);
    expect(d.warnings.join(" ")).toMatch(/xpto/);
  });

  it("modo por responsável guarda indicador, nomes e total", () => {
    const out = sanitizeGoalTableSettings(
      {
        mode: "por_responsavel",
        indicator: "mrr",
        responsibles: ["Gabriella", "Gabriella", " Daniela "],
        totalRowLabel: "Compromissos",
        months: ["2026-10", "2026-13", "x"],
        editable: true,
      },
      deps()
    );
    expect(out).toMatchObject({
      mode: "por_responsavel",
      indicator: "mrr",
      responsibles: ["Gabriella", "Daniela"],
      totalRowLabel: "Compromissos",
      months: ["2026-10"],
      editable: true,
    });
  });

  it("não-objeto vira null", () => {
    expect(sanitizeGoalTableSettings([], deps())).toBeNull();
  });
});

describe("goalTableRequests", () => {
  it("uma linha por nome no modo por responsável", () => {
    const r = goalTableRequests({ mode: "por_responsavel", indicator: "mrr", responsibles: ["A", "B"] });
    expect(r.map((x) => [x.indicator, x.responsibleName])).toEqual([
      ["mrr", "A"],
      ["mrr", "B"],
    ]);
    expect(goalTableRequests({ mode: "por_responsavel", responsibles: ["A"] })).toEqual([]);
  });
  it("sumColumn ignora vazios", () => {
    expect(sumColumn([1, null, 2])).toBe(3);
    expect(sumColumn([null])).toBeNull();
  });
});

describe("exibição da tabela de metas", () => {
  it("saneia as chaves de exibição (fora da whitelist some)", () => {
    const out = sanitizeGoalTableSettings(
      { density: "confortavel", attainmentStyle: "neon", emptyRealized: "traco", unitPlacement: "rotulo", levelTags: "sim" },
      deps()
    );
    expect(out?.density).toBe("confortavel");
    expect(out?.attainmentStyle).toBeUndefined();
    expect(out?.emptyRealized).toBe("traco");
    expect(out?.unitPlacement).toBe("rotulo");
    expect(out?.levelTags).toBeUndefined();
  });

  it("Clássico mantém o de sempre; estilo novo vira tabela de slide; widget fixa", () => {
    const classic = resolveGoalTableDisplay(undefined, { styled: false, header: "linha", zebra: true });
    expect(classic).toEqual({
      density: "preencher",
      attainmentStyle: "pilula",
      emptyRealized: "zero",
      unitPlacement: "celula",
      levelTags: false,
      header: "faixa",
      zebra: false,
    });
    const styled = resolveGoalTableDisplay(undefined, { styled: true, header: "linha", zebra: false });
    expect(styled.density).toBe("confortavel");
    expect(styled.emptyRealized).toBe("traco");
    expect(styled.header).toBe("linha");
    expect(
      resolveGoalTableDisplay({ attainmentStyle: "pilula" }, { styled: true, header: "linha", zebra: false })
        .attainmentStyle
    ).toBe("pilula");
  });

  it("etiqueta de nível e unidade no rótulo", () => {
    expect(splitLevelTag("N1 MRR novo inbound (R$)")).toEqual({ tag: "N1", text: "MRR novo inbound (R$)" });
    expect(splitLevelTag("Clientes novos")).toEqual({ tag: null, text: "Clientes novos" });
    expect(labelHasUnit("MRR (R$)")).toBe(true);
    expect(labelHasUnit("Conversão %")).toBe(true);
    expect(labelHasUnit("Clientes")).toBe(false);
  });
});
