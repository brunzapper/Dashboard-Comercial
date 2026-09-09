// Versão: 1.0 | Data: 09/09/2026
// O núcleo é o que a tela do formulário e o tick das automações têm em comum —
// e é onde mora a TRAVA. Estes testes protegem três coisas:
//  - o contexto do servidor é o MESMO para os dois chamadores (um esquema não
//    pode se comportar diferente conforme quem o disparou);
//  - a natureza da trava sai dos PASSOS: criar = uma vez por registro (hash
//    vazio, tudo colapsa numa linha); alterar = reexecuta quando o payload muda;
//  - reivindica ANTES de executar, e a violação do índice único vira `duplicate`
//    (nada rodou), não uma exceção que o tick trataria como falha.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./execute", () => ({
  executeWorkflow: vi.fn(async () => ({
    status: "ok" as const,
    steps: [],
    recordId: null,
    error: null,
    warnings: [],
  })),
}));
vi.mock("@/lib/records/recalc", () => ({
  recalcFormulaFieldsForRecords: vi.fn(async () => undefined),
}));
vi.mock("@/lib/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { executeWorkflow } from "./execute";
import { schemaIsIrreversible } from "./registry";
import { buildWorkflowCtx, runPayloadHash, runWorkflowCore } from "./run";
import type { WorkflowSchemaRow } from "./schemas";
import type { WorkflowDefinition, WorkflowStep } from "./types";

const execute = vi.mocked(executeWorkflow);

const updateStep: WorkflowStep = {
  id: "atualiza",
  type: "record.update",
  label: "Atualiza",
  enabled: true,
  params: {
    recordIdFrom: "{{ctx.triggerRecordId}}",
    fields: { "custom:status": { value: "ok" } },
  },
};
const createStep: WorkflowStep = {
  id: "cria",
  type: "bitrix.entity.add",
  label: "Cria",
  enabled: true,
  connection: "bitrix_webhook",
  params: { entity: "lead", fields: { TITLE: { value: "x" } } },
};

const defWith = (steps: WorkflowStep[]): WorkflowDefinition => ({
  version: 1,
  form: { fields: [] },
  steps,
});

const schema = (def: WorkflowDefinition): WorkflowSchemaRow => ({
  id: "sch-1",
  key: "fluxo",
  label: "Fluxo",
  description: null,
  enabled: true,
  triggerKind: "automacao",
  showCard: false,
  definition: def,
  updatedAt: "2026-09-09T00:00:00Z",
});

describe("buildWorkflowCtx", () => {
  it("separa o nome da pessoa e carrega o registro que disparou", () => {
    const ctx = buildWorkflowCtx(
      { contato_nome: "Maria Silva Souza" },
      {
        userId: "u1",
        roles: ["admin"],
        responsibleId: "r1",
        bitrixUserId: "42",
        email: "a@b.c",
      },
      { recordId: "rec-1" }
    );
    expect(ctx).toEqual({
      responsibleBitrixId: "42",
      contatoPrimeiroNome: "Maria",
      contatoSobrenome: "Silva Souza",
      usuarioEmail: "a@b.c",
      triggerRecordId: "rec-1",
    });
  });

  it("sem gatilho de registro, a ref fica nula (formulário preenchido por gente)", () => {
    const ctx = buildWorkflowCtx({}, {
      userId: "u1",
      roles: [],
      responsibleId: null,
      bitrixUserId: null,
    });
    expect(ctx.triggerRecordId).toBeNull();
  });
});

describe("schemaIsIrreversible", () => {
  it("passo de criação torna o esquema irreversível", () => {
    expect(schemaIsIrreversible(defWith([createStep]))).toBe(true);
    expect(schemaIsIrreversible(defWith([updateStep, createStep]))).toBe(true);
  });

  it("só alterações = repetível", () => {
    expect(schemaIsIrreversible(defWith([updateStep]))).toBe(false);
  });

  it("passo de criação DESLIGADO não conta", () => {
    expect(
      schemaIsIrreversible(defWith([{ ...createStep, enabled: false }]))
    ).toBe(false);
  });
});

describe("runPayloadHash", () => {
  const ctx = { a: "1" };

  it("esquema irreversível não tem hash — colapsa numa execução por registro", () => {
    expect(runPayloadHash(schema(defWith([createStep])), defWith([createStep]), {}, ctx)).toBe("");
  });

  it("esquema repetível muda de hash quando a entrada muda", () => {
    const def = defWith([updateStep]);
    const s = schema(def);
    const h1 = runPayloadHash(s, def, { campo: "a" }, ctx);
    const h2 = runPayloadHash(s, def, { campo: "a" }, ctx);
    const h3 = runPayloadHash(s, def, { campo: "b" }, ctx);
    expect(h1).toBe(h2);
    expect(h3).not.toBe(h1);
    expect(h1).not.toBe("");
  });

  it("editar o esquema muda o hash (o que seria enviado mudou)", () => {
    const def = defWith([updateStep]);
    const h1 = runPayloadHash(schema(def), def, {}, ctx);
    const h2 = runPayloadHash(
      { ...schema(def), updatedAt: "2026-09-10T00:00:00Z" },
      def,
      {},
      ctx
    );
    expect(h2).not.toBe(h1);
  });

  it("a ordem das chaves não muda o hash", () => {
    const def = defWith([updateStep]);
    const s = schema(def);
    expect(runPayloadHash(s, def, { a: "1", b: "2" }, ctx)).toBe(
      runPayloadHash(s, def, { b: "2", a: "1" }, ctx)
    );
  });
});

/** Fake do PostgREST: insert().select().single() e update().eq(). */
function fakeDb(insertResult: { data?: unknown; error?: unknown }) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const db = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return {
            select: () => ({
              single: async () => insertResult,
              maybeSingle: async () => insertResult,
            }),
          };
        },
        update(row: Record<string, unknown>) {
          updated.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, inserted, updated };
}

describe("runWorkflowCore — a trava", () => {
  const base = (def: WorkflowDefinition) => ({
    orgId: "org-1",
    schema: schema(def),
    def,
    form: {},
    actor: {
      userId: "u1",
      roles: ["admin"],
      responsibleId: null,
      bitrixUserId: null,
    },
  });

  beforeEach(() => {
    execute.mockClear();
  });

  it("reivindica ANTES de executar, com status 'iniciado'", async () => {
    const def = defWith([createStep]);
    const { db, inserted, updated } = fakeDb({ data: { id: "run-1" } });
    const out = await runWorkflowCore({
      ...base(def),
      db,
      trigger: { recordId: "rec-1", ruleId: "rule-1" },
    });
    expect(inserted[0]).toMatchObject({
      status: "iniciado",
      trigger_record_id: "rec-1",
      automation_rule_id: "rule-1",
      mode: "real",
      payload_hash: "",
    });
    expect(updated[0]).toMatchObject({ status: "ok" });
    expect(out.duplicate).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("índice único violado = duplicate, e NADA é executado", async () => {
    const def = defWith([createStep]);
    const { db } = fakeDb({ error: { code: "23505", message: "duplicate key" } });
    const out = await runWorkflowCore({
      ...base(def),
      db,
      trigger: { recordId: "rec-1", ruleId: "rule-1" },
    });
    expect(out.duplicate).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("ensaio grava mode 'simulado' e passa dryRun ao executor", async () => {
    const def = defWith([updateStep]);
    const { db, inserted } = fakeDb({ data: { id: "run-2" } });
    await runWorkflowCore({
      ...base(def),
      db,
      dryRun: true,
      trigger: { recordId: "rec-1", ruleId: "rule-1" },
    });
    expect(inserted[0].mode).toBe("simulado");
    // Esquema repetível: o hash existe e é ele que decide a reexecução.
    expect(inserted[0].payload_hash).not.toBe("");
    expect(execute.mock.calls[0][2].dryRun).toBe(true);
  });

  it("sem gatilho (formulário) grava UMA linha no fim, sem trava", async () => {
    const def = defWith([createStep]);
    const { db, inserted, updated } = fakeDb({ data: { id: "run-3" } });
    await runWorkflowCore({ ...base(def), db });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].status).toBe("ok");
    expect(inserted[0].automation_rule_id).toBeUndefined();
    expect(updated).toHaveLength(0);
  });
});
