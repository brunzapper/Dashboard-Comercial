// @vitest-environment jsdom
// Versão: 1.0 | Data: 25/07/2026
// Testes do wizard "Taxa de conversão" (RecipeStrip): cada lado escolhe uma
// Base OU Sub-base (grupos "Bases"/"Sub-bases"; sub exibida "Pai › Sub") e a
// receita emite refs escopadas `agg:count:*@<fonte>` do catálogo VIVO
// (sourceScopedAggOperandRefs — nada de lista paralela nos fixtures).
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecipeStrip } from "@/components/formula/recipe-strip";
import type { SourceDef } from "@/lib/sources";
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
    key: "deals",
    recordType: "negocio",
    label: "Deals do Bitrix",
    shortLabel: "Deals",
    defaultPeriodField: "closed_at",
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

const CATALOG = sourceScopedAggOperandRefs([], [], SOURCES);

async function openWizard(onApply = vi.fn()) {
  const user = userEvent.setup();
  render(
    <RecipeStrip
      recipes={["conversion_rate"]}
      aggCatalog={CATALOG}
      sources={SOURCES}
      onApply={onApply}
    />
  );
  await user.click(
    screen.getByRole("button", { name: /Taxa de conversão/ })
  );
  return { user, onApply };
}

describe("RecipeStrip — Taxa de conversão", () => {
  it("seletor de fonte agrupa Bases e Sub-bases (sub exibida como Pai › Sub)", async () => {
    const { user } = await openWizard();
    await user.click(
      screen.getByRole("combobox", { name: "Base ou Sub-base do numerador" })
    );
    const body = within(document.body);
    expect(body.getByText("Bases")).toBeInTheDocument();
    expect(body.getByText("Sub-bases")).toBeInTheDocument();
    expect(body.getByText("Leads do Bitrix")).toBeInTheDocument();
    expect(body.getByText("Leads › SQLs")).toBeInTheDocument();
  });

  it("Sub-base ÷ Base emite refs escopadas do catálogo vivo, formato percent", async () => {
    const { user, onApply } = await openWizard();
    const body = within(document.body);

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
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "percent",
        formula: {
          tokens: [
            { kind: "field", ref: "agg:count:*@sqls" },
            { kind: "op", op: "/" },
            { kind: "field", ref: "agg:count:*@leads" },
          ],
        },
      })
    );
  });
});
