// @vitest-environment jsdom
// Versão: 1.0 | Data: 12/08/2026
// Campos ocultáveis do form de criação (v1.2): "x" oculta e persiste por base
// (localStorage), "Campos ocultos (N)" reativa, o Nome obrigatório nunca ganha
// "x", campo oculto com prefill submete via <input type="hidden"> (kanban) e
// ref órfã no storage não aparece. Action "use server" mockada (vi.mock).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/records/actions", () => ({
  createRecord: vi.fn(async () => ({})),
}));
vi.mock("@/lib/tasks/events", () => ({
  emitDataChanged: vi.fn(),
}));

import type { FieldDefinition } from "@/lib/records/types";
import { RecordCreateSheet } from "./record-create-sheet";

const STORAGE_KEY = "registros:hiddenCreateFields:vendas";

const ORIGEM: FieldDefinition = {
  id: "f1",
  field_key: "origem",
  label: "Origem",
  data_type: "texto",
  options: [],
  visible_to_roles: ["admin"],
  editable_by_roles: ["admin"],
  is_local: true,
  sort_order: 1,
} as unknown as FieldDefinition;

function renderSheet(
  overrides: Partial<React.ComponentProps<typeof RecordCreateSheet>> = {}
) {
  return render(
    <RecordCreateSheet
      source={{ key: "vendas", label: "Vendas" }}
      fields={[ORIGEM]}
      responsibles={[]}
      operations={[]}
      userRoles={["admin"]}
      {...overrides}
    />
  );
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Novo registro" }));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("campos ocultáveis do RecordCreateSheet", () => {
  it("'x' oculta o campo e grava a preferência por base", async () => {
    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);

    expect(screen.getByText("Canal")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Ocultar campo Canal" })
    );
    expect(screen.queryByText("Canal")).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")
    ).toEqual(["core__channel"]);
  });

  it("'Campos ocultos (N)' lista e reativa por toggle", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["core__channel", "custom__origem"])
    );
    renderSheet();
    await openSheet(user);

    await user.click(
      screen.getByRole("button", { name: "Campos ocultos (2)" })
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Reexibir campo Canal" })
    );
    expect(screen.getByText("Canal")).toBeTruthy();
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")
    ).toEqual(["custom__origem"]);
    expect(
      screen.getByRole("button", { name: "Campos ocultos (1)" })
    ).toBeTruthy();
  });

  it("o Nome (obrigatório) nunca ganha 'x'", async () => {
    const user = userEvent.setup();
    renderSheet();
    await openSheet(user);
    expect(screen.getByText("Nome *")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Ocultar campo Nome" })
    ).toBeNull();
  });

  it("campo oculto com prefill submete via input hidden (kanban)", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["core__stage"]));
    renderSheet({ defaultValues: { core__stage: "Fechado" } });
    await openSheet(user);

    expect(screen.queryByText("Etapa")).toBeNull();
    const input = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="core__stage"]'
    );
    expect(input?.value).toBe("Fechado");
  });

  it("ref órfã no storage não aparece na lista de reativação", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["custom__nao_existe", "core__mrr"])
    );
    renderSheet();
    await openSheet(user);

    // Só o MRR conta — a ref órfã não entra na contagem nem vira toggle.
    await user.click(
      screen.getByRole("button", { name: "Campos ocultos (1)" })
    );
    expect(
      screen.getByRole("checkbox", { name: "Reexibir campo MRR" })
    ).toBeTruthy();
    expect(screen.queryByText("custom__nao_existe")).toBeNull();
  });
});
