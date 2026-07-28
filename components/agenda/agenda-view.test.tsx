// @vitest-environment jsdom
// Versão: 1.0 | Data: 28/07/2026
// Guarda de regressão do redesign da agenda: grade com célula fixa e nº do dia
// no cabeçalho, ordem cronológica intra-dia (sortDayItems), rótulo
// "HH:MM–HH:MM" da hora final, drag & drop otimista (mime próprio; registro
// não arrasta; falha reverte), "+" de criação rápida e post-it da anotação.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));
// Actions "use server" (puxam next/headers) e painéis pesados ficam fora do
// escopo do teste de renderização.
vi.mock("@/lib/tasks/actions", () => ({
  completeTask: vi.fn(async () => ({ ok: true })),
  reopenTask: vi.fn(async () => ({ ok: true })),
  rescheduleTask: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/agenda/notes-actions", () => ({
  createAgendaNote: vi.fn(async () => ({ ok: true, id: "n-new" })),
  updateAgendaNote: vi.fn(async () => ({ ok: true })),
  moveAgendaNote: vi.fn(async () => ({ ok: true })),
  deleteAgendaNote: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/components/feed/card-detail-sheet", () => ({
  CardDetailSheet: ({ open, target }: { open: boolean; target: unknown }) =>
    open && target ? <div data-testid="detail-open" /> : null,
}));
vi.mock("@/components/tarefas/task-sheet", () => ({
  TaskForm: () => <div data-testid="task-form" />,
}));
vi.mock("@/components/dashboards/appearance-editing", () => ({
  BodyPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import {
  AGENDA_DND_TYPE,
  AgendaView,
} from "@/components/agenda/agenda-view";
import { rescheduleTask } from "@/lib/tasks/actions";
import { moveAgendaNote } from "@/lib/agenda/notes-actions";
import type { AgendaData } from "@/lib/agenda/types";
import type { TaskRow } from "@/lib/tasks/types";
import type { RecordRow } from "@/lib/records/types";

const rescheduleTaskMock = vi.mocked(rescheduleTask);
const moveAgendaNoteMock = vi.mocked(moveAgendaNote);

function mkTask(partial: Partial<TaskRow> & { id: string }): TaskRow {
  return {
    title: partial.id,
    description: null,
    record_id: null,
    board_id: null,
    phase: "a_fazer",
    due_date: "2026-07-15",
    due_time: null,
    due_time_end: null,
    completed_at: null,
    completed_by: null,
    responsible_id: null,
    created_by: null,
    position: 0,
    locked: false,
    parent_task_id: null,
    pinned: false,
    feed_position: 0,
    is_global: false,
    assigned_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...partial,
  } as TaskRow;
}

const DATA: AgendaData = {
  from: "2026-06-29",
  to: "2026-08-02",
  items: [
    {
      id: "r1",
      kind: "record",
      date: "2026-07-15",
      time: null,
      title: "Lead Acme",
      record: { id: "r1", title: "Lead Acme" } as unknown as RecordRow,
    },
    {
      id: "t2",
      kind: "task",
      date: "2026-07-15",
      time: "14:00",
      title: "Reunião",
      task: mkTask({
        id: "t2",
        title: "Reunião",
        due_time: "14:00:00",
        due_time_end: "15:30:00",
      }),
    },
    {
      id: "t1",
      kind: "task",
      date: "2026-07-15",
      time: "09:00",
      title: "Ligar",
      task: mkTask({ id: "t1", title: "Ligar", due_time: "09:00:00" }),
    },
    {
      id: "n1",
      kind: "note",
      date: "2026-07-15",
      time: null,
      title: "Treinamento da equipe",
      note: {
        id: "n1",
        note_date: "2026-07-15",
        body: "Treinamento da equipe",
        color: "verde",
        created_by: null,
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-10T00:00:00Z",
      },
    },
  ],
};

const RECORD_CTX = {
  fields: [],
  responsibles: [],
  operations: [],
  userRoles: ["admin"],
  canEditValues: false,
  canManageFields: false,
};
const TASK_CTX = { responsibles: [], canAssignOthers: true, canLock: true };

function renderView(onChanged = vi.fn()) {
  const utils = render(
    <AgendaView
      anchor="2026-07-15"
      view="month"
      data={DATA}
      recordCtx={RECORD_CTX}
      taskCtx={TASK_CTX}
      onNavigate={() => {}}
      onViewChange={() => {}}
      onChanged={onChanged}
    />
  );
  return { ...utils, onChanged };
}

function cellOf(container: HTMLElement, day: string): HTMLElement {
  const cell = container.querySelector(`[data-day="${day}"]`);
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
}

function makeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    setData: vi.fn((type: string, v: string) => {
      store[type] = v;
    }),
    getData: vi.fn((type: string) => store[type] ?? ""),
    get types() {
      return Object.keys(store);
    },
    effectAllowed: "",
    dropEffect: "",
  };
}

describe("AgendaView — grade redesenhada", () => {
  it("renderiza 7 cabeçalhos e as células do mês (julho/2026 = 35 dias)", () => {
    const { container } = renderView();
    for (const d of ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]) {
      expect(screen.getByText(d)).toBeInTheDocument();
    }
    expect(container.querySelectorAll("[data-day]")).toHaveLength(35);
  });

  it("ordena o dia cronologicamente: com hora primeiro, depois nota → registro", () => {
    const { container } = renderView();
    const text = cellOf(container, "2026-07-15").textContent ?? "";
    const order = [
      text.indexOf("Ligar"),
      text.indexOf("Reunião"),
      text.indexOf("Treinamento da equipe"),
      text.indexOf("Lead Acme"),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('exibe "14:00–15:30" quando a tarefa tem hora final', () => {
    renderView();
    expect(screen.getByText(/14:00–15:30/)).toBeInTheDocument();
  });

  it("tarefa/anotação arrastam; registro não", () => {
    const { container } = renderView();
    const cell = cellOf(container, "2026-07-15");
    expect(
      within(cell).getByText("Ligar").closest("[draggable]")
    ).toHaveAttribute("draggable", "true");
    expect(
      within(cell)
        .getByText("Treinamento da equipe")
        .closest("[draggable]")
    ).toHaveAttribute("draggable", "true");
    expect(
      within(cell).getByText("Lead Acme").closest("[draggable]")
    ).toHaveAttribute("draggable", "false");
  });

  it("dragstart grava o payload no mime próprio da agenda", () => {
    const { container } = renderView();
    const chip = within(cellOf(container, "2026-07-15"))
      .getByText("Ligar")
      .closest("[draggable]") as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith(
      AGENDA_DND_TYPE,
      JSON.stringify({ kind: "task", id: "t1", fromDate: "2026-07-15" })
    );
  });

  it("drop em outro dia chama rescheduleTask e move o chip otimisticamente", async () => {
    const { container, onChanged } = renderView();
    const chip = within(cellOf(container, "2026-07-15"))
      .getByText("Ligar")
      .closest("[draggable]") as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    const target = cellOf(container, "2026-07-30");
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    // Otimista: o chip já está no dia destino antes da action resolver.
    expect(within(target).getByText("Ligar")).toBeInTheDocument();
    await waitFor(() =>
      expect(rescheduleTaskMock).toHaveBeenCalledWith("t1", "2026-07-30")
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("falha no move reverte o chip e exibe a mensagem", async () => {
    rescheduleTaskMock.mockResolvedValueOnce({
      ok: false,
      message: "Sem permissão para mover esta tarefa.",
    });
    const { container } = renderView();
    const from = cellOf(container, "2026-07-15");
    const chip = within(from)
      .getByText("Ligar")
      .closest("[draggable]") as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    const target = cellOf(container, "2026-07-30");
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    await waitFor(() =>
      expect(
        screen.getByText("Sem permissão para mover esta tarefa.")
      ).toBeInTheDocument()
    );
    expect(within(from).getByText("Ligar")).toBeInTheDocument();
    expect(within(target).queryByText("Ligar")).toBeNull();
  });

  it('anotação move via moveAgendaNote no drop', async () => {
    const { container } = renderView();
    const chip = within(cellOf(container, "2026-07-15"))
      .getByText("Treinamento da equipe")
      .closest("[draggable]") as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(chip, { dataTransfer: dt });
    const target = cellOf(container, "2026-07-16");
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
    await waitFor(() =>
      expect(moveAgendaNoteMock).toHaveBeenCalledWith("n1", "2026-07-16")
    );
  });

  it('"+" do dia abre o popover de criação rápida com "Nova tarefa"', async () => {
    renderView();
    const trigger = screen.getByLabelText("Adicionar em 15/07");
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByText("Nova tarefa")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByText("Nova tarefa"));
    await waitFor(() =>
      expect(screen.getByTestId("task-form")).toBeInTheDocument()
    );
    // Vencimento pré-preenchido com o dia clicado.
    expect(screen.getByText(/15\/07\/2026/)).toBeInTheDocument();
  });

  it("clique no chip da tarefa abre o painel de detalhe (Feed/Dados)", async () => {
    const { container } = renderView();
    fireEvent.click(within(cellOf(container, "2026-07-15")).getByText("Ligar"));
    await waitFor(() =>
      expect(screen.getByTestId("detail-open")).toBeInTheDocument()
    );
  });

  it("clique na anotação abre o post-it com o texto completo", async () => {
    const { container } = renderView();
    fireEvent.click(
      within(cellOf(container, "2026-07-15")).getByText(
        "Treinamento da equipe"
      )
    );
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    );
    expect(
      within(screen.getByRole("dialog")).getByText("Treinamento da equipe")
    ).toBeInTheDocument();
  });
});
