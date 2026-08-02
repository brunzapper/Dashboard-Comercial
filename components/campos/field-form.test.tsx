// @vitest-environment jsdom
// Versão: 1.0 | Data: 02/08/2026
// Testes do controle "Aplica-se a" do FieldForm (02/08/2026): campo local
// renderiza checkboxes habilitadas (marcadas pelo applies_to) + o marcador
// applies_to_present; campo Bitrix exibe desabilitado SEM o marcador (a action
// não toca na coluna); linha core não mostra o controle; sem catálogo de
// fontes o controle some (e o marcador junto — form legado preserva a coluna).
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FieldDefinition } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";
import { FieldForm } from "./field-form";

vi.mock("@/app/(app)/campos/actions", () => ({
  createField: vi.fn(),
  updateField: vi.fn(),
}));
vi.mock("@/app/(app)/campos/preview-actions", () => ({
  previewRecordFormula: vi.fn(),
}));
vi.mock("@/app/(app)/dashboards/formula-preview-actions", () => ({
  previewAggregateFormula: vi.fn(),
}));

const src = (over: Partial<SourceDef> & { key: string }): SourceDef => ({
  recordType: over.key,
  label: over.key,
  shortLabel: over.key,
  defaultPeriodField: "source_created_at",
  builtin: false,
  manualEntry: true,
  ...over,
});

const CATALOG: SourceDef[] = [
  src({ key: "leads", recordType: "lead", label: "Leads do Bitrix" }),
  src({ key: "deals", recordType: "negocio", label: "Deals do Bitrix" }),
  // Sub-base nunca vira checkbox (herda os campos da pai).
  src({
    key: "reunioes",
    recordType: "lead",
    label: "Reuniões qualificadas",
    parentKey: "leads",
  }),
];

const field = (over: Partial<FieldDefinition>): FieldDefinition => ({
  id: "f1",
  field_key: "sdr_reuniao",
  label: "SDR da Reunião",
  data_type: "texto",
  options: [],
  visible_to_roles: [],
  editable_by_roles: [],
  is_local: true,
  sort_order: 0,
  ...over,
});

function appliesCheckbox(label: string): HTMLInputElement {
  return screen.getByRole("checkbox", { name: label }) as HTMLInputElement;
}

describe("FieldForm — Aplica-se a (02/08/2026)", () => {
  it("campo local: checkboxes habilitadas, marcadas pelo applies_to, com o marcador", () => {
    const { container } = render(
      <FieldForm
        field={field({ applies_to: ["lead"] })}
        numericRefs={[]}
        sources={CATALOG}
      />
    );
    const leads = appliesCheckbox("Leads do Bitrix");
    const deals = appliesCheckbox("Deals do Bitrix");
    expect(leads.checked).toBe(true);
    expect(leads.disabled).toBe(false);
    expect(deals.checked).toBe(false);
    // Sub-base fora das opções.
    expect(screen.queryByRole("checkbox", { name: "Reuniões qualificadas" })).toBeNull();
    expect(
      container.querySelector('input[name="applies_to_present"]')
    ).not.toBeNull();
  });

  it("campo Bitrix: checkboxes desabilitadas e SEM o marcador (action não toca)", () => {
    const { container } = render(
      <FieldForm
        field={field({ source_system: "bitrix", applies_to: ["negocio"] })}
        numericRefs={[]}
        sources={CATALOG}
      />
    );
    const deals = appliesCheckbox("Deals do Bitrix");
    expect(deals.checked).toBe(true);
    expect(deals.disabled).toBe(true);
    expect(
      container.querySelector('input[name="applies_to_present"]')
    ).toBeNull();
    expect(
      screen.getByText(/as bases são definidas pela sincronização/i)
    ).toBeInTheDocument();
  });

  it("linha core não mostra o controle; sem catálogo o controle (e o marcador) some", () => {
    const core = render(
      <FieldForm
        field={field({ field_key: "pipeline", source_system: "core" })}
        numericRefs={[]}
        sources={CATALOG}
      />
    );
    expect(core.container.querySelector('input[name="applies_to"]')).toBeNull();
    core.unmount();

    const noCatalog = render(
      <FieldForm field={field({ applies_to: ["lead"] })} numericRefs={[]} />
    );
    expect(
      noCatalog.container.querySelector('input[name="applies_to_present"]')
    ).toBeNull();
  });
});
