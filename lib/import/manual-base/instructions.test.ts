// Versão: 1.0 | Data: 17/09/2026
// Paridade do SPEC da BASE MANUAL com as constantes reais (molde de
// lib/import/tasks/instructions.test.ts). Teto ou modo de contagem novo que
// não chegue ao texto reprova aqui, e o EXEMPLO do prompt roda pelo validador
// REAL — o prompt nunca ensina um JSON que o próprio sistema recusaria.
import { describe, expect, it } from "vitest";

import {
  MANUAL_SPREADS,
  MANUAL_SPREAD_LABELS,
} from "@/lib/manual-base/types";

import {
  MANUAL_BASE_SPEC,
  MANUAL_BASE_SPEC_EXAMPLE,
  buildManualBasePromptText,
} from "./instructions";
import {
  MANUAL_BASE_FORMAT,
  MANUAL_BASE_VERSION,
  MAX_AI_MANUAL_ENTRIES,
  MAX_AI_MANUAL_SERIES,
  type ManualBaseEditContext,
} from "./types";
import { validateManualBaseEdit } from "./validate";

const ctx: ManualBaseEditContext = {
  series: [],
  responsibles: [{ id: "r1", name: "Maria Silva" }],
  operations: [
    { id: "op-out", name: "Outbound" },
    { id: "op-in", name: "Inbound" },
  ],
  today: "2026-09-17",
};

describe("SPEC da Base manual — derivado das constantes", () => {
  it("o formato e a versão aparecem no texto", () => {
    expect(MANUAL_BASE_SPEC).toContain(MANUAL_BASE_FORMAT);
    expect(MANUAL_BASE_SPEC).toContain(String(MANUAL_BASE_VERSION));
  });

  it("os tetos do lote aparecem no texto", () => {
    expect(MANUAL_BASE_SPEC).toContain(String(MAX_AI_MANUAL_SERIES));
    expect(MANUAL_BASE_SPEC).toContain(String(MAX_AI_MANUAL_ENTRIES));
  });

  it("TODOS os modos de contagem são ensinados, com a frase do dono único", () => {
    for (const s of MANUAL_SPREADS) {
      expect(MANUAL_BASE_SPEC, `modo "${s}" ausente do SPEC`).toContain(`"${s}"`);
      expect(
        MANUAL_BASE_SPEC,
        `rótulo de "${s}" ausente do SPEC`
      ).toContain(MANUAL_SPREAD_LABELS[s]);
    }
  });

  it("ensina o UPSERT e a ausência de exclusão — as duas decisões do contrato", () => {
    expect(MANUAL_BASE_SPEC).toContain("NÃO existe exclusão");
    expect(MANUAL_BASE_SPEC).toContain("ATUALIZA");
  });

  it("exige data absoluta", () => {
    expect(MANUAL_BASE_SPEC).toContain("AAAA-MM-DD");
    expect(MANUAL_BASE_SPEC).toContain("datas absolutas");
  });
});

describe("o EXEMPLO do SPEC passa pelo validador REAL", () => {
  it("é aceito e produz os dois lançamentos", () => {
    const v = validateManualBaseEdit(MANUAL_BASE_SPEC_EXAMPLE, ctx);
    expect(v.ok, v.ok ? "" : v.errors.join(" | ")).toBe(true);
    if (!v.ok) return;
    expect(v.parsed.entries).toHaveLength(2);
    expect(v.parsed.series.map((s) => s.key)).toEqual([
      "emails_replied",
      "emails_delivered",
    ]);
    expect(v.parsed.entries[0].operationId).toBe("op-out");
  });
});

describe("buildManualBasePromptText", () => {
  it("carrega o SPEC e o catálogo — mesmo texto do chat e do Copiar prompt", () => {
    const prompt = buildManualBasePromptText({ catalogJson: '{"series":[]}' });
    expect(prompt).toContain(MANUAL_BASE_SPEC);
    expect(prompt).toContain('{"series":[]}');
  });
});
