// Versão: 1.0 | Data: 11/10/2026
// Configuração da Base de processo inteligente (0155): o parse é FAIL-CLOSED e
// é o MESMO na tela da triagem, na aprovação e no sync.
import { describe, expect, it } from "vitest";

import {
  defaultSpaRequestConfig,
  parseSpaConfig,
  parseSpaRequestConfig,
  rekeyFields,
  requestConfigError,
  spaBaseKey,
  spaFieldIdFromSource,
  spaFieldKey,
  spaSourceFieldId,
  toSourceConfig,
} from "./spa-config";

describe("chaves", () => {
  it("slug da Base sem acento e começando por letra", () => {
    expect(spaBaseKey("Onboarding Clientes")).toBe("onboarding_clientes");
    expect(spaBaseKey("Renovação")).toBe("renovacao");
    expect(spaBaseKey("2026 Expansão")).toBe("p_2026_expansao");
  });

  it("chave do campo prefixada pela Base (campos homônimos entre processos)", () => {
    expect(spaFieldKey("onboarding", "ufCrm5_1712345")).toBe("onboarding_uf_1712345");
    expect(spaFieldKey("onboarding", "companyId")).toBe("onboarding_companyid");
  });

  it("source_field_id leva o tipo e volta sem ele", () => {
    const sf = spaSourceFieldId(1036, "ufCrm5_1");
    expect(sf).toBe("1036:ufCrm5_1");
    expect(spaFieldIdFromSource(sf)).toBe("ufCrm5_1");
    expect(spaFieldIdFromSource("title")).toBe("title");
  });
});

describe("parseSpaConfig (aprovada)", () => {
  it("sem versão ⇒ null", () => {
    expect(parseSpaConfig({ fields: [] })).toBeNull();
    expect(parseSpaConfig(null)).toBeNull();
  });

  it("descarta campo sem id, chave inválida, núcleo e repetidos", () => {
    const c = parseSpaConfig({
      v: 1,
      fields: [
        { id: "ufCrm5_1", key: "x_a", label: "A" },
        { id: "", key: "x_b" },
        { id: "ufCrm5_2", key: "X inválida" },
        { id: "title", key: "x_title" },
        { id: "ufCrm5_1", key: "x_dup" },
        { id: "ufCrm5_3", key: "x_a" },
      ],
      categoryIds: ["3", "x", 4, "3"],
    });
    expect(c?.fields).toEqual([{ id: "ufCrm5_1", key: "x_a", label: "A" }]);
    expect(c?.categoryIds).toEqual(["3", "4"]);
  });
});

describe("rascunho da triagem", () => {
  const fields = [
    { id: "title", title: "Título", type: "string" },
    { id: "ufCrm5_1", title: "Plano", type: "enumeration" },
    { id: "createdBy", title: "Criado por", type: "user" },
    { id: "ufCrm5_2", title: "Contrato", type: "file" },
    { id: "companyId", title: "Empresa", type: "crm_company" },
  ];

  it("sugere os campos úteis, sem núcleo/técnicos/arquivos, com espelho ligado", () => {
    const c = defaultSpaRequestConfig({ title: "Onboarding" }, fields, "Europe/Moscow");
    expect(c.key).toBe("onboarding");
    expect(c.fields.map((f) => f.id)).toEqual(["ufCrm5_1", "companyId"]);
    expect(c.mirrorActivities).toBe(true);
    expect(c.timezone).toBe("Europe/Moscow");
    expect(requestConfigError(c)).toBeNull();
  });

  it("aprova só o que se aprova: toSourceConfig tira nome/período/fuso", () => {
    const c = defaultSpaRequestConfig({ title: "Onboarding" }, fields);
    expect(Object.keys(toSourceConfig(c)).sort()).toEqual(["categoryIds", "fields", "v"]);
  });

  it("parse tolerante: o que falta volta ao padrão", () => {
    const c = parseSpaRequestConfig({}, { title: "Renovação" });
    expect(c.label).toBe("Renovação");
    expect(c.key).toBe("renovacao");
    expect(c.periodField).toBe("source_created_at");
    expect(c.mirrorActivities).toBe(true);
  });

  it("erros que impedem aprovar", () => {
    const base = parseSpaRequestConfig({}, { title: "Renovação" });
    expect(requestConfigError({ ...base, key: "1x" })).toMatch(/Chave/);
    expect(requestConfigError({ ...base, periodField: "custom:nao_incluido" })).toMatch(
      /período/
    );
    expect(
      requestConfigError({
        ...base,
        fields: [{ id: "ufCrm5_9", key: "renovacao_data", label: "Data" }],
        periodField: "custom:renovacao_data",
      })
    ).toBeNull();
  });

  it("trocar a chave da Base leva junto as chaves no padrão, não as renomeadas", () => {
    const out = rekeyFields(
      [
        { id: "ufCrm5_1", key: "a_uf_1", label: "x" },
        { id: "ufCrm5_2", key: "minha_chave", label: "y" },
      ],
      "a",
      "b"
    );
    expect(out.map((f) => f.key)).toEqual(["b_uf_1", "minha_chave"]);
  });
});
