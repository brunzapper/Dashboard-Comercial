// @vitest-environment jsdom
// Versão: 1.0 | Data: 10/09/2026
// A seleção múltipla da lista de tarefas.
//
// O teste que mais importa é o PRIMEIRO: `TaskList` tem cinco consumidores, e
// só três ganharam seleção. Sem as props a lista tem de renderizar exatamente
// como antes — nenhuma caixa a mais, nenhum cabeçalho novo. Se essa garantia
// cair, duas telas que ninguém pediu mudam de comportamento.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskList } from "./task-list";
import type { TaskFormContext } from "./task-sheet";
import type { TaskRow } from "@/lib/tasks/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/tasks/actions", () => ({
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
}));

const ctx: TaskFormContext = {
  responsibles: [],
  canAssignOthers: false,
  canLock: false,
};

function task(id: string, over: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    title: `Tarefa ${id}`,
    description: null,
    record_id: null,
    board_id: null,
    phase: "a_fazer",
    due_date: null,
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
    series_key: null,
    series_occurrence: null,
    occurrence_noun: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...over,
  } as TaskRow;
}

describe("TaskList sem seleção — não-regressão", () => {
  it("não renderiza caixa de selecionar nem 'selecionar todas'", () => {
    render(<TaskList tasks={[task("a"), task("b")]} ctx={ctx} />);

    expect(screen.queryByLabelText("Selecionar tarefa")).toBeNull();
    expect(screen.queryByLabelText("Selecionar todas as tarefas")).toBeNull();
    // A caixa de CONCLUIR continua onde sempre esteve, uma por linha.
    expect(screen.getAllByLabelText("Concluir tarefa")).toHaveLength(2);
  });
});

describe("TaskList com seleção", () => {
  it("uma caixa de selecionar por linha, ao lado da de concluir", () => {
    render(
      <TaskList
        tasks={[task("a"), task("b")]}
        ctx={ctx}
        selection={{ selected: new Set(), onToggle: vi.fn() }}
        allState={false}
        onToggleAll={vi.fn()}
      />
    );
    // Duas caixas por linha, com rótulos DIFERENTES — é o que impede o
    // usuário de concluir quando queria selecionar.
    expect(screen.getAllByLabelText("Selecionar tarefa")).toHaveLength(2);
    expect(screen.getAllByLabelText("Concluir tarefa")).toHaveLength(2);
  });

  it("clicar na caixa avisa o dono da seleção", async () => {
    const onToggle = vi.fn();
    render(
      <TaskList
        tasks={[task("a")]}
        ctx={ctx}
        selection={{ selected: new Set(), onToggle }}
        allState={false}
        onToggleAll={vi.fn()}
      />
    );
    await userEvent.click(screen.getByLabelText("Selecionar tarefa"));
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("o cabeçalho diz quantas o 'todas' alcança", () => {
    render(
      <TaskList
        tasks={[task("a"), task("b"), task("c")]}
        ctx={ctx}
        selection={{ selected: new Set(["a"]), onToggle: vi.fn() }}
        allState="indeterminate"
        onToggleAll={vi.fn()}
      />
    );
    // O número é o da lista FILTRADA em tela — não o total do banco.
    expect(screen.getByText("Selecionar todas (3)")).toBeInTheDocument();
  });

  it("sem onToggleAll o cabeçalho não aparece", () => {
    render(
      <TaskList
        tasks={[task("a")]}
        ctx={ctx}
        selection={{ selected: new Set(), onToggle: vi.fn() }}
      />
    );
    expect(screen.queryByLabelText("Selecionar todas as tarefas")).toBeNull();
    expect(screen.getByLabelText("Selecionar tarefa")).toBeInTheDocument();
  });
});
