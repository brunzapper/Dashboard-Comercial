// Versão: 1.0 | Data: 08/09/2026
// O encadeamento é o coração do motor: três chamadas independentes ao CRM em
// que o id de uma alimenta a próxima, sem que nenhum passo conheça os outros.
// Cliente FAKE — sem rede, sem banco.
import { describe, expect, it } from "vitest";

import { executeWorkflow } from "./execute";
import { bitrixLeadFormDefinition } from "./seeds/bitrix-lead-form";
import { parseWorkflowDefinition, type WorkflowDefinition } from "./types";

const LEAD_FIELDS = {
  TITLE: { type: "string" },
  NAME: { type: "string" },
  LAST_NAME: { type: "string" },
  COMPANY_TITLE: { type: "string" },
  COMPANY_ID: { type: "integer" },
  CONTACT_ID: { type: "integer" },
  SOURCE_ID: { type: "crm_status" },
  SOURCE_DESCRIPTION: { type: "string" },
  STATUS_ID: { type: "crm_status" },
  COMMENTS: { type: "string" },
  EMAIL: { type: "crm_multifield", isMultiple: true },
  PHONE: { type: "crm_multifield", isMultiple: true },
  ASSIGNED_BY_ID: { type: "user" },
};
const COMPANY_FIELDS = { TITLE: { type: "string" }, ASSIGNED_BY_ID: { type: "user" } };
const CONTACT_FIELDS = {
  NAME: { type: "string" },
  LAST_NAME: { type: "string" },
  COMPANY_ID: { type: "integer" },
  EMAIL: { type: "crm_multifield", isMultiple: true },
  PHONE: { type: "crm_multifield", isMultiple: true },
  ASSIGNED_BY_ID: { type: "user" },
};

interface Call {
  method: string;
  params: Record<string, unknown>;
}

/** Cliente falso: devolve ids sequenciais e guarda o que foi enviado. */
function fakeClient(opts: { failOn?: string } = {}) {
  const calls: Call[] = [];
  let nextId = 100;
  const client = {
    async call<T>(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      if (opts.failOn === method) throw new Error(`Bitrix ${method} falhou`);
      if (method.endsWith(".fields")) {
        const map = method.includes("company")
          ? COMPANY_FIELDS
          : method.includes("contact")
            ? CONTACT_FIELDS
            : LEAD_FIELDS;
        return { result: map as T };
      }
      nextId += 1;
      return { result: nextId as T };
    },
  };
  return { client, calls };
}

function addCallFor(calls: Call[], entity: string): Call | undefined {
  return calls.find((c) => c.method === `crm.${entity}.add`);
}

const form = {
  empresa: "Acme Indústria",
  contato_nome: "Maria Silva Souza",
  telefone: "11900000000",
  email: "maria@acme.com.br",
  fonte: "CEO-Led Outbound",
  fonte_info: "indicação do João",
  comentarios: "Quer falar em julho",
  etapa: "",
  responsavel: "",
};

const ctx = {
  responsibleBitrixId: "7",
  contatoPrimeiroNome: "Maria",
  contatoSobrenome: "Silva Souza",
};

/** Definição de fábrica sem o passo de registro local (testado à parte). */
function crmOnly(): WorkflowDefinition {
  const def = parseWorkflowDefinition(bitrixLeadFormDefinition())!;
  return { ...def, steps: def.steps.filter((s) => s.type !== "record.create") };
}

function deps(client: ReturnType<typeof fakeClient>["client"], extra = {}) {
  return {
    db: {} as never,
    ctx,
    record: {
      userId: "u1",
      responsibleId: null,
      operationId: null,
      roles: ["admin"],
      orgId: "org1",
    },
    bitrix: {
      makeClient: () => client,
      statusCodes: { sources: { "CEO-Led Outbound": "UC_EN7PZM" } },
    },
    resolveConnection: () => "https://portal.bitrix24.com.br/rest/1/tok/",
    ...extra,
  };
}

describe("executeWorkflow — encadeamento", () => {
  it("passa o id de cada entidade para a próxima", async () => {
    const { client, calls } = fakeClient();
    const res = await executeWorkflow(crmOnly(), form, deps(client));

    expect(res.status).toBe("ok");
    const company = addCallFor(calls, "company")!;
    const contact = addCallFor(calls, "contact")!;
    const lead = addCallFor(calls, "lead")!;

    const companyId = String(
      res.steps.find((s) => s.id === "criar_empresa")!.outputId
    );
    const contactId = String(
      res.steps.find((s) => s.id === "criar_contato")!.outputId
    );

    // Vínculo 1: o contato pendura na empresa.
    expect((contact.params.fields as Record<string, unknown>).COMPANY_ID).toBe(
      companyId
    );
    // Vínculos 2 e 3: o lead recebe os dois ids.
    const leadFields = lead.params.fields as Record<string, unknown>;
    expect(leadFields.COMPANY_ID).toBe(companyId);
    expect(leadFields.CONTACT_ID).toBe(contactId);
    expect(company.params.fields).toMatchObject({ TITLE: "Acme Indústria" });
  });

  it("converte RÓTULO de fonte para o CÓDIGO do CRM", async () => {
    const { client, calls } = fakeClient();
    await executeWorkflow(crmOnly(), form, deps(client));
    const leadFields = addCallFor(calls, "lead")!.params.fields as Record<
      string,
      unknown
    >;
    // O bug clássico: mandar "CEO-Led Outbound" onde o Bitrix quer UC_EN7PZM.
    expect(leadFields.SOURCE_ID).toBe("UC_EN7PZM");
  });

  it("e-mail e telefone saem no formato de comunicação do CRM", async () => {
    const { client, calls } = fakeClient();
    await executeWorkflow(crmOnly(), form, deps(client));
    const leadFields = addCallFor(calls, "lead")!.params.fields as Record<
      string,
      unknown
    >;
    expect(leadFields.EMAIL).toEqual([
      { VALUE: "maria@acme.com.br", VALUE_TYPE: "WORK" },
    ]);
    expect(leadFields.PHONE).toEqual([
      { VALUE: "11900000000", VALUE_TYPE: "WORK" },
    ]);
  });

  it("campo vazio não é enviado (não limpa default do funil)", async () => {
    const { client, calls } = fakeClient();
    await executeWorkflow(crmOnly(), form, deps(client));
    const leadFields = addCallFor(calls, "lead")!.params.fields as Record<
      string,
      unknown
    >;
    // `etapa` veio vazia: o CRM aplica a primeira etapa do funil.
    expect(leadFields).not.toHaveProperty("STATUS_ID");
  });

  it("passo DESLIGADO é pulado e o seguinte segue sem o resultado dele", async () => {
    const def = crmOnly();
    const semEmpresa = {
      ...def,
      steps: def.steps.map((s) =>
        s.id === "criar_empresa" ? { ...s, enabled: false } : s
      ),
    };
    const { client, calls } = fakeClient();
    const res = await executeWorkflow(semEmpresa, form, deps(client));

    expect(res.status).toBe("ok");
    expect(addCallFor(calls, "company")).toBeUndefined();
    const leadFields = addCallFor(calls, "lead")!.params.fields as Record<
      string,
      unknown
    >;
    // Sem COMPANY_ID, mas o nome da empresa sobrevive no texto livre.
    expect(leadFields).not.toHaveProperty("COMPANY_ID");
    expect(leadFields.COMPANY_TITLE).toBe("Acme Indústria");
  });

  it("skipIfEmpty pula sem erro quando falta o insumo", async () => {
    const { client, calls } = fakeClient();
    const res = await executeWorkflow(
      crmOnly(),
      { ...form, empresa: "" },
      deps(client)
    );
    expect(addCallFor(calls, "company")).toBeUndefined();
    expect(res.steps.find((s) => s.id === "criar_empresa")!.skipped).toBe(true);
    expect(res.status).toBe("ok");
  });

  it("erro no meio para o fluxo e reporta PARCIAL", async () => {
    const { client, calls } = fakeClient({ failOn: "crm.lead.add" });
    const res = await executeWorkflow(crmOnly(), form, deps(client));

    // Empresa e contato já existem lá — insistir criaria órfãos, e calar
    // faria a pessoa reenviar e duplicar.
    expect(res.status).toBe("partial");
    expect(res.error).toMatch(/crm\.lead\.add/);
    expect(addCallFor(calls, "company")).toBeDefined();
    expect(addCallFor(calls, "contact")).toBeDefined();
    expect(res.steps.at(-1)!.error).toBeTruthy();
  });

  it("falha no PRIMEIRO passo é erro, não parcial", async () => {
    const { client } = fakeClient({ failOn: "crm.company.add" });
    const res = await executeWorkflow(crmOnly(), form, deps(client));
    expect(res.status).toBe("error");
  });

  it("conexão fora do registry derruba o passo, sem chamar nada", async () => {
    const { client, calls } = fakeClient();
    const res = await executeWorkflow(
      crmOnly(),
      form,
      deps(client, {
        resolveConnection: (k: string) => {
          throw new Error(`Conexão desconhecida: "${k}".`);
        },
      })
    );
    expect(res.status).toBe("error");
    expect(calls).toHaveLength(0);
  });
});

describe("executeWorkflow — registro local", () => {
  it("grava o registro com o id do lead e devolve o recordId", async () => {
    const def = parseWorkflowDefinition(bitrixLeadFormDefinition())!;
    const { client } = fakeClient();

    const inserted: Record<string, unknown>[] = [];
    const db = {
      from(table: string) {
        if (table === "field_definitions") {
          return {
            select: () => ({
              in: () => ({ eq: () => ({ data: [], error: null }) }),
            }),
          };
        }
        if (table === "audit_log") return { insert: async () => ({ error: null }) };
        return {
          insert(row: Record<string, unknown>) {
            inserted.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: "rec-1" }, error: null }),
              }),
            };
          },
        };
      },
    };

    const res = await executeWorkflow(def, form, {
      ...deps(client),
      db: db as never,
      recordSource: { key: "lead", recordType: "lead", manualEntry: true },
    });

    expect(res.status).toBe("ok");
    expect(res.recordId).toBe("rec-1");
    const row = inserted[0];
    const leadId = String(res.steps.find((s) => s.id === "criar_lead")!.outputId);
    // É este par que faz o próximo sync ADOTAR a linha em vez de duplicá-la.
    expect(row.source_system).toBe("bitrix");
    expect(row.source_id).toBe(leadId);
    expect(row.last_synced_at).toBeNull();
    expect(row.title).toBe("Acme Indústria");
  });
});
