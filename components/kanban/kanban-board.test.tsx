// @vitest-environment jsdom
// Versão: 1.0 | Data: 26/07/2026
// Guarda de regressão: os campos extras do card (card.fields) aparecem no
// quadro TAMBÉM em modo `compact` (widget de dashboard) — o gate antigo os
// escondia justamente no único contexto com picker de extras (widget-builder).
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));
// Actions "use server" (puxam next/headers) e painéis pesados ficam fora do
// escopo do teste de renderização.
vi.mock("@/lib/kanban/actions", () => ({
  moveRecordCard: vi.fn(),
}));
vi.mock("@/lib/tasks/actions", () => ({
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
}));
vi.mock("@/components/feed/card-detail-sheet", () => ({
  CardDetailSheet: () => null,
}));
vi.mock("@/components/tarefas/task-sheet", () => ({
  TaskSheet: () => null,
}));

import { KanbanBoard } from "@/components/kanban/kanban-board";
import type { KanbanBoardData } from "@/lib/kanban/data";

const DATA: KanbanBoardData = {
  mode: "registros",
  columns: [
    {
      key: "novo",
      label: "Novo",
      count: 1,
      metricSum: null,
      cards: [
        {
          id: "r1",
          title: "Lead Acme",
          columnKey: "novo",
          groupKey: "novo",
          dateValue: null,
          colorValue: null,
          fields: [{ label: "MRR", value: "1.000" }],
          metricValue: null,
          isMock: false,
          openTasks: 0,
        },
      ],
    },
  ],
  metricLabel: null,
  metricIsMoney: false,
};

const RECORD_CTX = {
  fields: [],
  responsibles: [],
  operations: [],
  userRoles: ["admin"],
  canEditValues: false,
  canManageFields: false,
};

describe("KanbanBoard — campos extras do card", () => {
  it("exibe rótulo e valor SEM compact (página dedicada)", () => {
    render(
      <KanbanBoard
        data={DATA}
        settings={{ mode: "registros" }}
        canMove={false}
        recordCtx={RECORD_CTX}
      />
    );
    expect(screen.getByText("MRR")).toBeInTheDocument();
    expect(screen.getByText("1.000")).toBeInTheDocument();
  });

  it("exibe rótulo e valor COM compact (widget de dashboard)", () => {
    render(
      <KanbanBoard
        data={DATA}
        settings={{ mode: "registros" }}
        canMove={false}
        recordCtx={RECORD_CTX}
        compact
      />
    );
    expect(screen.getByText("MRR")).toBeInTheDocument();
    expect(screen.getByText("1.000")).toBeInTheDocument();
  });
});
