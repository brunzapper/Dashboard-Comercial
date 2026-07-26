// Versão: 1.0 | Data: 26/07/2026
// Campos do registro casado (`match:<fonte>:<ref>`): sub-fontes NUNCA geram
// refs `↪` — compartilham o record_type da pai (o "casado" seria o mesmo
// registro com rótulo enganoso) e a key da sub não resolve no lookup dos
// helpers SQL (0104). Bases dinâmicas RAIZ entram normalmente.
import { describe, expect, it } from "vitest";

import { buildMatchFields } from "@/lib/widgets/fields";
import type { SourceDef } from "@/lib/sources";

const base = {
  recordType: "",
  shortLabel: "",
  defaultPeriodField: "source_created_at",
  builtin: false,
  manualEntry: false,
};

const CATALOG: SourceDef[] = [
  { ...base, key: "leads", recordType: "lead", label: "Leads", builtin: true },
  { ...base, key: "parceiros", recordType: "parceiros", label: "Parceiros" },
  {
    ...base,
    key: "leads_inbound",
    recordType: "lead",
    label: "Leads Inbound",
    parentKey: "leads",
    filter: [{ field: "custom:fonte", op: "eq", value: "inbound" }],
  },
];

describe("buildMatchFields", () => {
  it("gera refs para fontes raiz, incluindo bases dinâmicas", () => {
    const out = buildMatchFields([], CATALOG);
    const srcs = new Set(out.map((f) => f.source));
    expect(srcs.has("leads")).toBe(true);
    expect(srcs.has("parceiros")).toBe(true);
    expect(out.some((f) => f.field === "match:parceiros:title")).toBe(true);
  });

  it("sub-fontes ficam fora (nunca casam)", () => {
    const out = buildMatchFields([], CATALOG);
    expect(out.some((f) => f.field.startsWith("match:leads_inbound:"))).toBe(
      false
    );
  });

  it("campos custom entram por applies_to da fonte raiz", () => {
    const out = buildMatchFields(
      [
        {
          field_key: "email",
          label: "E-mail",
          data_type: "texto",
          applies_to: ["parceiros"],
        },
      ],
      CATALOG
    );
    expect(
      out.some((f) => f.field === "match:parceiros:custom:email")
    ).toBe(true);
    expect(out.some((f) => f.field === "match:leads:custom:email")).toBe(
      false
    );
  });
});
