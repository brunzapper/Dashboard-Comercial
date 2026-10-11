// Versão: 1.0 | Data: 11/10/2026
// O vocabulário único das entidades do Bitrix (0155). O que está em risco é a
// IDENTIDADE: o item 5 de um processo inteligente não pode virar o lead/negócio
// 5, e o prefixo do `source_id` nunca pode chegar ao Bitrix como OWNER_ID.
import { describe, expect, it } from "vitest";

import {
  bitrixEntityLabel,
  detailsPath,
  dynamicEntity,
  entityOfOwnerTypeId,
  nativeIdOf,
  ownerTypeIdOf,
  parseBitrixEntity,
  sourceIdOf,
  spaSourceId,
  spaTypeIdOf,
  timelineEntityType,
} from "./entities";

describe("parseBitrixEntity", () => {
  it("aceita lead, deal e dynamic_<id>", () => {
    expect(parseBitrixEntity("lead")).toBe("lead");
    expect(parseBitrixEntity("deal")).toBe("deal");
    expect(parseBitrixEntity("dynamic_1036")).toBe("dynamic_1036");
  });

  it("recusa lixo (o CHECK do banco é a muralha, mas a tela não grava lixo)", () => {
    for (const v of ["", "negocio", "dynamic_", "dynamic_0", "dynamic_x", null, 3]) {
      expect(parseBitrixEntity(v)).toBeNull();
    }
  });
});

describe("OWNER_TYPE_ID", () => {
  it("clássicos fixos; processo usa o próprio entityTypeId", () => {
    expect(ownerTypeIdOf("lead")).toBe(1);
    expect(ownerTypeIdOf("deal")).toBe(2);
    expect(ownerTypeIdOf(dynamicEntity(1036))).toBe(1036);
    expect(spaTypeIdOf("deal")).toBeNull();
  });

  it("o inverso só reconhece entidades conhecidas", () => {
    const known = ["deal", dynamicEntity(1036)] as const;
    expect(entityOfOwnerTypeId(2, known)).toBe("deal");
    expect(entityOfOwnerTypeId("1036", known)).toBe("dynamic_1036");
    expect(entityOfOwnerTypeId(1, known)).toBeNull(); // lead não ligado
    expect(entityOfOwnerTypeId(4, known)).toBeNull(); // empresa
  });
});

describe("identidade do registro", () => {
  it("lead/negócio seguem com o ID cru (byte-idêntico ao gravado)", () => {
    expect(sourceIdOf("deal", 5)).toBe("5");
    expect(nativeIdOf("lead", "5")).toBe("5");
  });

  it("item SPA leva o prefixo do tipo e o perde na fronteira", () => {
    const e = dynamicEntity(1036);
    expect(spaSourceId(1036, 5)).toBe("1036:5");
    expect(sourceIdOf(e, "5")).toBe("1036:5");
    expect(nativeIdOf(e, "1036:5")).toBe("5");
  });

  it("source_id de OUTRO processo nunca vira OWNER_ID", () => {
    expect(nativeIdOf(dynamicEntity(1036), "1040:5")).toBeNull();
    expect(nativeIdOf(dynamicEntity(1036), "5")).toBeNull();
    expect(nativeIdOf(dynamicEntity(1036), "1036:")).toBeNull();
  });
});

describe("caminhos e rótulos", () => {
  it("link do cartão", () => {
    expect(detailsPath("deal", "9")).toBe("/crm/deal/details/9/");
    expect(detailsPath(dynamicEntity(1036), "9")).toBe("/crm/type/1036/details/9/");
  });

  it("ENTITY_TYPE da timeline", () => {
    expect(timelineEntityType("lead")).toBe("lead");
    expect(timelineEntityType(dynamicEntity(1036))).toBe("dynamic_1036");
  });

  it("rótulo", () => {
    expect(bitrixEntityLabel("deal")).toBe("Negócio");
    expect(bitrixEntityLabel(dynamicEntity(1036), "Onboarding")).toBe("Onboarding");
    expect(bitrixEntityLabel(dynamicEntity(1036))).toBe("Processo #1036");
  });
});
