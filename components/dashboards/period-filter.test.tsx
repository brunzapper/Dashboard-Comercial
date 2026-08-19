// @vitest-environment jsdom
// Versão: 1.0 | Data: 19/08/2026
// Regressão da barra de período com escopo POR ABA: trocar de aba REMONTA os
// controles (o `key` por bucket reidrata o estado interno), mas não pode
// DUPLICÁ-los. Guarda contra chaves iguais entre irmãos — o React documenta
// que filhos com a mesma key podem ser duplicados ou omitidos, e o sintoma é
// exatamente botões de período acumulando a cada transição de aba.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AvailableField } from "@/lib/widgets/fields";
import type { DashboardSettings } from "@/lib/widgets/types";

import { PeriodFilter } from "./period-filter";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboards/d1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/dashboards/actions", () => ({
  saveLastPeriod: vi.fn(async () => {}),
  syncGlobalPeriodQuickFilters: vi.fn(async () => {}),
  updateDashboardSettings: vi.fn(async () => {}),
}));
vi.mock("@/components/dashboards/pending-context", () => ({
  useNavPending: () => ({ pending: false, run: (fn: () => void) => fn() }),
}));
vi.mock("@/components/sources-context", () => ({
  useSources: () => [],
}));
vi.mock("@/components/source-labels-context", () => ({
  useSourceLabels: () => ({}),
}));
vi.mock("@/components/source-folders-context", () => ({
  useSourceFolders: () => [],
}));

const AVAILABLE: AvailableField[] = [
  { field: "closed_at", label: "Fechamento", isNumeric: false, isDate: true },
];

const SETTINGS = {
  periodBar: { scope: "tab", defaultPreset: "este_mes" },
  tabs: [
    { id: "t1", name: "Aba 1" },
    { id: "t2", name: "Aba 2" },
  ],
} as DashboardSettings;

function renderBar(activeTabId: string) {
  return (
    <PeriodFilter
      available={AVAILABLE}
      canEdit
      dashboardId="d1"
      settings={SETTINGS}
      periodBar={SETTINGS.periodBar}
      periodScope="tab"
      activeTabId={activeTabId}
      firstTabId="t1"
      hasTabs
    />
  );
}

describe("PeriodFilter — troca de aba", () => {
  it("não acumula controles ao transitar entre as abas", () => {
    const { rerender } = render(renderBar("t1"));
    expect(screen.getAllByLabelText("Período")).toHaveLength(1);

    for (const tab of ["t2", "t1", "t2", "t1"]) {
      rerender(renderBar(tab));
      expect(screen.getAllByLabelText("Período")).toHaveLength(1);
      expect(screen.getAllByLabelText("Campo de data")).toHaveLength(1);
      expect(
        screen.getAllByLabelText("Configurar barra de período")
      ).toHaveLength(1);
    }
  });
});
