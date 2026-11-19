// Versão: 1.0 | Data: 19/11/2026
import { describe, expect, it } from "vitest";

import { bitrixUiLabel, isInternalBitrixLabel } from "./field-label";

describe("bitrixUiLabel", () => {
  it("campo de usuário: o title é o código, o rótulo de UI vence", () => {
    expect(
      bitrixUiLabel("UF_CRM_1690000000", {
        title: "UF_CRM_1690000000",
        listLabel: "Segmento",
        formLabel: "Segmento do cliente",
      })
    ).toBe("Segmento do cliente");
    expect(
      bitrixUiLabel("UF_CRM_X", { title: "UF_CRM_X", formLabel: "", listLabel: "Plano" })
    ).toBe("Plano");
    expect(
      bitrixUiLabel("UF_CRM_X", { title: "UF_CRM_X", filterLabel: "Origem" })
    ).toBe("Origem");
  });

  it("campo nativo: title já é o nome", () => {
    expect(bitrixUiLabel("OPPORTUNITY", { title: "Valor" })).toBe("Valor");
  });

  it("sem nenhum rótulo útil cai no código", () => {
    expect(bitrixUiLabel("UF_CRM_X", { title: "UF_CRM_X" })).toBe("UF_CRM_X");
    expect(bitrixUiLabel("UF_CRM_X", {})).toBe("UF_CRM_X");
  });

  it("reconhece rótulo que é só o código interno", () => {
    expect(isInternalBitrixLabel("UF_CRM_1690000000")).toBe(true);
    expect(isInternalBitrixLabel("Segmento")).toBe(false);
    expect(isInternalBitrixLabel(null)).toBe(false);
  });
});
