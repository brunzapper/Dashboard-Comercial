// Versão: 1.0 | Data: 07/08/2026
// Guardas do de-para de valores (0117): catálogo estável, normalização
// byte-igual ao cache do Apps Script antigo, resolução com fallback
// "Não Classificado", planejamento idempotente (só diferenças) e tally de
// pendências; textos da tarefa de notificação.
import { describe, expect, it } from "vitest";

import {
  MAPPING_DOMAINS,
  UNCLASSIFIED,
  buildMappingIndex,
  mappingDomain,
  mappingDomainsForRecordType,
  normalizeRawValue,
  planMappingWrites,
  resolveOutputs,
} from "./domains";
import { unmappedTaskDescription, unmappedTaskTitle } from "./messages";

describe("MAPPING_DOMAINS", () => {
  it("tem chaves únicas, targets com fallback e record_types declarados", () => {
    const keys = MAPPING_DOMAINS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of MAPPING_DOMAINS) {
      expect(d.recordTypes.length).toBeGreaterThan(0);
      expect(d.targets.length).toBeGreaterThan(0);
      for (const t of d.targets) {
        expect(d.fallback[t.fieldKey]).toBeDefined();
      }
    }
  });

  it("cargo → área+nível; segmento → classificado (meetime_outbound)", () => {
    expect(mappingDomain("cargo")?.targets.map((t) => t.fieldKey)).toEqual([
      "cargo_area",
      "cargo_nivel",
    ]);
    expect(mappingDomain("segmento")?.targets.map((t) => t.fieldKey)).toEqual([
      "segmento_classificado",
    ]);
    expect(
      mappingDomainsForRecordType("meetime_outbound").map((d) => d.key)
    ).toEqual(["cargo", "segmento"]);
    expect(mappingDomainsForRecordType("lead")).toEqual([]);
  });
});

describe("normalizeRawValue", () => {
  it("lower(trim()) — mesma chave do cache do Apps Script antigo", () => {
    expect(normalizeRawValue("  IT Manager ")).toBe("it manager");
    expect(normalizeRawValue(null)).toBe("");
    expect(normalizeRawValue(undefined)).toBe("");
    expect(normalizeRawValue(42)).toBe("42");
  });
});

describe("resolveOutputs", () => {
  const cargo = mappingDomain("cargo")!;
  const index = buildMappingIndex([
    { rawNorm: "it manager", outputs: { cargo_area: "TI", cargo_nivel: "Gerente" } },
    { rawNorm: "compliance", outputs: { cargo_area: "Compliance" } },
  ]);

  it("valor mapeado devolve as saídas da entrada", () => {
    const r = resolveOutputs(cargo, " IT Manager ", index);
    expect(r.unmapped).toBe(false);
    expect(r.outputs).toEqual({ cargo_area: "TI", cargo_nivel: "Gerente" });
  });

  it("target ausente na entrada cai no fallback do domínio", () => {
    const r = resolveOutputs(cargo, "Compliance", index);
    expect(r.unmapped).toBe(false);
    expect(r.outputs).toEqual({
      cargo_area: "Compliance",
      cargo_nivel: UNCLASSIFIED,
    });
  });

  it("valor sem entrada = fallback + pendência; vazio = fallback sem pendência", () => {
    const miss = resolveOutputs(cargo, "Cargo Inédito", index);
    expect(miss.unmapped).toBe(true);
    expect(miss.outputs).toEqual({
      cargo_area: UNCLASSIFIED,
      cargo_nivel: UNCLASSIFIED,
    });
    const empty = resolveOutputs(cargo, "   ", index);
    expect(empty.unmapped).toBe(false);
    expect(empty.outputs.cargo_area).toBe(UNCLASSIFIED);
  });
});

describe("planMappingWrites", () => {
  const cargo = mappingDomain("cargo")!;
  const index = buildMappingIndex([
    { rawNorm: "cto", outputs: { cargo_area: "TI", cargo_nivel: "C-Level" } },
  ]);

  it("gera só diferenças (idempotente) e conta pendências por valor", () => {
    const rows = [
      { id: "a", custom_fields: { cargo: "CTO" } },
      // Já aplicado — nenhuma escrita.
      {
        id: "b",
        custom_fields: { cargo: "CTO", cargo_area: "TI", cargo_nivel: "C-Level" },
      },
      { id: "c", custom_fields: { cargo: "Cargo Novo" } },
      { id: "d", custom_fields: { cargo: " cargo novo " } },
      { id: "e", is_mock: true, custom_fields: { cargo: "CTO" } },
      { id: "f", custom_fields: {} },
    ];
    const plan = planMappingWrites(cargo, rows, index);
    expect(plan.writes.map((w) => w.recordId)).toEqual(["a", "c", "d", "f"]);
    expect(plan.writes[0].changes).toEqual({
      cargo_area: "TI",
      cargo_nivel: "C-Level",
    });
    // Pendência agregada pela forma normalizada, exibida pela 1ª forma vista.
    expect([...plan.unmapped.entries()]).toEqual([["Cargo Novo", 2]]);

    // Segunda rodada sobre o estado pós-aplicação = zero escritas.
    const applied = rows.map((r) =>
      r.is_mock
        ? r
        : {
            ...r,
            custom_fields: {
              ...r.custom_fields,
              ...(plan.writes.find((w) => w.recordId === r.id)?.changes ?? {}),
            },
          }
    );
    expect(planMappingWrites(cargo, applied, index).writes).toEqual([]);
  });
});

describe("mensagens da tarefa de pendências", () => {
  it("título e descrição estáveis", () => {
    expect(unmappedTaskTitle("cargo")).toBe("Mapeamentos pendentes — Cargos");
    const desc = unmappedTaskDescription(
      "segmento",
      new Map([
        ["Fintech", 3],
        ["Aviação", 1],
      ])
    );
    expect(desc).toContain('2 valor(es) de "Segmento" sem classificação');
    expect(desc).toContain("• Fintech (3 registros)");
    expect(desc).toContain("• Aviação (1 registro)");
    expect(desc).toContain("/operacao/mapeamentos");
  });
});
