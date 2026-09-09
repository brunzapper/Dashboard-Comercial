// Versão: 1.0 | Data: 09/09/2026
// A decisão de produto é que execução falha NÃO se repete sozinha. O preço
// disso é que a falha ficaria só no last_error da regra, que ninguém abre —
// então ela vira TAREFA. O que estes testes protegem: uma tarefa por regra
// (falha nova atualiza, nunca duplica), auto-completar quando não há mais
// falhas, e nunca lançar (notificar não pode derrubar a rodada).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import {
  schemaFailureTaskDescription,
  schemaFailureTaskTitle,
  syncSchemaFailureTask,
} from "./notify";

/** Fake do PostgREST com o encadeamento que o módulo usa. */
function fakeDb(openTask: { id: string } | null) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: () => q,
        maybeSingle: async () => ({
          data: table === "tasks" ? openTask : { user_id: "admin-1" },
        }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ maybeSingle: async () => ({ data: { id: "t-new" } }) }) };
        },
        update: (row: Record<string, unknown>) => {
          updated.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
      return q;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, inserted, updated };
}

const falha = [{ recordId: "r1", message: "CRM fora do ar" }];

describe("syncSchemaFailureTask", () => {
  it("sem tarefa aberta, cria UMA em nome do org_admin", async () => {
    const { db, inserted } = fakeDb(null);
    await syncSchemaFailureTask(db, "org-1", {
      ruleId: "rule-1",
      ruleName: "Sincroniza",
      failures: falha,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      organization_id: "org-1",
      title: schemaFailureTaskTitle("Sincroniza"),
      created_by: "admin-1",
    });
  });

  it("com tarefa aberta, ATUALIZA a descrição em vez de duplicar", async () => {
    const { db, inserted, updated } = fakeDb({ id: "t-1" });
    await syncSchemaFailureTask(db, "org-1", {
      ruleId: "rule-1",
      ruleName: "Sincroniza",
      failures: falha,
    });
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(String(updated[0].description)).toContain("CRM fora do ar");
  });

  it("rodada sem falhas COMPLETA a tarefa aberta", async () => {
    const { db, updated } = fakeDb({ id: "t-1" });
    await syncSchemaFailureTask(db, "org-1", {
      ruleId: "rule-1",
      ruleName: "Sincroniza",
      failures: [],
    });
    expect(updated[0].completed_at).toBeTruthy();
  });

  it("sem falhas e sem tarefa aberta não faz nada", async () => {
    const { db, inserted, updated } = fakeDb(null);
    await syncSchemaFailureTask(db, "org-1", {
      ruleId: "rule-1",
      ruleName: "Sincroniza",
      failures: [],
    });
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it("nunca lança — notificar não pode derrubar a rodada", async () => {
    const db = {
      from() {
        throw new Error("banco fora");
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(
      syncSchemaFailureTask(db, "org-1", {
        ruleId: "r",
        ruleName: "X",
        failures: falha,
      })
    ).resolves.toBeUndefined();
  });
});

describe("schemaFailureTaskDescription", () => {
  it("lista os registros e diz como devolvê-los à fila", () => {
    const text = schemaFailureTaskDescription(falha);
    expect(text).toContain("r1");
    expect(text).toContain("Tentar de novo");
  });

  it("trunca listas longas em vez de despejar tudo", () => {
    const muitas = Array.from({ length: 25 }, (_, i) => ({
      recordId: `r${i}`,
      message: "erro",
    }));
    const text = schemaFailureTaskDescription(muitas);
    expect(text).toContain("e mais 5 registro(s)");
  });
});
