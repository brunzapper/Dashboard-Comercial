// Versão: 1.0 | Data: 22/08/2026
// Testes da peneira de ACL por papel sobre os VALORES (field-acl.ts). O caso
// que motivou o módulo: filtrar a lista de COLUNAS esconde o dado da tela, não
// do payload RSC — a linha crua seguia para o Client Component com o
// custom_fields inteiro. Aqui pinamos que a chave restrita SAI do objeto, que a
// chave órfã (sem definição) FICA e que o caminho comum não realoca.
import { describe, expect, it } from "vitest";

import {
  redactRestrictedFields,
  restrictedFieldKeys,
} from "@/lib/records/field-acl";
import type { RecordRow } from "@/lib/records/types";

const defs = [
  { field_key: "comissao", visible_to_roles: ["admin"] },
  { field_key: "forecast", visible_to_roles: ["admin", "gestor"] },
  { field_key: "nota", visible_to_roles: ["admin", "gestor", "vendedor"] },
];

const row = (custom: Record<string, unknown>): RecordRow =>
  ({ id: "r1", custom_fields: custom }) as unknown as RecordRow;

describe("restrictedFieldKeys", () => {
  it("admin não tem chave restrita", () => {
    expect(restrictedFieldKeys(defs, ["admin"], true).size).toBe(0);
  });

  it("gestor perde só o que é exclusivo de admin", () => {
    const denied = restrictedFieldKeys(defs, ["gestor"], false);
    expect([...denied]).toEqual(["comissao"]);
  });

  it("vendedor perde comissão e forecast", () => {
    const denied = restrictedFieldKeys(defs, ["vendedor"], false);
    expect([...denied].sort()).toEqual(["comissao", "forecast"]);
  });

  it("papel vazio perde tudo que tem definição", () => {
    expect(restrictedFieldKeys(defs, [], false).size).toBe(3);
  });
});

describe("redactRestrictedFields", () => {
  it("remove a chave restrita e preserva as demais", () => {
    const rows = [row({ comissao: 5000, nota: "ok" })];
    const out = redactRestrictedFields(rows, new Set(["comissao"]));
    expect(out[0].custom_fields).toEqual({ nota: "ok" });
    expect("comissao" in out[0].custom_fields).toBe(false);
  });

  it("chave ÓRFÃ (sem definição) sobrevive — não há ACL a aplicar nela", () => {
    const rows = [row({ chave_sem_def: "x", comissao: 1 })];
    const out = redactRestrictedFields(rows, new Set(["comissao"]));
    expect(out[0].custom_fields).toEqual({ chave_sem_def: "x" });
  });

  it("não muta a linha original", () => {
    const original = row({ comissao: 5000 });
    const out = redactRestrictedFields([original], new Set(["comissao"]));
    expect(original.custom_fields).toEqual({ comissao: 5000 });
    expect(out[0]).not.toBe(original);
  });

  it("peneira também o registro CASADO (__match)", () => {
    const rows = [
      {
        id: "r1",
        custom_fields: { nota: "ok" },
        __match: { leads: row({ comissao: 9, nota: "n" }) },
      } as unknown as RecordRow,
    ];
    const out = redactRestrictedFields(rows, new Set(["comissao"]));
    expect(out[0].__match?.leads?.custom_fields).toEqual({ nota: "n" });
  });

  it("sem chave restrita devolve o MESMO array (sem alocação)", () => {
    const rows = [row({ nota: "ok" })];
    expect(redactRestrictedFields(rows, new Set())).toBe(rows);
    expect(redactRestrictedFields(rows, new Set(["comissao"]))).toBe(rows);
  });
});
