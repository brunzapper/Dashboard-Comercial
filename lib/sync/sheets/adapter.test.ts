// Versão: 1.0 | Data: 03/08/2026
// Adapter da planilha em LOTE (v1.4): o contrato destes testes é o formato
// das consultas — O(1) leituras de responsibles por push, existentes por
// .in("source_id"), leads por ilikeAnyOf — e o skip-unchanged do update
// (re-push idempotente não gera escrita nem audit; era o churn que estourava
// o teto de 60s da rota). Fake client de tests/helpers (sem banco).
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  fakeSupabase,
  type RecordedQuery,
  type TableHandler,
} from "../../../tests/helpers/fake-supabase";
import { normalizeName } from "@/lib/sync/shared";
import { syncEstudoFechamentosRows, type SheetSiteRow } from "./adapter";

function sheetRow(over: Partial<SheetSiteRow> = {}): SheetSiteRow {
  return {
    name: "Cliente Um",
    email: null,
    created_at: "2026-08-01",
    consultor: null,
    products: null,
    mrr: null,
    plan: null,
    seats: null,
    contract: null,
    etapa_crm: null,
    canal: null,
    campanha: null,
    lead_created_at: null,
    lead_time_days: null,
    ...over,
  };
}

// Réplica da chave natural do adapter (p/ montar fixtures de existentes).
function sid(name: string, createdAt: string): string {
  return createHash("sha256")
    .update(`${normalizeName(name)}|${createdAt.trim()}`)
    .digest("hex");
}

function existingRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "e1",
    source_id: sid("Cliente Um", "2026-08-01"),
    title: "Cliente Um",
    currency: null,
    closed: null,
    field_modified_at: {},
    last_synced_at: "2026-08-01T00:00:00+00:00",
    custom_fields: {},
    responsible_id: null,
    operation_id: null,
    related_lead_id: null,
    lead_time_days: null,
    stage: null,
    value: null,
    mrr: null,
    sale_type: null,
    channel: null,
    ...over,
  };
}

const hasEq = (q: RecordedQuery, col: string, val: unknown) =>
  q.steps.some(
    (s) => s.method === "eq" && s.args[0] === col && s.args[1] === val
  );

// Handler de `records` que despacha pela FORMA da cadeia: select de
// existentes (source_system) × select de leads (record_type) × insert × update.
function recordsHandler(opts: {
  existing?: Record<string, unknown>[];
  leads?: Record<string, unknown>[];
}): TableHandler {
  return (q) => {
    const insertStep = q.steps.find((s) => s.method === "insert");
    if (insertStep) {
      const payload = insertStep.args[0];
      const rows = Array.isArray(payload) ? [...payload] : [payload];
      return { data: rows.map((_, i) => ({ id: `new-${i}` })), error: null };
    }
    if (q.steps.some((s) => s.method === "update")) {
      return { data: null, error: null };
    }
    if (hasEq(q, "record_type", "lead")) return { data: opts.leads ?? [], error: null };
    if (hasEq(q, "source_system", "sheet_site")) {
      return { data: opts.existing ?? [], error: null };
    }
    throw new Error(`consulta de records inesperada: ${JSON.stringify(q.steps)}`);
  };
}

describe("syncEstudoFechamentosRows (lote)", () => {
  it("payload vazio não toca o banco", async () => {
    const fake = fakeSupabase({ tables: {} });
    const { result, touchedRecordIds } = await syncEstudoFechamentosRows(fake.db, []);
    expect(result.inserted + result.updated + result.skipped + result.errors).toBe(0);
    expect(touchedRecordIds).toEqual([]);
    expect(fake.queries).toEqual([]);
  });

  it("N linhas = 1 leitura de responsibles, existentes por .in e insert em lote", async () => {
    const fake = fakeSupabase({
      tables: {
        field_definitions: [],
        responsibles: [{ id: "r1", display_name: "Fulano", bitrix_user_id: null }],
        responsible_operations: [{ responsible_id: "r1", operation_id: "op1" }],
        records: recordsHandler({}),
      },
    });
    const rows = [1, 2, 3].map((i) =>
      sheetRow({ name: `Cliente ${i}`, consultor: "Fulano" })
    );
    const { result, touchedRecordIds } = await syncEstudoFechamentosRows(fake.db, rows);

    expect(result.inserted).toBe(3);
    expect(result.errors).toBe(0);
    expect(touchedRecordIds).toHaveLength(3);

    // Responsáveis: UMA leitura para o lote inteiro, nenhum insert (nome já existe).
    const respQueries = fake.queries.filter((q) => q.table === "responsibles");
    expect(respQueries).toHaveLength(1);

    // Operação primária: uma consulta .in com o id resolvido.
    const opQueries = fake.queries.filter((q) => q.table === "responsible_operations");
    expect(opQueries).toHaveLength(1);
    expect(
      opQueries[0].steps.some((s) => s.method === "in" && s.args[0] === "responsible_id")
    ).toBe(true);

    // Existentes: uma consulta .in("source_id", [3 hashes]) — nunca por linha.
    const recQueries = fake.queries.filter((q) => q.table === "records");
    const existingQ = recQueries.filter((q) => hasEq(q, "source_system", "sheet_site"));
    expect(existingQ).toHaveLength(1);
    const inStep = existingQ[0].steps.find((s) => s.method === "in");
    expect(inStep?.args[0]).toBe("source_id");
    expect(inStep?.args[1]).toHaveLength(3);
    expect(recQueries.every((q) => !q.steps.some((s) => s.method === "maybeSingle"))).toBe(
      true
    );

    // Insert em LOTE único com responsável/operação resolvidos e a âncora de
    // Brasília no source_created_at (invariante 11).
    const inserts = recQueries.filter((q) => q.steps.some((s) => s.method === "insert"));
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].steps.find((s) => s.method === "insert")!
      .args[0] as Record<string, unknown>[];
    expect(payload).toHaveLength(3);
    for (const p of payload) {
      expect(p.responsible_id).toBe("r1");
      expect(p.operation_id).toBe("op1");
      expect(String(p.source_created_at)).toMatch(/-03:00$/);
    }
  });

  it("consultor inexistente = 1 select + 1 insert de responsável p/ o lote", async () => {
    const fake = fakeSupabase({
      tables: {
        field_definitions: [],
        responsibles: (q: RecordedQuery) =>
          q.steps.some((s) => s.method === "insert")
            ? { data: { id: "r9" }, error: null }
            : { data: [], error: null },
        responsible_operations: [],
        records: recordsHandler({}),
      },
    });
    const rows = [1, 2].map((i) =>
      sheetRow({ name: `Cliente ${i}`, consultor: "Novo Nome" })
    );
    const { result } = await syncEstudoFechamentosRows(fake.db, rows);
    expect(result.inserted).toBe(2);
    const respQueries = fake.queries.filter((q) => q.table === "responsibles");
    expect(respQueries).toHaveLength(2); // 1 select + 1 insert (não 1 por linha)
  });

  it("leads por e-mail: 1 ilikeAnyOf, mais recente vence e curinga não vincula", async () => {
    const fake = fakeSupabase({
      tables: {
        field_definitions: [],
        records: recordsHandler({
          leads: [
            // Mesmo e-mail em caixa diferente: o mais recente vence; o NULL
            // perde (a versão por linha deixava o NULL vencer, acidente do DESC).
            { id: "l-old", source_created_at: null, email: "a@x.com" },
            { id: "l-new", source_created_at: "2026-07-01T12:00:00+00:00", email: "A@X.com" },
            // Só casaria via curinga do `_` — o pós-filtro exige igualdade.
            { id: "l-wild", source_created_at: "2026-07-02T12:00:00+00:00", email: "bXc@y.com" },
          ],
        }),
      },
    });
    const rows = [
      sheetRow({ name: "Com Lead", email: "a@x.com" }),
      sheetRow({ name: "Sem Lead", email: "b_c@y.com" }),
    ];
    const { result } = await syncEstudoFechamentosRows(fake.db, rows);
    expect(result.inserted).toBe(2);

    const leadQueries = fake.queries.filter(
      (q) => q.table === "records" && hasEq(q, "record_type", "lead")
    );
    expect(leadQueries).toHaveLength(1);
    const anyOf = leadQueries[0].steps.find((s) => s.method === "ilikeAnyOf");
    expect(anyOf?.args[0]).toBe("custom_fields->>email");
    expect(anyOf?.args[1]).toEqual(["a@x.com", "b\\_c@y.com"]); // curingas escapados

    const insertQ = fake.queries.find(
      (q) => q.table === "records" && q.steps.some((s) => s.method === "insert")
    )!;
    const payload = insertQ.steps.find((s) => s.method === "insert")!
      .args[0] as Record<string, unknown>[];
    const withLead = payload.find((p) => p.title === "Com Lead")!;
    const without = payload.find((p) => p.title === "Sem Lead")!;
    expect(withLead.related_lead_id).toBe("l-new");
    expect(without.related_lead_id).toBeNull();
  });

  it("re-push idempotente: tudo skipped, zero UPDATE e zero audit", async () => {
    const rows = [
      sheetRow({ name: "Cliente Um" }),
      sheetRow({ name: "Cliente Dois" }),
    ];
    const fake = fakeSupabase({
      tables: {
        field_definitions: [],
        records: recordsHandler({
          existing: [
            existingRecord({ id: "e1", source_id: sid("Cliente Um", "2026-08-01") }),
            existingRecord({ id: "e2", source_id: sid("Cliente Dois", "2026-08-01") }),
          ],
        }),
      },
    });
    const { result, touchedRecordIds } = await syncEstudoFechamentosRows(fake.db, rows);
    expect(result.skipped).toBe(2);
    expect(result.updated).toBe(0);
    expect(touchedRecordIds).toEqual([]);
    expect(
      fake.queries.some((q) => q.steps.some((s) => s.method === "update"))
    ).toBe(false);
    expect(fake.queries.filter((q) => q.table === "audit_log")).toHaveLength(0);
  });

  it("linha alterada: UPDATE só do que mudou + audit em lote; campo protegido fica", async () => {
    const rows = [sheetRow({ etapa_crm: "Fechado", contract: 999 })];
    const fake = fakeSupabase({
      tables: {
        field_definitions: [],
        audit_log: () => ({ data: null, error: null }),
        records: recordsHandler({
          existing: [
            existingRecord({
              stage: "Aberto",
              value: 100,
              // `value` editado manualmente DEPOIS do último sync → protegido.
              field_modified_at: { value: "2026-08-02T00:00:00+00:00" },
              last_synced_at: "2026-08-01T00:00:00+00:00",
            }),
          ],
        }),
      },
    });
    const { result, touchedRecordIds } = await syncEstudoFechamentosRows(fake.db, rows);
    expect(result.updated).toBe(1);
    expect(touchedRecordIds).toEqual(["e1"]);

    const updateQ = fake.queries.find((q) =>
      q.steps.some((s) => s.method === "update")
    )!;
    const updates = updateQ.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    expect(updates.stage).toBe("Fechado");
    expect("value" in updates).toBe(false); // protegido
    expect("custom_fields" in updates).toBe(false); // custom inalterado não grava
    expect(typeof updates.last_synced_at).toBe("string");

    const auditQ = fake.queries.filter((q) => q.table === "audit_log");
    expect(auditQ).toHaveLength(1);
    const auditRows = auditQ[0].steps.find((s) => s.method === "insert")!
      .args[0] as Record<string, unknown>[];
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      record_id: "e1",
      field: "stage",
      origin: "sync_sheet",
    });
  });

  it("duplicata na planilha: primeira vence, demais skipped", async () => {
    const fake = fakeSupabase({
      tables: {
        field_definitions: [],
        records: recordsHandler({}),
      },
    });
    const rows = [
      sheetRow({ contract: 100 }),
      sheetRow({ contract: 200 }), // mesma chave natural (nome + data)
    ];
    const { result } = await syncEstudoFechamentosRows(fake.db, rows);
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    const insertQ = fake.queries.find((q) =>
      q.steps.some((s) => s.method === "insert")
    )!;
    const payload = insertQ.steps.find((s) => s.method === "insert")!
      .args[0] as Record<string, unknown>[];
    expect(payload).toHaveLength(1);
    expect(payload[0].value).toBe(100);
  });
});
