// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): o passo agora ALTERA (crm.<entity>.update) e sabe ensaiar.
//   Os testes novos pinam as três coisas que separam o update do add: o método
//   chamado, o id do alvo (vazio = erro alto, nunca update em entidade nenhuma)
//   e o ensaio, que resolve o payload sem NENHUMA escrita — e a não-regressão
//   do add, que continua chamando .add e devolvendo o id do portal.
// Detalhes do passo do Bitrix que o teste do executor não isola: a separação
// do nome, a degradação do crm_status sem mapa e o link de exibição.
import { describe, expect, it } from "vitest";

import { bitrixEntityUrl, runBitrixEntityStep, splitPersonName } from "./bitrix";
import { toBitrixValue } from "@/lib/sync/bitrix/writeback";
import type { WorkflowRefContext } from "../refs";
import type {
  WorkflowBitrixAddStep,
  WorkflowBitrixUpdateStep,
} from "../types";

/** Cliente falso: registra as chamadas e responde ao schema de campos. */
function fakeClient() {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const client = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      calls.push({ method, params });
      if (method.endsWith(".fields")) {
        return {
          result: {
            TITLE: { type: "string", title: "Título" },
          } as unknown as T,
        };
      }
      return { result: 77 as unknown as T };
    },
  };
  return { client, calls };
}

const ctx: WorkflowRefContext = {
  form: { empresa: "Padaria do Zé", bitrix_id: "512" },
  steps: {},
  ctx: {},
};

const addStep: WorkflowBitrixAddStep = {
  id: "cria",
  type: "bitrix.entity.add",
  label: "Cria lead",
  enabled: true,
  connection: "bitrix_webhook",
  params: { entity: "lead", fields: { TITLE: { value: "{{form.empresa}}" } } },
};

const updateStep: WorkflowBitrixUpdateStep = {
  id: "altera",
  type: "bitrix.entity.update",
  label: "Altera lead",
  enabled: true,
  connection: "bitrix_webhook",
  params: {
    entity: "lead",
    entityId: { value: "{{form.bitrix_id}}" },
    fields: { TITLE: { value: "{{form.empresa}}" } },
  },
};

describe("runBitrixEntityStep — add (não-regressão)", () => {
  it("chama crm.lead.add e devolve o id do portal", async () => {
    const { client, calls } = fakeClient();
    const res = await runBitrixEntityStep(addStep, ctx, "https://p/rest/1/t/", {
      makeClient: () => client,
    });
    expect(calls.map((c) => c.method)).toEqual([
      "crm.lead.fields",
      "crm.lead.add",
    ]);
    expect(calls[1].params).toEqual({ fields: { TITLE: "Padaria do Zé" } });
    expect(res.id).toBe("77");
  });
});

describe("runBitrixEntityStep — update", () => {
  it("chama crm.lead.update com id e campos, e devolve o id do ALVO", async () => {
    const { client, calls } = fakeClient();
    const res = await runBitrixEntityStep(updateStep, ctx, "https://p/rest/1/t/", {
      makeClient: () => client,
    });
    expect(calls[1]).toEqual({
      method: "crm.lead.update",
      params: { id: "512", fields: { TITLE: "Padaria do Zé" } },
    });
    // Update devolve boolean; quem serve aos passos seguintes é o alvo.
    expect(res.id).toBe("512");
  });

  it("id vazio SEM skipIfEmpty falha alto — nunca update em entidade nenhuma", async () => {
    const { client, calls } = fakeClient();
    await expect(
      runBitrixEntityStep(
        { ...updateStep, params: { ...updateStep.params, entityId: { value: "" } } },
        ctx,
        "https://p/rest/1/t/",
        { makeClient: () => client }
      )
    ).rejects.toThrow(/não resolveu o id/);
    expect(calls.some((c) => c.method.endsWith(".update"))).toBe(false);
  });

  it("com skipIfEmpty, a falta do insumo PULA o passo sem erro", async () => {
    const { client, calls } = fakeClient();
    const res = await runBitrixEntityStep(
      {
        ...updateStep,
        params: { ...updateStep.params, skipIfEmpty: "{{form.inexistente}}" },
      },
      ctx,
      "https://p/rest/1/t/",
      { makeClient: () => client }
    );
    expect(res.skipped).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("runBitrixEntityStep — ensaio", () => {
  it("resolve o payload e NÃO escreve nada", async () => {
    const { client, calls } = fakeClient();
    const res = await runBitrixEntityStep(
      updateStep,
      ctx,
      "https://p/rest/1/t/",
      { makeClient: () => client },
      { dryRun: true }
    );
    expect(res.payload).toEqual({
      id: "512",
      fields: { TITLE: "Padaria do Zé" },
    });
    expect(res.id).toBeNull();
    // A leitura do schema continua (read-only, é o que torna a prévia fiel);
    // nenhuma escrita sai.
    expect(calls.map((c) => c.method)).toEqual(["crm.lead.fields"]);
  });
});

describe("splitPersonName", () => {
  it("separa primeiro nome e sobrenome", () => {
    expect(splitPersonName("Maria Silva Souza")).toEqual({
      first: "Maria",
      last: "Silva Souza",
    });
  });

  it("nome de uma palavra fica sem sobrenome (não inventa)", () => {
    expect(splitPersonName("Madonna")).toEqual({ first: "Madonna", last: "" });
  });

  it("tolera espaços extras e string vazia", () => {
    expect(splitPersonName("  Ana   Paula  ")).toEqual({
      first: "Ana",
      last: "Paula",
    });
    expect(splitPersonName("")).toEqual({ first: "", last: "" });
  });
});

describe("toBitrixValue — crm_status (v1.1)", () => {
  const meta = {
    fieldId: "SOURCE_ID",
    title: "Fonte",
    type: "crm_status",
    isMultiple: false,
    isReadOnly: false,
  };
  const codes = { sources: { "CEO-Led Outbound": "UC_EN7PZM" } };

  it("converte rótulo para código", () => {
    expect(toBitrixValue(meta, "CEO-Led Outbound", codes)).toBe("UC_EN7PZM");
  });

  it("valor que JÁ é código passa direto (esquema que fixou o código)", () => {
    expect(toBitrixValue(meta, "UC_EN7PZM", codes)).toBe("UC_EN7PZM");
  });

  it("rótulo inexistente é fatal — melhor recusar que gravar lixo", () => {
    expect(() => toBitrixValue(meta, "Não existe", codes)).toThrow();
  });

  it("SEM o mapa degrada como na v1.0 (nenhum call site antigo muda)", () => {
    expect(toBitrixValue(meta, "CEO-Led Outbound")).toBe("CEO-Led Outbound");
  });

  it("cada família tem o próprio mapa (o código NEW colide entre elas)", () => {
    const statusMeta = { ...meta, fieldId: "STATUS_ID", title: "Etapa" };
    const both = {
      sources: { Site: "UC_AAA" },
      leadStatuses: { "Novos Leads": "NEW" },
    };
    expect(toBitrixValue(statusMeta, "Novos Leads", both)).toBe("NEW");
    // O rótulo de etapa não pode ser encontrado no mapa de origens.
    expect(() => toBitrixValue(meta, "Novos Leads", both)).toThrow();
  });
});

describe("bitrixEntityUrl", () => {
  it("deriva a URL do portal a partir da base do webhook", () => {
    expect(
      bitrixEntityUrl("https://portal.bitrix24.com.br/rest/89/tok/", "lead", "42")
    ).toBe("https://portal.bitrix24.com.br/crm/lead/details/42/");
  });

  it("sem id ou sem host devolve vazio (nunca um link quebrado)", () => {
    expect(bitrixEntityUrl("https://p.bitrix24.com.br/rest/1/t/", "lead", "")).toBe("");
    expect(bitrixEntityUrl("nao-e-url", "lead", "42")).toBe("");
  });
});
