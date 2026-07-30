// Versão: 1.0 | Data: 30/07/2026
// Testes da fusão de referências ADICIONAIS do modo "Criar a partir de"
// (mescla multi-referência): prefixo rN_ nas keys (dedup contra a base e entre
// extras), remoção do settings.tab (aba de OUTRO board), união de bases e o
// formato das sections de prompt — o MESMO objeto renomeado alimenta
// refWidgets e a section (o que a IA vê é sempre resolvível pelo rewrite).
import { describe, expect, it } from "vitest";

import {
  fuseExtraReferences,
  MAX_EXTRA_REFS,
  type ExtraRefInput,
} from "@/lib/import/dashboard/multi-ref";
import type {
  DashboardImportJson,
  ImportWidgetSpec,
} from "@/lib/import/dashboard/types";

function refJson(
  bases: string[],
  widgets: Partial<ImportWidgetSpec>[]
): DashboardImportJson {
  return {
    formato: "dashboard-import",
    versao: 1,
    chave: "ref",
    bases,
    dashboard: { name: "Ref" },
    widgets: widgets as ImportWidgetSpec[],
  };
}

const BASE = { bases: ["negocios"], widgetKeys: ["w_funil", "w_card"] };

describe("fuseExtraReferences", () => {
  it("prefixa as keys por extra na ordem (r2_, r3_…)", () => {
    const extras: ExtraRefInput[] = [
      { name: "A", json: refJson([], [{ key: "w_x" }, { key: "w_y" }]) },
      { name: "B", json: refJson([], [{ key: "w_x" }]) },
    ];
    const out = fuseExtraReferences(BASE, extras);
    expect(out.refWidgets.map((w) => w.key)).toEqual([
      "r2_w_x",
      "r2_w_y",
      "r3_w_x",
    ]);
  });

  it("união de bases: base ∪ extras, dedup e ordenada; extra sem bases tolerada", () => {
    const extras: ExtraRefInput[] = [
      { name: "A", json: refJson(["leads", "negocios"], []) },
      { name: "B", json: { ...refJson([], []), bases: undefined } },
    ];
    const out = fuseExtraReferences(BASE, extras);
    expect(out.bases).toEqual(["leads", "negocios"]);
  });

  it("colisão com key real da base ganha sufixo _2 — refletido na section", () => {
    const base = { bases: [], widgetKeys: ["r2_w_x"] }; // key real "r2_w_x"
    const extras: ExtraRefInput[] = [
      { name: "A", json: refJson([], [{ key: "w_x" }]) },
    ];
    const out = fuseExtraReferences(base, extras);
    expect(out.refWidgets[0].key).toBe("r2_w_x_2");
    const body = JSON.parse(out.sections[0].body) as {
      widgets: ImportWidgetSpec[];
    };
    expect(body.widgets[0].key).toBe("r2_w_x_2");
  });

  it("settings.tab é removida (aba de outro board); demais settings e grid preservados", () => {
    const extras: ExtraRefInput[] = [
      {
        name: "A",
        json: refJson(
          [],
          [
            {
              key: "w_x",
              settings: { tab: "t9", cor: "azul" } as never,
              grid_position: { x: 1, y: 2, w: 3, h: 4 },
            },
            { key: "w_y", settings: { tab: "t9" } as never },
          ]
        ),
      },
    ];
    const out = fuseExtraReferences(BASE, extras);
    expect(out.refWidgets[0].settings).toEqual({ cor: "azul" });
    expect(out.refWidgets[0].grid_position).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    // Settings que só tinha a aba some inteiro (JSON compacto).
    expect("settings" in out.refWidgets[1]).toBe(false);
  });

  it("sections: título com N e nome do board; body = { dashboard, widgets prefixados }", () => {
    const extras: ExtraRefInput[] = [
      { name: "Comercial 2", json: refJson([], [{ key: "w_x" }]) },
      { name: "Leads", json: refJson([], []) },
    ];
    const out = fuseExtraReferences(BASE, extras);
    expect(out.sections.map((s) => s.title)).toEqual([
      'REFERÊNCIA ADICIONAL 2 — "Comercial 2" (JSON)',
      'REFERÊNCIA ADICIONAL 3 — "Leads" (JSON)',
    ]);
    const body = JSON.parse(out.sections[0].body);
    expect(body.dashboard).toBe("Comercial 2");
    expect(body.widgets[0].key).toBe("r2_w_x");
  });

  it("widget sem key (robustez) ganha key posicional prefixada", () => {
    const extras: ExtraRefInput[] = [
      { name: "A", json: refJson([], [{ title: "Sem key" }]) },
    ];
    const out = fuseExtraReferences(BASE, extras);
    expect(out.refWidgets[0].key).toBe("r2_w1");
  });

  it("cap exportado para UI/core", () => {
    expect(MAX_EXTRA_REFS).toBe(4);
  });
});
