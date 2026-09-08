// @vitest-environment jsdom
// Versão: 1.0 | Data: 07/08/2026
// Seleção em massa + duplo clique da tabela de Registros (v2.2): checkbox por
// linha e select-all do header, Esc limpa, gating da barra (Excluir só com
// canDeleteRecords; coluna de seleção some sem permissão nenhuma), dblclick
// no corpo da linha abre o painel içado e dblclick em controle interativo
// NÃO abre. Actions "use server" e painéis pesados mockados (vi.mock) —
// mesmo desenho do kanban-board.selection.test.tsx.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/records/actions", () => ({
  updateRecord: vi.fn(),
  updateRecordField: vi.fn(),
  searchRecords: vi.fn(async () => []),
  searchLeads: vi.fn(async () => []),
}));
vi.mock("@/lib/records/trash-actions", () => ({
  trashRecordsBulk: vi.fn(),
  restoreRecordsBulk: vi.fn(),
  purgeRecordsPermanently: vi.fn(),
}));
vi.mock("@/app/(app)/registros/ai-update-actions", () => ({
  loadRecordsUpdateTargets: vi.fn(async () => ({ ok: true, fields: [] })),
  generateRecordsUpdateWithAi: vi.fn(),
  previewRecordsUpdateJson: vi.fn(),
  buildRecordsUpdatePrompt: vi.fn(),
  applyRecordsUpdate: vi.fn(),
  generateRecordsSelectionUpdateWithAi: vi.fn(),
  previewRecordsSelectionUpdateJson: vi.fn(),
  buildRecordsSelectionUpdatePrompt: vi.fn(),
  applyRecordsSelectionUpdate: vi.fn(),
}));
vi.mock("@/components/tarefas/record-tasks-section", () => ({
  RecordTasksSection: () => null,
}));
vi.mock("@/components/registros/record-match-connect", () => ({
  RecordMatchConnect: () => null,
}));

import type { RecordRow } from "@/lib/records/types";
import { trashRecordsBulk } from "@/lib/records/trash-actions";
import { RecordsTable } from "./records-table";

function rec(id: string, title: string): RecordRow {
  return {
    id,
    record_type: "lead",
    source_system: "bitrix",
    title,
    custom_fields: {},
    is_mock: false,
  } as unknown as RecordRow;
}

function renderTable(
  overrides: Partial<React.ComponentProps<typeof RecordsTable>> = {}
) {
  return render(
    <RecordsTable
      source="leads"
      sourceLabel="Leads"
      records={[rec("a1", "Alpha"), rec("b2", "Beta"), rec("c3", "Gama")]}
      fields={[]}
      coreColumns={[]}
      orphanColumns={[]}
      coreDefs={[]}
      detailFields={[]}
      offBaseDefs={[]}
      knownFieldKeys={[]}
      sort={null}
      responsibles={[]}
      operations={[]}
      relatedLeadLabels={{}}
      userRoles={["admin"]}
      canEditValues
      canManageFields={false}
      canDeleteRecords
      ai={null}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.mocked(trashRecordsBulk).mockReset();
});

describe("seleção em massa em /registros", () => {
  it("checkbox seleciona, barra aparece com contagem e Esc limpa", async () => {
    const user = userEvent.setup();
    renderTable();
    expect(screen.queryByRole("toolbar")).toBeNull();

    const boxes = screen.getAllByRole("checkbox", {
      name: "Selecionar registro",
    });
    expect(boxes).toHaveLength(3);
    await user.click(boxes[0]);
    await user.click(boxes[2]);

    const bar = screen.getByRole("toolbar", { name: "Ações em massa" });
    expect(bar.textContent).toContain("2 selecionado(s)");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("select-all do header marca a página inteira e desmarca", async () => {
    const user = userEvent.setup();
    renderTable();
    const all = screen.getByRole("checkbox", {
      name: "Selecionar todos da página",
    });
    await user.click(all);
    expect(
      screen.getByRole("toolbar", { name: "Ações em massa" }).textContent
    ).toContain("3 selecionado(s)");
    await user.click(all);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("gating: sem canDeleteRecords não há Excluir; sem permissão nenhuma não há coluna de seleção", async () => {
    const user = userEvent.setup();
    const first = renderTable({ canDeleteRecords: false });
    await user.click(
      screen.getAllByRole("checkbox", { name: "Selecionar registro" })[0]
    );
    expect(screen.getByRole("toolbar", { name: "Ações em massa" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Editar campos/ })
    ).toBeTruthy();
    first.unmount();

    renderTable({ canDeleteRecords: false, canEditValues: false });
    expect(
      screen.queryAllByRole("checkbox", { name: "Selecionar registro" })
    ).toHaveLength(0);
  });

  it("Excluir confirma e despacha trashRecordsBulk com os ids", async () => {
    const user = userEvent.setup();
    vi.mocked(trashRecordsBulk).mockResolvedValue({
      ok: true,
      results: [{ id: "a1", ok: true }],
    });
    renderTable();
    await user.click(
      screen.getAllByRole("checkbox", { name: "Selecionar registro" })[0]
    );
    await user.click(screen.getByRole("button", { name: /Excluir/ }));
    // AlertDialog: copy fala em Lixeira/30 dias, confirmação despacha.
    expect(screen.getByText(/Lixeira/)).toBeTruthy();
    const dialogButtons = screen.getAllByRole("button", { name: "Excluir" });
    await user.click(dialogButtons[dialogButtons.length - 1]);
    expect(trashRecordsBulk).toHaveBeenCalledWith(["a1"]);
  });
});

describe("duplo clique abre o registro", () => {
  it("dblclick no corpo da linha abre o painel içado (título no Sheet)", () => {
    renderTable();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.doubleClick(screen.getByText("Beta"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Beta");
  });

  it("dblclick em controle interativo (checkbox) NÃO abre o painel", () => {
    renderTable();
    fireEvent.doubleClick(
      screen.getAllByRole("checkbox", { name: "Selecionar registro" })[0]
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("o lápis também abre o mesmo painel içado", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(
      screen.getAllByRole("button", { name: "Editar registro" })[0]
    );
    expect(screen.getByRole("dialog").textContent).toContain("Alpha");
  });
});
