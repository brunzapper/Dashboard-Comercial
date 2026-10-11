// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): tipografia dos cartões da Tree — parse fail-closed,
//   precedência cartão > widget POR PROPRIEDADE e o `style` emitido.
import { describe, expect, it } from "vitest";
import { parseNodeDisplay } from "./display";
import {
  normalizeTreeTextSize,
  parseTreeTypography,
  resolveTreeTypography,
  treeTextStyle,
} from "./typography";

describe("parseTreeTypography", () => {
  it("mantém papel/fonte/tamanho válidos e descarta o resto", () => {
    expect(
      parseTreeTypography({
        title: { font: "inter", size: 18 },
        value: { size: "14,5" },
        header: { font: "comic", size: 200 },
        inventado: { size: 12 },
      })
    ).toEqual({ title: { font: "inter", size: 18 }, value: { size: 14.5 } });
    expect(parseTreeTypography({})).toBeNull();
    expect(parseTreeTypography("x")).toBeNull();
  });

  it("limites de tamanho", () => {
    expect(normalizeTreeTextSize(5)).toBeNull();
    expect(normalizeTreeTextSize(6)).toBe(6);
    expect(normalizeTreeTextSize(72)).toBe(72);
    expect(normalizeTreeTextSize(73)).toBeNull();
    expect(normalizeTreeTextSize(12.3)).toBe(12.5);
  });

  it("o display do cartão carrega a tipografia", () => {
    expect(parseNodeDisplay({ typography: { title: { size: 20 } } })).toEqual({
      typography: { title: { size: 20 } },
    });
    expect(parseNodeDisplay({ typography: { title: { size: 1 } } })).toBeNull();
  });
});

describe("resolveTreeTypography", () => {
  it("o cartão vence o widget por propriedade", () => {
    const w = { title: { font: "newsreader" as const, size: 14 }, value: { size: 12 } };
    const n = { title: { size: 22 } };
    expect(resolveTreeTypography(w, n)).toEqual({
      title: { font: "newsreader", size: 22 },
      value: { size: 12 },
    });
  });

  it("nada configurado = nada emitido (render de sempre)", () => {
    expect(resolveTreeTypography(null, undefined)).toEqual({});
    expect(treeTextStyle({}, "title")).toBeUndefined();
  });

  it("style com família do catálogo e px", () => {
    const st = treeTextStyle({ value: { font: "inter", size: 16 } }, "value");
    expect(st?.fontSize).toBe("16px");
    expect(String(st?.fontFamily)).toContain("Inter");
  });
});
