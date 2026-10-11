// Versão: 1.0 | Data: 11/10/2026
// Processos inteligentes (0155): mapper, mapa a partir da config aprovada e a
// amostra da triagem. A amostra passa pelo MESMO mapper do sync — é o que faz
// a tela mostrar o que de fato vai entrar.
import { describe, expect, it } from "vitest";

import type { BitrixClient } from "./client";
import { BitrixLookups } from "./lookups";
import { mapSpaItem, spaFieldType } from "./mapper";
import { listSpaTypes, loadSpaSchema, spaMappingFor } from "./spa";
import { buildSpaPreview, displayValue } from "./spa-preview";
import type { BitrixCallable } from "./task-mirror";

function lookups(): BitrixLookups {
  const l = BitrixLookups.hydrate({} as BitrixClient, undefined, {
    leadStatuses: {},
    dealStages: {},
    sources: { WEB: "Site" },
    categories: {},
    dealEnums: {},
    leadEnums: {},
    spaStages: {
      "DT1036_8:NEW": "Novo",
      "DT1036_8:SUCCESS": "Concluído",
      "DT1040_9:NEW": "Novo",
    },
    spaStageSemantics: { "DT1036_8:SUCCESS": "S" },
  });
  // userName sem banco nem portal: devolve o id (fallback do cache).
  (l as unknown as { users: Map<string, string> }).users.set("7", "Ana");
  return l;
}

const RAW = {
  id: 5,
  title: "Cliente X",
  stageId: "DT1036_8:SUCCESS",
  categoryId: 8,
  opportunity: "1500.5",
  currencyId: "BRL",
  assignedById: 7,
  createdTime: "2026-10-01T10:00:00+03:00",
  updatedTime: "2026-10-02T10:00:00+03:00",
  closedate: "2026-10-05T00:00:00+03:00",
  ufCrm5_1: "11",
  ufCrm5_2: ["11", "12"],
  sourceId: "WEB",
  ufCrm5_3: "Y",
};

const SCHEMA_FIELDS = {
  title: { type: "string", title: "Título" },
  ufCrm5_1: {
    type: "enumeration",
    title: "Plano",
    items: [
      { ID: 11, VALUE: "Básico" },
      { ID: 12, VALUE: "Pro" },
    ],
  },
  ufCrm5_2: {
    type: "enumeration",
    title: "Módulos",
    isMultiple: true,
    items: [
      { ID: 11, VALUE: "Básico" },
      { ID: 12, VALUE: "Pro" },
    ],
  },
  sourceId: { type: "crm_status", title: "Origem" },
  ufCrm5_3: { type: "boolean", title: "Ativo", isReadOnly: true },
};

function fakeApi(): BitrixCallable & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call<T>(method: string, params?: Record<string, unknown>) {
      calls.push(method);
      if (method === "crm.type.list") {
        return {
          result: {
            types: [
              { entityTypeId: 1040, title: "Renovação" },
              { entityTypeId: 1036, title: "Onboarding", isCategoriesEnabled: "Y" },
            ],
          },
        } as { result: T };
      }
      if (method === "crm.item.fields") {
        expect(params?.entityTypeId).toBe(1036);
        return { result: { fields: SCHEMA_FIELDS } } as { result: T };
      }
      if (method === "crm.category.list") {
        return { result: { categories: [{ id: 8, name: "Implantação" }] } } as {
          result: T;
        };
      }
      if (method === "crm.item.list") {
        return { result: { items: [RAW] }, total: 1 } as unknown as { result: T };
      }
      if (method === "crm.activity.list") {
        const f = params?.filter as Record<string, unknown>;
        expect(f.OWNER_TYPE_ID).toBe(1036);
        expect(f["@OWNER_ID"]).toEqual(["5"]);
        return {
          result: [
            { ID: 90, OWNER_ID: 5, SUBJECT: "Kickoff", PROVIDER_ID: "CRM_MEETING", COMPLETED: "N" },
          ],
        } as unknown as { result: T };
      }
      throw new Error(`inesperado: ${method}`);
    },
  };
}

describe("spaFieldType", () => {
  it("origem e empresa resolvem pelo id; o resto pelo tipo", () => {
    expect(spaFieldType("sourceId", "crm_status")).toBe("source");
    expect(spaFieldType("companyId", "crm_company")).toBe("company");
    expect(spaFieldType("ufCrm5_1", "user")).toBe("employee");
    expect(spaFieldType("ufCrm5_1", "integer")).toBe("double");
    expect(spaFieldType("ufCrm5_1", "url")).toBe("string");
  });
});

describe("listSpaTypes / loadSpaSchema", () => {
  it("lista pelo nome, em ordem alfabética", async () => {
    const types = await listSpaTypes(fakeApi());
    expect(types.map((t) => t.title)).toEqual(["Onboarding", "Renovação"]);
    expect(types[0]).toMatchObject({ entityTypeId: 1036, isCategoriesEnabled: true });
  });

  it("schema traz campos e funis", async () => {
    const s = await loadSpaSchema(fakeApi(), 1036);
    expect(s.categories).toEqual({ "8": "Implantação" });
    expect(s.fields.find((f) => f.fieldId === "ufCrm5_1")?.items?.[1]).toEqual({
      ID: "12",
      VALUE: "Pro",
    });
  });
});

describe("mapSpaItem", () => {
  it("mapeia o item com o record_type da Base e o source_id prefixado", async () => {
    const schema = await loadSpaSchema(fakeApi(), 1036);
    const mapping = spaMappingFor(schema, {
      v: 1,
      fields: [
        { id: "ufCrm5_1", key: "onb_plano", label: "Plano" },
        { id: "ufCrm5_2", key: "onb_modulos", label: "Módulos" },
        { id: "sourceId", key: "onb_origem", label: "Origem" },
        { id: "ufCrm5_3", key: "onb_ativo", label: "Ativo" },
        { id: "ufCrm5_99", key: "onb_sumiu", label: "Excluído no portal" },
      ],
      categoryIds: [],
    });
    expect(mapping.map((m) => m.key)).not.toContain("onb_sumiu");

    const m = await mapSpaItem(
      RAW,
      { recordType: "onboarding", entityTypeId: 1036, mapping, categories: schema.categories },
      lookups(),
      "Europe/Moscow"
    );
    expect(m.record_type).toBe("onboarding");
    expect(m.source_id).toBe("1036:5");
    expect(m.title).toBe("Cliente X");
    expect(m.pipeline).toBe("Implantação");
    expect(m.stage).toBe("Concluído");
    expect(m.stage_semantic).toBe("won");
    expect(m.closed).toBe(true);
    expect(m.value).toBe(1500.5);
    expect(m._assignedById).toBe("7");
    // Moscou (+03) → Brasília (-03): seis horas antes.
    expect(m.source_created_at).toBe("2026-10-01T04:00:00-03:00");
    expect(m.closed_at).toBe("2026-10-04T18:00:00-03:00");
    expect(m.custom_fields).toEqual({
      onb_plano: "Básico",
      onb_modulos: "Básico, Pro",
      onb_origem: "Site",
      onb_ativo: true,
    });
  });

  it("item aberto: sem data de fechamento (a do Bitrix é previsão)", async () => {
    const m = await mapSpaItem(
      { ...RAW, stageId: "DT1036_8:NEW" },
      { recordType: "onboarding", entityTypeId: 1036, mapping: [], categories: {} },
      lookups()
    );
    expect(m.stage).toBe("Novo");
    expect(m.stage_semantic).toBe("open");
    expect(m.closed).toBe(false);
    expect(m.closed_at).toBeNull();
  });
});

describe("buildSpaPreview", () => {
  it("amostra pelo mesmo mapper, com os campos não-núcleo e as atividades", async () => {
    const api = fakeApi();
    const p = await buildSpaPreview(api, lookups(), 1036, { timezone: null });
    expect(p.total).toBe(1);
    expect(p.fields.map((f) => f.id)).not.toContain("title");
    expect(p.rows[0]).toMatchObject({
      id: "5",
      title: "Cliente X",
      stage: "Concluído",
      pipeline: "Implantação",
      responsible: "Ana",
      closed: true,
    });
    expect(p.rows[0].values.ufCrm5_1).toBe("Básico");
    expect(p.rows[0].values.ufCrm5_3).toBe("Sim");
    expect(p.activities).toEqual([
      expect.objectContaining({ id: "90", ownerId: "5", kind: "Reunião", completed: false }),
    ]);
    expect(p.stages).toEqual(["Novo", "Concluído"]);
    // Nada de escrita: só leituras no portal.
    expect(api.calls.every((c) => /\.(list|fields)$/.test(c))).toBe(true);
  });

  it("displayValue", () => {
    expect(displayValue(null)).toBe("");
    expect(displayValue(false)).toBe("Não");
    expect(displayValue(1234.5)).toBe("1.234,5");
  });
});
