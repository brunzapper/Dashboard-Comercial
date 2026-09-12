// Versão: 1.0 | Data: 12/09/2026
// Guarda do motor de preferências de INTERFACE (0141): precedência das três
// camadas, semântica da TRAVA (org vence, mas não apaga o override), parse
// fail-safe por chave e a promoção da chave legada `sidebarPinned`.
import { describe, expect, it } from "vitest";

import {
  MAX_HUB_COLUMNS,
  MAX_SIDEBAR_PINS,
  UI_PREF_DEFAULTS,
  UI_PREF_KEYS,
  UI_PREF_LABELS,
  clampColumns,
  normalizeOrgUiPrefs,
  normalizeSidebarPins,
  normalizeUiPrefs,
  resolveUiPrefs,
  toggleSidebarPin,
} from "./ui-prefs";

describe("normalizeUiPrefs", () => {
  it("lixo em qualquer forma ⇒ objeto vazio (nunca derruba o app)", () => {
    for (const v of [null, undefined, "x", 1, []]) {
      expect(normalizeUiPrefs(v)).toEqual({});
    }
  });

  it("chave inválida some sem levar as válidas junto", () => {
    const out = normalizeUiPrefs({
      hubLayout: "carrossel",
      hubShowAccess: "sim",
      hubColumns: 4,
      outraCoisa: true,
    });
    expect(out).toEqual({ hubColumns: 4 });
  });

  it("colunas são clampadas ao intervalo aceito", () => {
    expect(clampColumns(0)).toBe(1);
    expect(clampColumns(99)).toBe(MAX_HUB_COLUMNS);
    expect(clampColumns(2.4)).toBe(2);
    expect(clampColumns(Number.NaN)).toBeUndefined();
    expect(clampColumns("3")).toBeUndefined();
  });

  it("promove o sidebarPinned legado da raiz quando o bloco novo não decide", () => {
    expect(normalizeUiPrefs({}, { sidebarPinned: true }).sidebarPinned).toBe(
      true
    );
  });

  it("o bloco novo VENCE o legado (primeiro save da UI nova manda)", () => {
    expect(
      normalizeUiPrefs({ sidebarPinned: false }, { sidebarPinned: true })
        .sidebarPinned
    ).toBe(false);
  });
});

describe("normalizeOrgUiPrefs", () => {
  it("{} ⇒ sem padrão, sem trava, sem descrição", () => {
    const out = normalizeOrgUiPrefs({});
    expect(out.values).toEqual({});
    expect(out.locked.size).toBe(0);
    expect(out.operacaoDescriptions).toEqual({});
  });

  it("trava só aceita chave do catálogo", () => {
    const out = normalizeOrgUiPrefs({
      locked: ["hubColumns", "inventada", 7],
    });
    expect([...out.locked]).toEqual(["hubColumns"]);
  });

  it("descrição vazia/não-texto é descartada; o resto é aparado", () => {
    const out = normalizeOrgUiPrefs({
      operacaoDescriptions: { agenda: "  Meu texto  ", tarefas: "", x: 3 },
    });
    expect(out.operacaoDescriptions).toEqual({ agenda: "Meu texto" });
  });
});

describe("resolveUiPrefs", () => {
  it("sem org e sem usuário ⇒ padrões do app", () => {
    expect(resolveUiPrefs(null, null).values).toEqual(UI_PREF_DEFAULTS);
  });

  it("descrição nasce DESLIGADA nas duas famílias", () => {
    const { values } = resolveUiPrefs(null, null);
    expect(values.hubShowDescription).toBe(false);
    expect(values.operacaoShowDescription).toBe(false);
  });

  it("usuário vence a org em chave LIVRE", () => {
    const org = normalizeOrgUiPrefs({ values: { hubColumns: 2 } });
    expect(resolveUiPrefs({ hubColumns: 5 }, org).values.hubColumns).toBe(5);
  });

  it("org vence o usuário em chave TRAVADA, e a trava é reversível", () => {
    const locked = normalizeOrgUiPrefs({
      values: { hubColumns: 2 },
      locked: ["hubColumns"],
    });
    expect(resolveUiPrefs({ hubColumns: 5 }, locked).values.hubColumns).toBe(2);
    expect(resolveUiPrefs({ hubColumns: 5 }, locked).locked.has("hubColumns")).toBe(
      true
    );
    // Destravar (mesmo override do usuário guardado) devolve a escolha pessoal.
    const free = normalizeOrgUiPrefs({ values: { hubColumns: 2 } });
    expect(resolveUiPrefs({ hubColumns: 5 }, free).values.hubColumns).toBe(5);
  });

  it("chave travada SEM valor na org cai no padrão do app, não no do usuário", () => {
    const org = normalizeOrgUiPrefs({ locked: ["hubLayout"] });
    expect(resolveUiPrefs({ hubLayout: "list" }, org).values.hubLayout).toBe(
      UI_PREF_DEFAULTS.hubLayout
    );
  });

  it("`false` do usuário não é confundido com ausência", () => {
    const org = normalizeOrgUiPrefs({ values: { hubShowAccess: true } });
    expect(resolveUiPrefs({ hubShowAccess: false }, org).values.hubShowAccess).toBe(
      false
    );
  });
});

describe("catálogo de chaves", () => {
  it("toda chave tem rótulo pt-BR (a UI de trava itera por UI_PREF_KEYS)", () => {
    for (const k of UI_PREF_KEYS) {
      expect(UI_PREF_LABELS[k], `rótulo ausente para ${k}`).toBeTruthy();
    }
  });
});

describe("itens fixados na barra lateral", () => {
  it("descarta item inválido, dedupe e respeita o teto", () => {
    const many = Array.from({ length: MAX_SIDEBAR_PINS + 5 }, (_, i) => ({
      kind: "dashboard",
      id: `d${i}`,
    }));
    expect(normalizeSidebarPins(many)).toHaveLength(MAX_SIDEBAR_PINS);
    expect(
      normalizeSidebarPins([
        { kind: "dashboard", id: "a" },
        { kind: "dashboard", id: "a" },
        { kind: "inventado", id: "b" },
        { kind: "kanban", id: "" },
        null,
        { kind: "operacao", id: "agenda" },
      ])
    ).toEqual([
      { kind: "dashboard", id: "a" },
      { kind: "operacao", id: "agenda" },
    ]);
  });

  it("o mesmo id em famílias diferentes são itens distintos", () => {
    const pins = normalizeSidebarPins([
      { kind: "dashboard", id: "x" },
      { kind: "kanban", id: "x" },
    ]);
    expect(pins).toHaveLength(2);
  });

  it("toggle fixa e desfixa", () => {
    const pin = { kind: "dashboard", id: "a" } as const;
    const on = toggleSidebarPin([], pin);
    expect(on).toEqual([pin]);
    expect(toggleSidebarPin(on, pin)).toEqual([]);
  });
});
