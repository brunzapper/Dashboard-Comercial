// Versão: 1.0 | Data: 18/09/2026
import { describe, it, expect } from "vitest";

import {
  coordDeclares,
  coordMember,
  entryLevel,
  isManualAxisRef,
  manualAxisRef,
  manualCoordsKey,
  manualFamilyLabel,
  manualLevelKey,
  manualMemberLabel,
  manualMembersOf,
  manualResidualLabel,
  parseManualAxisRef,
  parseManualCoords,
  type ManualFamily,
  type ManualFamilyMember,
} from "./families";
import { isManualBasisKey, parseManualRef } from "./types";

const CANAL: ManualFamily = {
  id: "f1",
  key: "canal",
  label: "Canal",
  sort_order: 0,
};
const RESP: ManualFamily = {
  id: "f2",
  key: "resp",
  label: "Responsável",
  sort_order: 1,
};
const FAMILIES = [CANAL, RESP];
const MEMBERS: ManualFamilyMember[] = [
  { id: "m1", family_id: "f1", key: "email", label: "E-mail", sort_order: 1 },
  { id: "m2", family_id: "f1", key: "ligacao", label: "Ligação", sort_order: 0 },
  { id: "m3", family_id: "f2", key: "paulo", label: "Paulo", sort_order: 0 },
];

describe("os dois namespaces não colidem", () => {
  // Esta é a defesa contra alguém "simplificar" um dos prefixos depois: se
  // `manualdim:` passasse a casar com `manual:`, um eixo de família viraria
  // chave de basis e vazaria para o RPC como coluna inexistente.
  it("um eixo de família NÃO é um ref de métrica manual", () => {
    expect("manualdim:canal".startsWith("manual:")).toBe(false);
    expect(parseManualRef("manualdim:canal")).toBeNull();
    expect(isManualBasisKey("manualdim:canal")).toBe(false);
  });

  it("uma métrica manual NÃO é um eixo de família", () => {
    expect(parseManualAxisRef("manual:interacoes")).toBeNull();
    expect(isManualAxisRef("manual:interacoes")).toBe(false);
  });

  it("ida e volta do ref de eixo", () => {
    expect(parseManualAxisRef(manualAxisRef("canal"))).toBe("canal");
    expect(parseManualAxisRef("manualdim:Canal")).toBeNull();
    expect(parseManualAxisRef("manualdim:")).toBeNull();
    expect(parseManualAxisRef("stage")).toBeNull();
  });
});

describe("rótulos", () => {
  it("resolve a família, e cai na CHAVE quando ela não existe mais", () => {
    expect(manualFamilyLabel("manualdim:canal", FAMILIES)).toBe("Canal");
    expect(manualFamilyLabel("manualdim:sumiu", FAMILIES)).toBe("sumiu");
    expect(manualFamilyLabel("stage", FAMILIES)).toBeNull();
  });

  it("o residual é um GRUPO nomeado, nunca '—'", () => {
    expect(manualResidualLabel("Responsável")).toBe("Sem Responsável");
    expect(manualMemberLabel("resp", null, FAMILIES, MEMBERS)).toBe(
      "Sem Responsável"
    );
    expect(manualMemberLabel("resp", null, FAMILIES, MEMBERS)).not.toBe("—");
  });

  it("resolve o membro, e cai na chave quando ele não existe mais", () => {
    expect(manualMemberLabel("canal", "ligacao", FAMILIES, MEMBERS)).toBe(
      "Ligação"
    );
    expect(manualMemberLabel("canal", "fax", FAMILIES, MEMBERS)).toBe("fax");
  });

  it("membros saem na ordem de exibição, não na de cadastro", () => {
    expect(manualMembersOf("canal", FAMILIES, MEMBERS).map((m) => m.key)).toEqual(
      ["ligacao", "email"]
    );
    expect(manualMembersOf("sumiu", FAMILIES, MEMBERS)).toEqual([]);
  });
});

describe("coordenadas: declarado-residual × não-declarado", () => {
  it("as duas formas de vazio são diferentes", () => {
    expect(coordDeclares({ resp: null }, "resp")).toBe(true);
    expect(coordDeclares({}, "resp")).toBe(false);
    // As duas devolvem null aqui — é `coordDeclares` que as separa, e é por
    // isso que ele existe.
    expect(coordMember({ resp: null }, "resp")).toBeNull();
    expect(coordMember({}, "resp")).toBeNull();
  });

  it("o nível sai das CHAVES, então o residual conta como endereçado", () => {
    expect(entryLevel({})).toEqual([]);
    expect(entryLevel({ resp: null })).toEqual(["resp"]);
    expect(entryLevel({ resp: "paulo", canal: "ligacao" })).toEqual([
      "canal",
      "resp",
    ]);
  });

  it("a chave do nível é insensível à ordem", () => {
    expect(manualLevelKey(["resp", "canal"])).toBe(manualLevelKey(["canal", "resp"]));
  });
});

describe("manualCoordsKey", () => {
  it("é insensível à ordem de inserção das chaves", () => {
    expect(manualCoordsKey({ resp: "paulo", canal: "ligacao" })).toBe(
      manualCoordsKey({ canal: "ligacao", resp: "paulo" })
    );
  });

  it("distingue residual de não-declarado e de outro membro", () => {
    const vazio = manualCoordsKey({});
    const residual = manualCoordsKey({ resp: null });
    const paulo = manualCoordsKey({ resp: "paulo" });
    expect(new Set([vazio, residual, paulo]).size).toBe(3);
  });
});

describe("parseManualCoords", () => {
  it("aceita o objeto e preserva o residual", () => {
    expect(parseManualCoords({ canal: "ligacao", resp: null })).toEqual({
      canal: "ligacao",
      resp: null,
    });
  });

  it("é fail-closed POR CHAVE: sujeira some, o resto vive", () => {
    expect(
      parseManualCoords({ canal: "ligacao", "Bad Key": "x", n: 5, ok: "sim" })
    ).toEqual({ canal: "ligacao", ok: "sim" });
  });

  it("valor que não é chave válida de membro é descartado", () => {
    expect(parseManualCoords({ canal: "Ligação!" })).toEqual({});
  });

  it("não-objeto vira o nível vazio", () => {
    expect(parseManualCoords(null)).toEqual({});
    expect(parseManualCoords("x")).toEqual({});
    expect(parseManualCoords([1, 2])).toEqual({});
  });
});
