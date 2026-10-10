// Versão: 1.1 | Data: 10/10/2026
// v1.1 (10/10/2026): paleta da interface: whitelist e precedência.
// Guarda dos TOKENS DE TEMA (0141): a whitelist é a muralha — nome de token
// fora de THEME_TOKENS e valor fora de #RRGGBB nunca podem chegar a um style
// ou script, venham de cookie, do banco ou do cliente.
import { describe, expect, it } from "vitest";

import {
  EMPTY_THEME_TOKENS,
  THEME_TOKENS,
  THEME_TOKEN_LABELS,
  hasThemeTokens,
  normalizeOrgTheme,
  normalizeThemePalette,
  normalizeThemeTokens,
  resolveTheme,
  resolveThemeTokens,
  themeTokenStyle,
} from "./theme";

describe("normalizeThemeTokens", () => {
  it("lixo em qualquer forma ⇒ vazio nos dois modos", () => {
    for (const v of [null, undefined, 1, [], "{", "não é json"]) {
      expect(normalizeThemeTokens(v)).toEqual(EMPTY_THEME_TOKENS);
    }
  });

  it("token FORA da whitelist é descartado", () => {
    const out = normalizeThemeTokens({
      light: { background: "#ffffff", "primary; content: 'x'": "#000000" },
    });
    expect(out.light).toEqual({ background: "#ffffff" });
  });

  it("valor que não é #RRGGBB é descartado (nada de var()/url()/js)", () => {
    const out = normalizeThemeTokens({
      light: {
        background: "red",
        foreground: "var(--x)",
        card: "url(javascript:alert(1))",
        muted: "#12345",
        border: "#AABBCC",
      },
    });
    expect(out.light).toEqual({ border: "#aabbcc" });
  });

  it("aceita o JSON do cookie como string", () => {
    const out = normalizeThemeTokens('{"dark":{"background":"#101010"}}');
    expect(out.dark).toEqual({ background: "#101010" });
  });

  it("os modos são independentes", () => {
    const out = normalizeThemeTokens({
      light: { background: "#ffffff" },
      dark: { background: "#000000" },
    });
    expect(out.light.background).toBe("#ffffff");
    expect(out.dark.background).toBe("#000000");
  });
});

describe("resolveThemeTokens", () => {
  it("usuário vence a org TOKEN A TOKEN (herdar o resto funciona)", () => {
    const out = resolveThemeTokens(
      { light: { background: "#111111" } },
      { light: { background: "#ffffff", foreground: "#222222" } }
    );
    expect(out.light).toEqual({
      background: "#111111",
      foreground: "#222222",
    });
  });

  it("sem ninguém definindo, fica vazio — o CSS do app é que manda", () => {
    expect(hasThemeTokens(resolveThemeTokens(null, null))).toBe(false);
  });

  it("um modo definido não arrasta o outro", () => {
    const out = resolveThemeTokens({ dark: { card: "#0a0a0a" } }, null);
    expect(out.light).toEqual({});
    expect(out.dark).toEqual({ card: "#0a0a0a" });
  });
});

describe("themeTokenStyle", () => {
  it("emite só variáveis de token válido, re-validando na saída", () => {
    // Entrada suja chegando por um caminho não tipado (cookie, jsonb do banco).
    const dirty = {
      background: "#ffffff",
      inventado: "#000000",
      foreground: "expression(alert(1))",
    } as unknown as Parameters<typeof themeTokenStyle>[0];
    const style = themeTokenStyle(dirty);
    expect(style).toEqual({ "--background": "#ffffff" });
  });

  it("mapa vazio ⇒ nenhum override (o <html> fica sem style)", () => {
    expect(themeTokenStyle({})).toEqual({});
  });
});

describe("normalizeOrgTheme", () => {
  it("tokens sozinhos já fazem a org ter padrão", () => {
    const out = normalizeOrgTheme({ tokens: { light: { card: "#eeeeee" } } });
    expect(out?.tokens?.light).toEqual({ card: "#eeeeee" });
    expect(out?.mode).toBeUndefined();
  });

  it("sem modo, sem accent e sem token ⇒ null (org sem padrão)", () => {
    expect(normalizeOrgTheme({ tokens: { light: { x: "#fff" } } })).toBeNull();
  });
});

describe("catálogo de tokens", () => {
  it("todo token tem rótulo pt-BR (o editor itera por THEME_TOKENS)", () => {
    for (const t of THEME_TOKENS) {
      expect(THEME_TOKEN_LABELS[t], `rótulo ausente para ${t}`).toBeTruthy();
    }
  });
});

describe("paleta da interface (v1.3)", () => {
  it("whitelist: só atual | nova", () => {
    expect(normalizeThemePalette("nova")).toBe("nova");
    expect(normalizeThemePalette("atual")).toBe("atual");
    for (const v of [null, undefined, "", "NOVA", "x\"><script>", 1, {}]) {
      expect(normalizeThemePalette(v)).toBeNull();
    }
  });

  it("precedência usuário ?? org ?? atual", () => {
    expect(resolveTheme(null, null).palette).toBe("atual");
    expect(resolveTheme(null, { palette: "nova" }).palette).toBe("nova");
    expect(resolveTheme({ palette: "atual" }, { palette: "nova" }).palette).toBe(
      "atual"
    );
    expect(resolveTheme({ palette: "lixo" }, { palette: "nova" }).palette).toBe(
      "nova"
    );
  });

  it("normalizeOrgTheme guarda só paleta válida", () => {
    expect(normalizeOrgTheme({ palette: "nova" })).toEqual({
      mode: undefined,
      accentColor: undefined,
      tokens: undefined,
      palette: "nova",
    });
    expect(normalizeOrgTheme({ palette: "roxa" })).toBeNull();
  });
});
