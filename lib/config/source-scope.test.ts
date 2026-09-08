// Versão: 1.0 | Data: 19/08/2026
// Bases REFERENCIADAS por um board (collectBoardSourceKeys) — o conjunto que o
// escopo de Bases (⋮ → Bases) nunca pode remover do catálogo efetivo. Cobre o
// caminho fácil de esquecer: o campo de data por Base da barra de período,
// inclusive nos overrides por aba (periodBar.byTab).
import { describe, expect, it } from "vitest";

import { collectBoardSourceKeys } from "@/lib/config/source-scope";
import type { DashboardSettings } from "@/lib/widgets/types";

describe("collectBoardSourceKeys — campo de data por Base", () => {
  it("inclui as Bases do fieldBySource global da barra", () => {
    const settings = {
      periodBar: { fieldBySource: { negocio: "closed_at" } },
    } as unknown as DashboardSettings;
    expect([...collectBoardSourceKeys([], settings)]).toContain("negocio");
  });

  it("inclui Base usada SÓ no override de uma aba (byTab)", () => {
    const settings = {
      periodBar: {
        scope: "tab",
        fieldBySource: { negocio: "closed_at" },
        byTab: { t2: { fieldBySource: { lead: "source_created_at" } } },
      },
      tabs: [
        { id: "t1", name: "A" },
        { id: "t2", name: "B" },
      ],
    } as unknown as DashboardSettings;
    const keys = [...collectBoardSourceKeys([], settings)];
    expect(keys).toContain("negocio");
    expect(keys).toContain("lead");
  });
});
