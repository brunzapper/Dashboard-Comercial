// Versão: 1.0 | Data: 30/07/2026
// Testes do validador do contrato "registros-insert" (inserção por IA):
// tipos/leniências, resolução de nomes de relação, teto de 10, chaves
// desconhecidas e a re-serialização canônica estável (o apply e a prévia
// editada passam pelo MESMO validador).
import { describe, expect, it } from "vitest";

import type { RecordsEntryContext } from "@/lib/import/records/types";
import {
  serializeRecordsInsert,
  validateRecordsInsert,
} from "@/lib/import/records/validate";

function ctx(overrides: Partial<RecordsEntryContext> = {}): RecordsEntryContext {
  return {
    sourceKey: "parceiros",
    sourceLabel: "Parceiros",
    recordType: "parceiros",
    fields: [
      { key: "title", label: "Título", kind: "core", dataType: "texto" },
      { key: "value", label: "Valor", kind: "core", dataType: "moeda" },
      {
        key: "currency",
        label: "Moeda",
        kind: "core",
        dataType: "texto",
        options: ["BRL", "USD", "EUR", "GBP", "ARS"],
        strictOptions: true,
      },
      { key: "closed", label: "Fechado", kind: "core", dataType: "booleano" },
      { key: "closed_at", label: "Fechamento", kind: "core", dataType: "data" },
      {
        key: "stage",
        label: "Etapa",
        kind: "core",
        dataType: "texto",
        // Options de override core são SUGESTÃO — nunca bloqueiam.
        options: ["Proposta", "Fechado"],
        strictOptions: false,
      },
      {
        key: "responsible_id",
        label: "Responsável",
        kind: "relation",
        dataType: "relacao",
        options: ["Maria Silva", "João Souza"],
        strictOptions: true,
      },
      {
        key: "operation_id",
        label: "Operação",
        kind: "relation",
        dataType: "relacao",
        options: ["Time SP"],
        strictOptions: true,
      },
      {
        key: "custom:origem_lead",
        label: "Origem",
        kind: "custom",
        dataType: "selecao",
        options: ["Indicação", "Evento"],
        strictOptions: true,
      },
      { key: "custom:obs", label: "Obs", kind: "custom", dataType: "texto" },
      {
        key: "custom:data_visita",
        label: "Visita",
        kind: "custom",
        dataType: "data",
      },
    ],
    responsibles: [
      { id: "r1", name: "Maria Silva" },
      { id: "r2", name: "João Souza" },
    ],
    operations: [{ id: "o1", name: "Time SP" }],
    ...overrides,
  };
}

function envelope(registros: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    formato: "registros-insert",
    versao: 1,
    registros,
    ...extra,
  });
}

describe("validateRecordsInsert", () => {
  it("happy path: todos os tipos + nomes resolvidos p/ UUID + notas → warnings", () => {
    const raw = envelope(
      [
        {
          title: "Proposta ACME",
          value: "1.250,50", // leniência: string numérica pt-BR
          currency: "brl", // normaliza p/ código
          closed: "true", // leniência: string booleana
          closed_at: "2026-07-28",
          stage: "Etapa nova", // fora das options soft — aceita
          responsible_id: "maria silva", // case-insensitive → grafia canônica
          operation_id: "Time SP",
          "custom:origem_lead": "indicação", // canônica da opção
          "custom:obs": 42, // escalar vira texto
          "custom:data_visita": "2026-07-29",
        },
      ],
      { notas: ["Telefone ficou de fora."] }
    );
    const v = validateRecordsInsert(raw, ctx());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = v.records[0];
    expect(r.values.value).toBe(1250.5);
    expect(r.values.currency).toBe("BRL");
    expect(r.values.closed).toBe(true);
    expect(r.values.stage).toBe("Etapa nova");
    expect(r.values.responsible_id).toBe("Maria Silva");
    expect(r.responsibleId).toBe("r1");
    expect(r.operationId).toBe("o1");
    expect(r.values["custom:origem_lead"]).toBe("Indicação");
    expect(r.values["custom:obs"]).toBe("42");
    expect(v.warnings).toEqual(["Telefone ficou de fora."]);
  });

  it("re-serialização canônica é estável (round-trip da prévia editada)", () => {
    const raw = envelope([
      { title: "A", value: 10, responsible_id: "Maria Silva" },
    ]);
    const v = validateRecordsInsert(raw, ctx());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const serialized = serializeRecordsInsert(v.records.map((r) => r.values));
    const again = validateRecordsInsert(serialized, ctx());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.records.map((r) => r.values)).toEqual(
      v.records.map((r) => r.values)
    );
  });

  it("aceita envelope em code fence", () => {
    const raw = "```json\n" + envelope([{ title: "A" }]) + "\n```";
    expect(validateRecordsInsert(raw, ctx()).ok).toBe(true);
  });

  it("JSON inválido → erro único de parse", () => {
    const v = validateRecordsInsert("{{{lixo", ctx());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors).toHaveLength(1);
  });

  it("teto de 10 registros", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ title: `R${i}` }));
    const v = validateRecordsInsert(envelope(many), ctx());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("Máximo de 10");
  });

  it("formato/versao errados e title ausente", () => {
    const v = validateRecordsInsert(
      JSON.stringify({ formato: "x", versao: 2, registros: [{ value: 1 }] }),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toContain('"formato"');
    expect(v.errors.join(" ")).toContain('"versao"');
    expect(v.errors.join(" ")).toContain('"title"');
  });

  it("chave desconhecida lista as aceitas", () => {
    const v = validateRecordsInsert(
      envelope([{ title: "A", telefone: "11 99999-0000" }]),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain('"telefone"');
    expect(v.errors[0]).toContain("custom:origem_lead");
  });

  it("selecao DURA fora das opções lista as opções", () => {
    const v = validateRecordsInsert(
      envelope([{ title: "A", "custom:origem_lead": "Cold call" }]),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("Indicação");
  });

  it("data fora de YYYY-MM-DD e número inválido", () => {
    const v = validateRecordsInsert(
      envelope([{ title: "A", closed_at: "28/07/2026", value: "mil reais" }]),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toContain("YYYY-MM-DD");
    expect(v.errors.join(" ")).toContain("número");
  });

  it("responsável desconhecido lista os cadastrados; ambíguo explica", () => {
    const unknown = validateRecordsInsert(
      envelope([{ title: "A", responsible_id: "Fulano" }]),
      ctx()
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]).toContain("Maria Silva");

    const ambiguous = validateRecordsInsert(
      envelope([{ title: "A", responsible_id: "Maria Silva" }]),
      ctx({
        responsibles: [
          { id: "r1", name: "Maria Silva" },
          { id: "r9", name: "maria silva" },
        ],
      })
    );
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.errors[0]).toContain("2 cadastros");
  });

  it("moeda core fora dos códigos aceitos", () => {
    const v = validateRecordsInsert(
      envelope([{ title: "A", currency: "XYZ" }]),
      ctx()
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors[0]).toContain("BRL");
  });

  it("valor vazio/null = campo ausente (sem erro)", () => {
    const v = validateRecordsInsert(
      envelope([{ title: "A", value: null, "custom:obs": "  " }]),
      ctx()
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect("value" in v.records[0].values).toBe(false);
    expect("custom:obs" in v.records[0].values).toBe(false);
  });
});
