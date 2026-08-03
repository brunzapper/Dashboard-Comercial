// @vitest-environment jsdom
// Versão: 1.0 | Data: 03/08/2026
// TargetTabChecklist (listas "Aplicar a" dos filtros): headers por aba com
// check-all tri-state (true/false/mixed via aria-checked), bulk-toggle da aba
// (onBulk com os ids do grupo e a direção certa), toggle individual e o modo
// plano (dashboard sem abas = sem headers).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Widget } from "@/lib/widgets/types";
import { TargetTabChecklist } from "./target-tab-checklist";

const w = (id: string, title: string, tab?: string) =>
  ({ id, title, settings: tab ? { tab } : {} }) as unknown as Widget;

const tabs = [
  { id: "t1", name: "Vendas" },
  { id: "t2", name: "Marketing" },
];
const targets = [w("a", "KPI A", "t1"), w("b", "KPI B", "t1"), w("c", "KPI C", "t2")];

function setup(excluded: string[]) {
  const onToggle = vi.fn();
  const onBulk = vi.fn();
  render(
    <TargetTabChecklist
      targets={targets}
      tabs={tabs}
      excluded={excluded}
      onToggle={onToggle}
      onBulk={onBulk}
    />
  );
  return { onToggle, onBulk };
}

const tabCheckbox = (name: string) =>
  screen.getByRole("checkbox", {
    name: `Aplicar a todos os widgets da aba ${name}`,
  });

describe("TargetTabChecklist", () => {
  it("renderiza headers por aba e os widgets do grupo", () => {
    setup([]);
    expect(screen.getByText("Vendas")).toBeTruthy();
    expect(screen.getByText("Marketing")).toBeTruthy();
    for (const t of ["KPI A", "KPI B", "KPI C"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });

  it("tri-state do header: todos marcados / todos excluídos / misto", () => {
    setup(["b"]);
    // t1: a incluído + b excluído → mixed; t2: c incluído → true.
    expect(tabCheckbox("Vendas").getAttribute("aria-checked")).toBe("mixed");
    expect(tabCheckbox("Marketing").getAttribute("aria-checked")).toBe("true");
  });

  it("todos excluídos → aria-checked false", () => {
    setup(["a", "b"]);
    expect(tabCheckbox("Vendas").getAttribute("aria-checked")).toBe("false");
  });

  it("clique no header com todos marcados exclui a aba inteira", async () => {
    const { onBulk } = setup([]);
    await userEvent.click(tabCheckbox("Vendas"));
    expect(onBulk).toHaveBeenCalledWith(["a", "b"], true);
  });

  it("clique no header em estado misto ou vazio inclui a aba inteira", async () => {
    const { onBulk } = setup(["b"]);
    await userEvent.click(tabCheckbox("Vendas"));
    expect(onBulk).toHaveBeenCalledWith(["a", "b"], false);
  });

  it("clique individual chama onToggle com o id", async () => {
    const { onToggle, onBulk } = setup([]);
    await userEvent.click(
      screen.getByText("KPI C").querySelector("[role=checkbox]") as Element
    );
    expect(onToggle).toHaveBeenCalledWith("c");
    expect(onBulk).not.toHaveBeenCalled();
  });

  it("sem abas: lista plana, nenhum checkbox de grupo", () => {
    render(
      <TargetTabChecklist
        targets={targets}
        tabs={[]}
        excluded={[]}
        onToggle={() => {}}
        onBulk={() => {}}
      />
    );
    expect(
      screen.queryByRole("checkbox", { name: /Aplicar a todos os widgets/ })
    ).toBeNull();
    // 3 checkboxes individuais, sem headers de aba.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByText("Vendas")).toBeNull();
  });
});
