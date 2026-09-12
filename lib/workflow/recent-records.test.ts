// Versão: 1.0 | Data: 12/09/2026
// Os dois pontos de DECISÃO do painel de lançamentos recentes — os que erram
// calado se mudarem: de qual Base a lista é, e se existe link para o CRM.
import { describe, expect, it } from "vitest";

import { BUILTIN_SOURCES, bitrixEntityOfSource, type SourceDef } from "@/lib/sources";
import { parseWorkflowDefinition, type WorkflowDefinition } from "./types";
import { formTargetSource } from "./recent-records";

/** Catálogo com a base de leads aceitando criação manual (o caso real). */
const SOURCES: SourceDef[] = BUILTIN_SOURCES.map((s) =>
  s.key === "leads" ? { ...s, manualEntry: true } : s
);

function defWith(
  step: Record<string, unknown> | null,
  extra: Record<string, unknown>[] = []
): WorkflowDefinition {
  const steps = [...extra];
  if (step) steps.push(step);
  return parseWorkflowDefinition({
    version: 1,
    form: {
      fields: [
        { key: "empresa", label: "Empresa", type: "texto", order: 0 },
      ],
    },
    steps,
  })!;
}

const RECORD_STEP = {
  id: "gravar",
  type: "record.create",
  label: "Gravar registro",
  enabled: true,
  params: { sourceKey: "leads", core: { title: { value: "{{form.empresa}}" } } },
};

describe("formTargetSource", () => {
  it("a Base é a do passo record.create habilitado", () => {
    expect(formTargetSource(defWith(RECORD_STEP), SOURCES)?.key).toBe("leads");
  });

  it("passo DESLIGADO não define Base — ele não grava nada", () => {
    const def = defWith({ ...RECORD_STEP, enabled: false });
    expect(formTargetSource(def, SOURCES)).toBeNull();
  });

  it("sem passo de registro não há Base (formulário que só fala com o CRM)", () => {
    const def = defWith(null, [
      {
        id: "criar_lead",
        type: "bitrix.entity.add",
        label: "Criar lead",
        enabled: true,
        connection: "bitrix_webhook",
        params: { entity: "lead", fields: { TITLE: { value: "{{form.empresa}}" } } },
      },
    ]);
    expect(formTargetSource(def, SOURCES)).toBeNull();
  });

  it("Base que não aceita criação manual não conta — espelha o gate da execução", () => {
    // Mesmo gate que a action de lançamento aplica: sem `manual_entry` o
    // formulário não consegue gravar ali, então a lista seria de outra coisa.
    expect(formTargetSource(defWith(RECORD_STEP), BUILTIN_SOURCES)).toBeNull();
  });

  it("Base que saiu do catálogo não vira lista (nem erro)", () => {
    const def = defWith({
      ...RECORD_STEP,
      params: { ...RECORD_STEP.params, sourceKey: "base_que_nao_existe" },
    });
    expect(formTargetSource(def, SOURCES)).toBeNull();
  });
});

describe("bitrixEntityOfSource", () => {
  it("os builtins do CRM respondem por si (lead → lead, negocio → deal)", () => {
    expect(bitrixEntityOfSource("leads", BUILTIN_SOURCES)).toBe("lead");
    expect(bitrixEntityOfSource("deals", BUILTIN_SOURCES)).toBe("deal");
  });

  it("Base local não tem par no CRM — null, nunca um chute", () => {
    // "estudo" vem de planilha: tem registros, não tem entidade no portal.
    expect(bitrixEntityOfSource("estudo", BUILTIN_SOURCES)).toBeNull();
    expect(bitrixEntityOfSource("base_nova", BUILTIN_SOURCES)).toBeNull();
  });

  it("a declaração explícita da Base vence o palpite pelo record_type", () => {
    const sources: SourceDef[] = BUILTIN_SOURCES.map((s) =>
      s.key === "leads" ? { ...s, bitrixActivityOwner: "deal" as const } : s
    );
    expect(bitrixEntityOfSource("leads", sources)).toBe("deal");
  });
});
