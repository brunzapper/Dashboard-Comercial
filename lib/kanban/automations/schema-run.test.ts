// Versão: 1.0 | Data: 09/09/2026
// A ação `run_schema` é a única que produz efeito FORA do sistema sem ninguém
// olhando, e o tick roda a cada minuto. O que estes testes protegem:
//  - a resolução das respostas a partir do REGISTRO (precedência map →
//    sourceRef → defaultValue), que é o que substitui a pessoa preenchendo;
//  - a regra ficar INERTE quando o esquema não está mais disponível;
//  - a trava: `duplicate` do núcleo não conta como sucesso NEM como falha;
//  - o teto próprio, muito abaixo do teto das ações internas.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/workflow/run", () => ({
  loadStatusCodes: vi.fn(async () => ({})),
  runWorkflowCore: vi.fn(),
}));

import { runWorkflowCore } from "@/lib/workflow/run";
import type { WorkflowSchemaRow } from "@/lib/workflow/schemas";
import type { WorkflowDefinition } from "@/lib/workflow/types";

import { decideActions, type CardFacts, type EvalContext } from "./evaluate";
import { parseAutomationRule } from "./types";
import {
  executeAutomationSchemaRuns,
  MAX_SCHEMA_RUNS_PER_RUN,
} from "./schema-run";
import type { AutomationRow } from "./types";

const runCore = vi.mocked(runWorkflowCore);

const DEF: WorkflowDefinition = {
  version: 1,
  form: {
    fields: [
      {
        key: "empresa",
        label: "Empresa",
        type: "texto",
        required: false,
        visible: true,
        order: 0,
        sourceRef: "title",
      },
      {
        key: "fonte",
        label: "Fonte",
        type: "texto",
        required: false,
        visible: true,
        order: 1,
        sourceRef: "custom:fonte",
      },
      {
        key: "origem",
        label: "Origem",
        type: "texto",
        required: false,
        visible: true,
        order: 2,
        defaultValue: "Automação",
      },
    ],
  },
  // Só alteração: esquema REPETÍVEL.
  steps: [
    {
      id: "atualiza",
      type: "record.update",
      label: "Atualiza",
      enabled: true,
      params: {
        recordIdFrom: "{{ctx.triggerRecordId}}",
        fields: { "custom:status": { value: "{{form.origem}}" } },
      },
    },
  ],
};

const SCHEMA: WorkflowSchemaRow = {
  id: "sch-1",
  key: "atualiza_crm",
  label: "Atualiza CRM",
  description: null,
  enabled: true,
  triggerKind: "automacao",
  showCard: false,
  definition: DEF,
  updatedAt: "2026-09-09T00:00:00Z",
};

const RULE: AutomationRow = {
  id: "rule-1",
  name: "Sincroniza",
  enabled: true,
  position: 0,
  rule: {
    v: 1,
    conditions: [
      { kind: "field", filter: { field: "stage", op: "eq", value: "novo" } },
    ],
    action: { type: "run_schema", schemaKey: "atualiza_crm", simulate: true },
  },
  last_run_at: null,
  last_error: null,
  last_moved_count: 0,
};

const card = (over: Partial<CardFacts> = {}): CardFacts => ({
  record: {
    id: "r1",
    title: "Padaria do Zé",
    stage: "novo",
    responsible_id: "resp-1",
    custom_fields: { fonte: "Indicação" },
  } as unknown as CardFacts["record"],
  columnKey: "",
  isMock: false,
  openTasks: 0,
  overdueTasks: 0,
  relatedCounts: {},
  changedAt: null,
  sourceCreatedAt: null,
  placementUpdatedAt: null,
  openAutomationRuleIds: [],
  seriesOccurrences: [],
  pausedAttributes: [],
  ...over,
});

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  available: [],
  todayIso: "2026-09-09",
  columns: [],
  allocationFieldKey: null,
  schemaDefs: new Map([["atualiza_crm", DEF]]),
  ...over,
});

describe("decideActions — run_schema", () => {
  it("preenche o formulário a partir do registro (sourceRef e defaultValue)", () => {
    const { schemaRuns } = decideActions([RULE], [card()], ctx());
    expect(schemaRuns).toHaveLength(1);
    expect(schemaRuns[0].form).toEqual({
      empresa: "Padaria do Zé",
      fonte: "Indicação",
      // Sem sourceRef, vale a constante do esquema.
      origem: "Automação",
    });
    expect(schemaRuns[0].simulate).toBe(true);
  });

  it("o `map` da regra vence o sourceRef do esquema", () => {
    const rule = {
      ...RULE,
      rule: {
        ...RULE.rule,
        action: {
          type: "run_schema" as const,
          schemaKey: "atualiza_crm",
          simulate: true,
          map: { empresa: "custom:fonte" },
        },
      },
    };
    const { schemaRuns } = decideActions([rule], [card()], ctx());
    expect(schemaRuns[0].form.empresa).toBe("Indicação");
  });

  it("campo sem valor no registro cai no default, não em lixo", () => {
    const semTitulo = card({
      record: {
        id: "r2",
        stage: "novo",
        custom_fields: {},
      } as unknown as CardFacts["record"],
    });
    const { schemaRuns } = decideActions([RULE], [semTitulo], ctx());
    expect(schemaRuns[0].form.empresa).toBe("");
    expect(schemaRuns[0].form.origem).toBe("Automação");
  });

  it("esquema indisponível deixa a regra INERTE com erro, nunca executa", () => {
    const { schemaRuns, ruleErrors } = decideActions(
      [RULE],
      [card()],
      ctx({ schemaDefs: new Map() })
    );
    expect(schemaRuns).toHaveLength(0);
    expect(ruleErrors[0].ruleId).toBe("rule-1");
    expect(ruleErrors[0].message).toContain("atualiza_crm");
  });

  it("mock nunca dispara esquema", () => {
    const { schemaRuns } = decideActions([RULE], [card({ isMock: true })], ctx());
    expect(schemaRuns).toHaveLength(0);
  });
});

describe("executeAutomationSchemaRuns", () => {
  // Builder encadeável e THENABLE: o loader faz .select().in().eq() e dá await
  // no resultado — o mesmo formato do PostgREST.
  function chain(data: unknown) {
    const q: Record<string, unknown> = {
      select: () => q,
      in: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data }),
    };
    return q;
  }
  const db = {
    from: (table: string) =>
      chain(
        table === "responsibles"
          ? [{ id: "resp-1", bitrix_user_id: "42" }]
          : []
      ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const batch = (over: Record<string, unknown> = {}) => ({
    runs: [
      {
        recordId: "r1",
        ruleId: "rule-1",
        schemaKey: "atualiza_crm",
        simulate: false,
        form: { empresa: "Padaria do Zé" },
      },
    ],
    schemas: new Map([["atualiza_crm", SCHEMA]]),
    recordById: new Map([
      ["r1", { id: "r1", responsible_id: "resp-1" }],
    ]) as never,
    orgId: "org-1",
    createdBy: "user-1",
    defs: [],
    catalog: [],
    ...over,
  });

  beforeEach(() => {
    runCore.mockReset();
  });

  it("execução bem-sucedida conta como ação da regra", async () => {
    runCore.mockResolvedValue({
      status: "ok",
      steps: [],
      recordId: null,
      error: null,
      warnings: [],
      runId: "run-1",
      duplicate: false,
    });
    const out = await executeAutomationSchemaRuns(db, batch());
    expect(out.okIds).toEqual(["r1"]);
    expect(out.runsByRule.get("rule-1")).toBe(1);
    expect(out.failed).toHaveLength(0);
    // A identidade e a trava chegam ao núcleo.
    const arg = runCore.mock.calls[0][0];
    expect(arg.trigger).toEqual({ recordId: "r1", ruleId: "rule-1" });
    expect(arg.actor.bitrixUserId).toBe("42");
    expect(arg.actor.userId).toBe("user-1");
  });

  it("trava já tomada NÃO é sucesso nem falha — é o resultado desejado", async () => {
    runCore.mockResolvedValue({
      status: "ok",
      steps: [],
      recordId: null,
      error: null,
      warnings: [],
      runId: null,
      duplicate: true,
    });
    const out = await executeAutomationSchemaRuns(db, batch());
    expect(out.skipped).toBe(1);
    expect(out.okIds).toHaveLength(0);
    expect(out.failed).toHaveLength(0);
  });

  it("execução parcial é reportada — parte já foi para o destino", async () => {
    runCore.mockResolvedValue({
      status: "partial",
      steps: [],
      recordId: null,
      error: "lead falhou",
      warnings: [],
      runId: "run-2",
      duplicate: false,
    });
    const out = await executeAutomationSchemaRuns(db, batch());
    expect(out.okIds).toHaveLength(0);
    expect(out.failed[0].message).toContain("incompleta");
  });

  it("exceção de um registro não derruba os demais", async () => {
    runCore
      .mockRejectedValueOnce(new Error("CRM fora do ar"))
      .mockResolvedValue({
        status: "ok",
        steps: [],
        recordId: null,
        error: null,
        warnings: [],
        runId: "run-3",
        duplicate: false,
      });
    const out = await executeAutomationSchemaRuns(
      db,
      batch({
        runs: [
          { recordId: "r1", ruleId: "rule-1", schemaKey: "atualiza_crm", simulate: false, form: {} },
          { recordId: "r2", ruleId: "rule-1", schemaKey: "atualiza_crm", simulate: false, form: {} },
        ],
      })
    );
    expect(out.failed[0]).toMatchObject({ recordId: "r1" });
    expect(out.okIds).toEqual(["r2"]);
  });
});

describe("teto da ação", () => {
  it("é muito menor que o teto das ações internas", () => {
    // Efeito fora do sistema merece um limite que caiba num engano.
    expect(MAX_SCHEMA_RUNS_PER_RUN).toBe(5);
  });
});

describe("parseAutomationRule — run_schema", () => {
  const withAction = (action: unknown) => ({
    v: 1,
    conditions: [{ kind: "field", filter: { field: "stage", op: "eq", value: "x" } }],
    action,
  });

  it("simulate AUSENTE parseia como true — armar é sempre explícito", () => {
    const rule = parseAutomationRule(
      withAction({ type: "run_schema", schemaKey: "fluxo" })
    );
    expect(rule?.action).toEqual({
      type: "run_schema",
      schemaKey: "fluxo",
      simulate: true,
    });
  });

  it("simulate só desarma com `false` literal", () => {
    expect(
      parseAutomationRule(
        withAction({ type: "run_schema", schemaKey: "f", simulate: false })
      )?.action
    ).toMatchObject({ simulate: false });
    // Qualquer sujeira volta ao ensaio.
    expect(
      parseAutomationRule(
        withAction({ type: "run_schema", schemaKey: "f", simulate: "não" })
      )?.action
    ).toMatchObject({ simulate: true });
  });

  it("sem chave de esquema a regra é inválida (fail-closed)", () => {
    expect(parseAutomationRule(withAction({ type: "run_schema" }))).toBeNull();
    expect(
      parseAutomationRule(withAction({ type: "run_schema", schemaKey: "  " }))
    ).toBeNull();
  });

  it("map só aceita entradas string não-vazias", () => {
    const rule = parseAutomationRule(
      withAction({
        type: "run_schema",
        schemaKey: "f",
        map: { a: "custom:x", b: "", c: 3 },
      })
    );
    expect(rule?.action).toMatchObject({ map: { a: "custom:x" } });
  });
});
