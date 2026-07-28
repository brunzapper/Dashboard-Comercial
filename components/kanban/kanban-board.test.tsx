// @vitest-environment jsdom
// Versão: 1.2 | Data: 28/07/2026
// Guarda de regressão: os campos extras do card (card.fields) aparecem no
// quadro TAMBÉM em modo `compact` (widget de dashboard) — o gate antigo os
// escondia justamente no único contexto com picker de extras (widget-builder).
// v1.2 (28/07/2026): métricas expandidas — badges data-driven (card.badges),
//   fallback do pill legado de tarefas abertas em card SEM badges, value null
//   oculto e formato "d" (dias) no cabeçalho da coluna.
// v1.1 (27/07/2026): o card exibe SÓ o valor do campo extra — o rótulo sai do
//   corpo (vira title/hover) e o teste passa a exigir a ausência dele.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));
// Actions "use server" (puxam next/headers) e painéis pesados ficam fora do
// escopo do teste de renderização.
vi.mock("@/lib/kanban/bulk-actions", () => ({
  moveRecordCardsBulk: vi.fn(),
  createTasksBulk: vi.fn(),
  completeTasksBulk: vi.fn(),
  deleteRecordsBulk: vi.fn(),
  deleteTasksBulk: vi.fn(),
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

describe("KanbanBoard — badges de métricas do card", () => {
  const withCard = (
    card: Partial<KanbanBoardData["columns"][0]["cards"][0]>,
    board: Partial<KanbanBoardData> = {},
    column: Partial<KanbanBoardData["columns"][0]> = {}
  ): KanbanBoardData => ({
    ...DATA,
    ...board,
    columns: [
      {
        ...DATA.columns[0],
        ...column,
        cards: [{ ...DATA.columns[0].cards[0], ...card }],
      },
    ],
  });

  it("card SEM badges mantém o pill legado de tarefas abertas", () => {
    render(
      <KanbanBoard
        data={withCard({ openTasks: 2 })}
        settings={{ mode: "registros" }}
        canMove={false}
        recordCtx={RECORD_CTX}
      />
    );
    expect(screen.getByText("2 tarefa(s)")).toBeInTheDocument();
  });

  it("badges configurados renderizam (atrasadas/vinculados/idade) e value null fica oculto", () => {
    render(
      <KanbanBoard
        data={withCard({
          badges: [
            {
              key: "tasks:overdue",
              label: "Tarefas atrasadas",
              kind: "tasks",
              value: 3,
            },
            {
              key: "linked:leads",
              label: "Leads vinculados",
              kind: "linked",
              value: 2,
            },
            { key: "age", label: "Idade (dias)", kind: "age", value: 12 },
            {
              key: "tasks:open",
              label: "Tarefas abertas",
              kind: "tasks",
              value: null, // fato indisponível → oculto
            },
          ],
        })}
        settings={{ mode: "registros" }}
        canMove={false}
        recordCtx={RECORD_CTX}
      />
    );
    expect(screen.getByText("3 atrasada(s)")).toBeInTheDocument();
    expect(screen.getByText("2 Leads vinculados")).toBeInTheDocument();
    expect(screen.getByText("12 d")).toBeInTheDocument();
    expect(screen.queryByText(/tarefa\(s\)/)).toBeNull();
  });

  it("cabeçalho da coluna formata a métrica em dias (metricFormat 'days')", () => {
    render(
      <KanbanBoard
        data={withCard(
          { badges: [] },
          {
            metricLabel: "Idade (dias)",
            metricIsMoney: false,
            metricAgg: "avg",
            metricFormat: "days",
          },
          { metricSum: 7.5 }
        )}
        settings={{ mode: "registros" }}
        canMove={false}
        recordCtx={RECORD_CTX}
      />
    );
    expect(screen.getByText("7,5 d")).toBeInTheDocument();
  });
});

describe("KanbanBoard — campos extras do card", () => {
  it("exibe SÓ o valor (rótulo no title) SEM compact (página dedicada)", () => {
    render(
      <KanbanBoard
        data={DATA}
        settings={{ mode: "registros" }}
        canMove={false}
        recordCtx={RECORD_CTX}
      />
    );
    const value = screen.getByText("1.000");
    expect(value).toBeInTheDocument();
    expect(value).toHaveAttribute("title", "MRR");
    expect(screen.queryByText("MRR")).toBeNull();
  });

  it("exibe SÓ o valor (rótulo no title) COM compact (widget de dashboard)", () => {
    render(
      <KanbanBoard
        data={DATA}
        settings={{ mode: "registros" }}
        canMove={false}
        recordCtx={RECORD_CTX}
        compact
      />
    );
    const value = screen.getByText("1.000");
    expect(value).toBeInTheDocument();
    expect(value).toHaveAttribute("title", "MRR");
    expect(screen.queryByText("MRR")).toBeNull();
  });
});
