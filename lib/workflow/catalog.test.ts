// Versão: 1.0 | Data: 09/09/2026
// A lista única existe para responder "o que este sistema faz sozinho, e onde
// eu mexo nisso?". Os testes protegem o que faz essa resposta ser útil: o que
// está QUEBRADO aparece primeiro (é o que exige ação), esquema com definição
// inválida NÃO some da lista, e o filtro separa formulário de automação sem
// misturar regra com esquema.
import { describe, expect, it } from "vitest";

import {
  buildWorkflowCatalog,
  catalogItemFilter,
  countByFilter,
  filterWorkflowCatalog,
} from "./catalog";
import type { OrgAutomationRow } from "./automations-overview";
import type { WorkflowSchemaRow } from "./schemas";
import type { SystemFlow } from "./system-schemas";

const schema = (over: Partial<WorkflowSchemaRow> = {}): WorkflowSchemaRow => ({
  id: "s1",
  key: "fluxo",
  label: "Fluxo",
  description: null,
  enabled: true,
  triggerKind: "form",
  showCard: true,
  definition: { version: 1, form: { fields: [] }, steps: [] },
  updatedAt: "2026-09-09T00:00:00Z",
  ...over,
});

const rule = (over: Partial<OrgAutomationRow> = {}): OrgAutomationRow => ({
  id: "r1",
  name: "Regra",
  enabled: true,
  position: 0,
  owner: { kind: "source", id: "leads" },
  ownerLabel: "Base Leads",
  ownerHref: null,
  rule: {
    v: 1,
    conditions: [{ kind: "field", filter: { field: "stage", op: "eq", value: "x" } }],
    action: { type: "set_field", field: "custom:a", value: "b" },
  },
  lastRunAt: null,
  lastError: null,
  lastActionCount: 0,
  ...over,
});

const flow = (over: Partial<SystemFlow> = {}): SystemFlow => ({
  key: "sync",
  label: "Sincronização",
  description: "d",
  trigger: "t",
  steps: [],
  configuredAt: null,
  configuredWhere: "",
  code: "lib/sync",
  ...over,
});

describe("buildWorkflowCatalog", () => {
  it("põe o que está quebrado na frente de tudo", () => {
    const items = buildWorkflowCatalog(
      [schema({ id: "ok", label: "AAA" })],
      [rule({ id: "erro", name: "ZZZ", lastError: "falhou" })],
      [flow()]
    );
    expect(items[0].id).toBe("rule:erro");
    expect(items[0].broken).toBe(true);
  });

  it("esquema com definição inválida NÃO some — aparece como quebrado", () => {
    const items = buildWorkflowCatalog(
      [schema({ id: "mau", definition: null })],
      [],
      []
    );
    expect(items).toHaveLength(1);
    expect(items[0].broken).toBe(true);
  });

  it("regra cujo jsonb não passou no parse conta como quebrada", () => {
    const items = buildWorkflowCatalog([], [rule({ rule: null })], []);
    expect(items[0].broken).toBe(true);
  });

  it("sem quebra, a ordem é esquemas → regras → sistema", () => {
    const items = buildWorkflowCatalog(
      [schema({ id: "s", label: "ZZZ" })],
      [rule({ id: "r", name: "AAA" })],
      [flow({ key: "f", label: "AAA" })]
    );
    expect(items.map((i) => i.kind)).toEqual(["schema", "rule", "system"]);
  });

  it("dentro da faixa, ordem alfabética", () => {
    const items = buildWorkflowCatalog(
      [schema({ id: "b", label: "Beta" }), schema({ id: "a", label: "Alfa" })],
      [],
      []
    );
    expect(items.map((i) => i.id)).toEqual(["schema:a", "schema:b"]);
  });
});

describe("filtro", () => {
  const items = buildWorkflowCatalog(
    [
      schema({ id: "form", triggerKind: "form" }),
      schema({ id: "auto", triggerKind: "automacao" }),
    ],
    [rule()],
    [flow()]
  );

  it("esquema de automação e regra caem no MESMO filtro", () => {
    // Para quem opera, os dois são "automação" — a diferença é onde se edita.
    expect(filterWorkflowCatalog(items, "automacao").map((i) => i.kind)).toEqual([
      "schema",
      "rule",
    ]);
  });

  it("formulário e sistema têm filtro próprio", () => {
    expect(filterWorkflowCatalog(items, "formulario")).toHaveLength(1);
    expect(filterWorkflowCatalog(items, "sistema")).toHaveLength(1);
    expect(filterWorkflowCatalog(items, "todos")).toHaveLength(4);
  });

  it("a contagem dos chips bate com o que o filtro devolve", () => {
    const counts = countByFilter(items);
    expect(counts).toEqual({ todos: 4, formulario: 1, automacao: 2, sistema: 1 });
    for (const f of ["formulario", "automacao", "sistema"] as const) {
      expect(filterWorkflowCatalog(items, f)).toHaveLength(counts[f]);
    }
  });

  it("catalogItemFilter nunca devolve 'todos'", () => {
    for (const i of items) expect(i.kind === "system" ? "sistema" : catalogItemFilter(i)).not.toBe("todos");
  });
});
