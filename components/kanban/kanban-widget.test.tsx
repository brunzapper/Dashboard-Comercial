// @vitest-environment jsdom
// Versão: 1.1 | Data: 08/09/2026
// v1.1 (08/09/2026): o tick do event bus passou a ser 100% SILENCIOSO (nem dim
// nem rótulo) — ele também chega do realtime a cada rodada do sync do Bitrix,
// e o rótulo piscava sozinho para quem só apresentava o dashboard.
// Wrapper do widget kanban: dim (opacity-60) E rótulo "Atualizando…" só
// acompanham refetch por mudança de ESCOPO/CONFIG (scopeKey/cfgKey); o tick do
// event bus re-busca em silêncio, com o quadro antigo em tela.
// Board/list estubados; runKanbanWidget mockado.
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/dashboards/kanban-actions", () => ({
  runKanbanWidget: vi.fn(),
}));
vi.mock("@/app/(app)/dashboards/actions", () => ({
  saveWidgetSettings: vi.fn(),
}));
vi.mock("@/lib/tasks/actions", () => ({
  moveTaskPhase: vi.fn(),
}));
vi.mock("./kanban-board", () => ({
  KanbanBoard: () => <div data-testid="board" />,
}));
vi.mock("./kanban-list", () => ({
  KanbanList: () => null,
}));
vi.mock("./column-config-popover", () => ({
  ColumnConfigPopover: () => null,
}));
vi.mock("./automations-sheet", () => ({
  AutomationsSheet: () => null,
}));
vi.mock("@/components/registros/record-create-sheet", () => ({
  RecordCreateSheet: () => null,
}));
vi.mock("@/components/tarefas/task-sheet", () => ({
  TaskSheet: () => null,
}));

import {
  runKanbanWidget,
  type KanbanWidgetResult,
} from "@/app/(app)/dashboards/kanban-actions";
import { BUS_REFETCH_DELAY_MS } from "@/lib/feedback/use-refetch-origin";
import { emitDataChanged } from "@/lib/tasks/events";
import type { Widget } from "@/lib/widgets/types";
import { KanbanWidget } from "./kanban-widget";

const okResult: KanbanWidgetResult = {
  data: {
    mode: "registros",
    columns: [],
    metricLabel: null,
    metricIsMoney: false,
  },
  kanban: { mode: "registros", source: "leads", groupField: "stage" },
  fields: [],
  responsibles: [],
  operations: [],
  quickCreateSource: null,
};

const widget = {
  id: "w1",
  title: "Kanban",
  settings: { kanban: { mode: "registros", source: "leads", groupField: "stage" } },
} as unknown as Widget;

function renderWidget(scopeKey: string) {
  return render(
    <KanbanWidget
      widget={widget}
      dashboardId="d1"
      userRoles={["admin"]}
      canEditValues
      canManageFields={false}
      scopeKey={scopeKey}
    />
  );
}

// Wrapper do dim = pai direto do board estubado.
const dimWrapper = () => screen.getByTestId("board").parentElement!;

beforeEach(() => {
  vi.mocked(runKanbanWidget).mockReset();
});

describe("KanbanWidget — dim × Atualizando…", () => {
  it("tick do bus re-busca em SILÊNCIO (sem dim e sem rótulo)", async () => {
    vi.mocked(runKanbanWidget).mockResolvedValueOnce(okResult);
    renderWidget("s1");
    await waitFor(() => expect(screen.getByTestId("board")).toBeTruthy());
    expect(runKanbanWidget).toHaveBeenCalledTimes(1);

    // Próximo fetch fica pendente p/ observar o estado "re-buscando".
    let resolveFetch!: (v: KanbanWidgetResult) => void;
    vi.mocked(runKanbanWidget).mockImplementationOnce(
      () => new Promise<KanbanWidgetResult>((r) => (resolveFetch = r))
    );
    act(() => {
      emitDataChanged({ kind: "record" });
    });

    // A re-busca acontece (o dado chega), mas o usuário não vê nada mexer.
    await waitFor(() => expect(runKanbanWidget).toHaveBeenCalledTimes(2), {
      timeout: BUS_REFETCH_DELAY_MS + 1000,
    });
    expect(screen.queryByText("Atualizando…")).toBeNull();
    expect(dimWrapper().className).not.toContain("opacity-60");

    await act(async () => {
      resolveFetch(okResult);
    });
    expect(screen.queryByText("Atualizando…")).toBeNull();
    expect(dimWrapper().className).not.toContain("opacity-60");
    expect(screen.getByTestId("board")).toBeTruthy();
  });

  it("mudança de scopeKey re-busca COM dim até o resultado aterrissar", async () => {
    vi.mocked(runKanbanWidget).mockResolvedValueOnce(okResult);
    const view = renderWidget("s1");
    await waitFor(() => expect(screen.getByTestId("board")).toBeTruthy());

    let resolveFetch!: (v: KanbanWidgetResult) => void;
    vi.mocked(runKanbanWidget).mockImplementationOnce(
      () => new Promise<KanbanWidgetResult>((r) => (resolveFetch = r))
    );
    view.rerender(
      <KanbanWidget
        widget={widget}
        dashboardId="d1"
        userRoles={["admin"]}
        canEditValues
        canManageFields={false}
        scopeKey="s2"
      />
    );

    await waitFor(() => expect(screen.getByText("Atualizando…")).toBeTruthy());
    expect(dimWrapper().className).toContain("opacity-60");

    await act(async () => {
      resolveFetch(okResult);
    });
    expect(screen.queryByText("Atualizando…")).toBeNull();
    expect(dimWrapper().className).not.toContain("opacity-60");
  });
});
