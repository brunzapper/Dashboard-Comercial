// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): estilo Operacional (segue o tema; só variáveis
//   estruturais) e campos novos byte-equivalentes nos estilos existentes.
// v1.0 (02/10/2026): estilo do dashboard — cascata board → org → Clássico,
//   whitelist de entrada E de saída, e o Clássico sem variável nenhuma (é o
//   que mantém o visual histórico byte-idêntico).
import { describe, expect, it } from "vitest";

import {
  DASHBOARD_FONTS,
  DASHBOARD_STYLES,
  DASHBOARD_STYLE_KEYS,
  dashboardStyleVars,
  followsSystemTheme,
  isClassicStyle,
  normalizeDashboardStyleSetting,
  resolveDashboardStyle,
} from "./style";

describe("estilo do dashboard", () => {
  it("cascata: board vence org, org vence o app, app = Clássico", () => {
    expect(resolveDashboardStyle({ key: "executivo" }, "editorial").key).toBe("executivo");
    expect(resolveDashboardStyle({ key: "executivo" }, "editorial").origin).toBe("board");
    expect(resolveDashboardStyle(undefined, "editorial").key).toBe("editorial");
    expect(resolveDashboardStyle(undefined, "editorial").origin).toBe("org");
    expect(resolveDashboardStyle(undefined, null).key).toBe("classico");
    expect(resolveDashboardStyle(undefined, "inexistente").key).toBe("classico");
    // Escolha inválida do board ⇒ herda (não derruba para Clássico à força).
    expect(resolveDashboardStyle({ key: "xpto" }, "editorial").key).toBe("editorial");
  });

  it("Clássico não emite variável nenhuma (render byte-idêntico)", () => {
    const s = resolveDashboardStyle(undefined, null);
    expect(isClassicStyle(s)).toBe(true);
    expect(dashboardStyleVars(s)).toEqual({});
  });

  it("estilos novos redefinem o tema shadcn só com #RRGGBB e fontes do catálogo", () => {
    for (const key of DASHBOARD_STYLE_KEYS) {
      if (key === "classico" || key === "operacional") continue;
      const vars = dashboardStyleVars(DASHBOARD_STYLES[key]);
      expect(vars["--ds-page"]).toMatch(/^#[0-9a-f]{6}$/);
      expect(vars["--card"]).toMatch(/^#[0-9a-f]{6}$/);
      expect(vars["--chart-1"]).toBe(vars["--ds-accent"]);
      const stacks = Object.values(DASHBOARD_FONTS).map((f) => f.stack);
      expect(stacks).toContain(vars["--ds-font-display"]);
      expect(stacks).toContain(vars["--ds-font-body"]);
    }
  });

  it("overrides: cor fora de #RRGGBB e fonte fora do catálogo somem", () => {
    const parsed = normalizeDashboardStyleSetting({
      key: "editorial",
      overrides: {
        accent: "red; background:url(x)",
        page: "#FFFFFF",
        fontDisplay: "Comic Sans",
        fontBody: "inter",
        extra: "nope",
      },
    });
    expect(parsed).toEqual({
      key: "editorial",
      overrides: { page: "#ffffff", fontBody: "inter" },
    });
    const s = resolveDashboardStyle(parsed, null);
    expect(s.colors?.page).toBe("#ffffff");
    expect(s.colors?.accent).toBe(DASHBOARD_STYLES.editorial.colors?.accent);
  });

  it("valor adulterado depois do parse não chega ao style (re-validação na saída)", () => {
    const tampered = {
      ...DASHBOARD_STYLES.editorial,
      colors: { ...DASHBOARD_STYLES.editorial.colors!, accent: "expression(alert(1))" },
    };
    expect(dashboardStyleVars(tampered)["--ds-accent"]).toBeUndefined();
  });

  it("v1.1: Operacional segue o tema — sem cor gravada, só fontes/raio/pesos", () => {
    const s = DASHBOARD_STYLES.operacional;
    expect(isClassicStyle(s)).toBe(false);
    expect(followsSystemTheme(s)).toBe(true);
    const vars = dashboardStyleVars(s);
    expect(Object.keys(vars).sort()).toEqual(
      ["--ds-font-body", "--ds-font-display", "--ds-radius", "--ds-w-regular", "--ds-w-strong"].sort()
    );
    // Overrides de cor não valem (não há paleta para sobrepor).
    const r = resolveDashboardStyle({ key: "operacional", overrides: { accent: "#123456" } }, null);
    expect(r.colors).toBeNull();
    expect(dashboardStyleVars(r)["--ds-accent"]).toBeUndefined();
  });

  it("v1.1: campos estruturais repetem o comportamento antigo nos estilos existentes", () => {
    for (const key of ["editorial", "editorial_escuro", "executivo"] as const) {
      const s = DASHBOARD_STYLES[key];
      expect(s.kpi).toEqual({ label: "normal", valueWeight: 400, valueTracking: "-0.01em" });
      expect(s.delta).toBe("sinal");
      expect(s.note).toBe("sem_papel");
    }
    expect(DASHBOARD_STYLES.operacional.kpi.label).toBe("caixa_alta");
    expect(DASHBOARD_STYLES.operacional.delta).toBe("colorido");
  });
});
