// @vitest-environment jsdom
// Versão: 1.0 | Data: 25/07/2026
// Testes do modo Fórmula do Card: a receita "Taxa de conversão" está disponível
// e, como o Card não tem flag de percentual, aplicar a receita emite
// (fórmula) × 100 + sufixo "%" (padrão persistido pelos presets), preservando
// sufixo já definido pelo usuário.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CardModeSection } from "@/components/dashboards/card-mode-section";
import type { SourceDef } from "@/lib/sources";
import type { CardConfig } from "@/lib/widgets/types";
import { sourceScopedAggOperandRefs } from "@/lib/widgets/calc-metrics";

const SOURCES: SourceDef[] = [
  {
    key: "leads",
    recordType: "lead",
    label: "Leads do Bitrix",
    shortLabel: "Leads",
    defaultPeriodField: "source_created_at",
    builtin: true,
    manualEntry: false,
  },
  {
    key: "sqls",
    recordType: "lead",
    label: "SQLs",
    shortLabel: "SQL",
    defaultPeriodField: "source_created_at",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
  },
];

const CALC_REFS = sourceScopedAggOperandRefs([], [], SOURCES);

function setup(value: CardConfig) {
  const onChange = vi.fn();
  render(
    <CardModeSection
      value={value}
      onChange={onChange}
      fieldOptions={[]}
      rankOptions={[]}
      metricFieldOptions={[]}
      calcRefs={CALC_REFS}
      sources={SOURCES}
    />
  );
  return onChange;
}

async function applyConversionRecipe() {
  const user = userEvent.setup();
  const body = within(document.body);
  await user.click(screen.getByRole("button", { name: /Taxa de conversão/ }));
  await user.click(
    screen.getByRole("combobox", { name: "Base ou Sub-base do numerador" })
  );
  await user.click(body.getByText("Leads › SQLs"));
  await user.click(
    screen.getByRole("combobox", { name: "Contagem do numerador" })
  );
  await user.click(body.getByText("Contagem de registros · SQL"));
  await user.click(
    screen.getByRole("combobox", { name: "Base ou Sub-base do denominador" })
  );
  await user.click(body.getByText("Leads do Bitrix"));
  await user.click(
    screen.getByRole("combobox", { name: "Contagem do denominador" })
  );
  await user.click(body.getByText("Contagem de registros · Leads"));
  await user.click(screen.getByRole("button", { name: "Gerar fórmula" }));
}

const EXPECTED_TOKENS = [
  { kind: "lparen" },
  { kind: "field", ref: "agg:count:*@sqls" },
  { kind: "op", op: "/" },
  { kind: "field", ref: "agg:count:*@leads" },
  { kind: "rparen" },
  { kind: "op", op: "*" },
  { kind: "const", value: 100 },
];

describe("CardModeSection — modo Fórmula", () => {
  it("receita de conversão aplica (fórmula) × 100 e sufixo %", async () => {
    const onChange = setup({ mode: "formula" });
    await applyConversionRecipe();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        formula: { tokens: EXPECTED_TOKENS },
        suffix: "%",
      })
    );
  });

  it("sufixo já definido pelo usuário é preservado", async () => {
    const onChange = setup({ mode: "formula", suffix: "pts" });
    await applyConversionRecipe();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        formula: { tokens: EXPECTED_TOKENS },
        suffix: "pts",
      })
    );
  });
});
