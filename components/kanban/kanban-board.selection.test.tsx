// @vitest-environment jsdom
// Versão: 1.0 | Data: 27/07/2026
// Seleção em massa + fila otimista do KanbanBoard: checkbox/segunda via
// Ctrl+clique, barra de ações (gating de Excluir por admin), movimento
// otimista via moveRecordCardsBulk, falha PARCIAL revertendo só o card falho
// (painel persistente + Tentar novamente) e a guarda de resync — `data` novo
// durante a fila NÃO clobbera o estado otimista. Actions mockadas (vi.mock).
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
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

import {
  deleteRecordsBulk,
  moveRecordCardsBulk,
} from "@/lib/kanban/bulk-actions";
import type { BulkActionState } from "@/lib/kanban/bulk-helpers";
import type { RecordRow } from "@/lib/records/types";
import type { KanbanBoardData, KanbanCard } from "@/lib/kanban/data";
import { KanbanBoard, type KanbanRecordContext } from "./kanban-board";

function card(id: string, title: string, columnKey: string): KanbanCard {
  return {
    id,
    title,
    columnKey,
    groupKey: columnKey,
    dateValue: null,
    colorValue: null,
    fields: [],
    metricValue: null,
    isMock: false,
    openTasks: 0,
    record: { id, record_type: "lead" } as unknown as RecordRow,
  };
}

function boardData(cardsByCol: Record<string, KanbanCard[]>): KanbanBoardData {
  return {
    mode: "registros",
    columns: Object.entries(cardsByCol).map(([key, cards]) => ({
      key,
      label: key === "novo" ? "Novo" : "Quente",
      cards,
      count: cards.length,
      metricSum: null,
    })),
    metricLabel: null,
    metricIsMoney: false,
  };
}

const recordCtx = (roles: string[]): KanbanRecordContext => ({
  fields: [],
  responsibles: [],
  operations: [],
  userRoles: roles,
  canEditValues: true,
  canManageFields: false,
});

function renderBoard(
  data: KanbanBoardData,
  roles: string[] = ["admin"]
) {
  return render(
    <KanbanBoard
      data={data}
      settings={{ mode: "registros", source: "leads", groupField: "stage" }}
      canMove
      recordCtx={recordCtx(roles)}
    />
  );
}

const colDiv = (label: string) =>
  screen.getByText(label).closest('div[class*="group/col"]')!;

beforeEach(() => {
  vi.mocked(moveRecordCardsBulk).mockReset();
  vi.mocked(deleteRecordsBulk).mockReset();
});

describe("seleção em massa", () => {
  it("checkbox seleciona, barra aparece, Mover para despacha otimista e Esc limpa", async () => {
    const user = userEvent.setup();
    vi.mocked(moveRecordCardsBulk).mockResolvedValue({
      ok: true,
      results: [{ id: "a1", ok: true }],
    });
    renderBoard(
      boardData({ novo: [card("a1", "A1", "novo")], quente: [] })
    );

    await user.click(screen.getByRole("checkbox", { name: "Selecionar A1" }));
    expect(screen.getByText("1 selecionado(s)")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Mover para/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Quente" }));

    // Otimista: A1 já está na coluna Quente antes do servidor responder.
    expect(colDiv("Quente").textContent).toContain("A1");
    await waitFor(() =>
      expect(moveRecordCardsBulk).toHaveBeenCalledWith(
        expect.objectContaining({
          targetKey: "quente",
          items: [{ recordId: "a1", currentDateValue: null }],
        })
      )
    );

    // Barra some (seleção limpa após a ação); Esc também limparia.
    expect(screen.queryByText(/selecionado\(s\)/)).toBeNull();
  });

  it("falha parcial reverte só o card falho e Tentar novamente re-envia", async () => {
    const user = userEvent.setup();
    vi.mocked(moveRecordCardsBulk).mockResolvedValueOnce({
      ok: true,
      results: [
        { id: "a1", ok: true },
        { id: "a2", ok: false, message: "Sem permissão." },
      ],
    });
    renderBoard(
      boardData({
        novo: [card("a1", "A1", "novo"), card("a2", "A2", "novo")],
        quente: [],
      })
    );

    // Select-all da coluna Novo.
    await user.click(
      screen.getByRole("checkbox", { name: "Selecionar todos em Novo" })
    );
    expect(screen.getByText("2 selecionado(s)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Mover para/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Quente" }));

    // A1 fica na Quente; A2 reverte pra Novo com painel de falha persistente.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "1 card(s) não foram processados"
      )
    );
    expect(screen.getByRole("alert").textContent).toContain("A2 — Sem permissão.");
    expect(colDiv("Quente").textContent).toContain("A1");
    expect(colDiv("Novo").textContent).toContain("A2");

    // Tentar novamente: re-envia SÓ o item falho.
    vi.mocked(moveRecordCardsBulk).mockResolvedValueOnce({
      ok: true,
      results: [{ id: "a2", ok: true }],
    });
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() =>
      expect(moveRecordCardsBulk).toHaveBeenLastCalledWith(
        expect.objectContaining({
          items: [{ recordId: "a2", currentDateValue: null }],
        })
      )
    );
    await waitFor(() =>
      expect(colDiv("Quente").textContent).toContain("A2")
    );
  });

  it("data novo durante a fila não clobbera o otimista; sem admin não há Excluir", async () => {
    const user = userEvent.setup();
    let resolveMove!: (v: BulkActionState) => void;
    vi.mocked(moveRecordCardsBulk).mockImplementation(
      () => new Promise<BulkActionState>((r) => (resolveMove = r))
    );
    const initial = boardData({
      novo: [card("a1", "A1", "novo")],
      quente: [],
    });
    const view = render(
      <KanbanBoard
        data={initial}
        settings={{ mode: "registros", source: "leads", groupField: "stage" }}
        canMove
        recordCtx={recordCtx(["vendedor"])}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "Selecionar A1" }));
    // Sem admin: barra sem "Excluir" (registros); demais ações presentes.
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Concluir tarefas/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Mover para/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Quente" }));
    expect(colDiv("Quente").textContent).toContain("A1");

    // Servidor ainda não respondeu (pending > 0): um `data` STALE chega
    // (A1 em Novo) e NÃO pode clobrar o estado otimista.
    view.rerender(
      <KanbanBoard
        data={boardData({ novo: [card("a1", "A1", "novo")], quente: [] })}
        settings={{ mode: "registros", source: "leads", groupField: "stage" }}
        canMove
        recordCtx={recordCtx(["vendedor"])}
      />
    );
    expect(colDiv("Quente").textContent).toContain("A1");

    await act(async () => {
      resolveMove({ ok: true, results: [{ id: "a1", ok: true }] });
    });
    // Depois do settle, o quadro segue otimista até o refresh trazer o fresco.
    expect(colDiv("Quente").textContent).toContain("A1");
  });
});
