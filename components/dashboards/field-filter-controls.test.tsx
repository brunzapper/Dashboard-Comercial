// @vitest-environment jsdom
// Versão: 1.0 | Data: 01/09/2026
// Testes do FieldFilterControls v1.6 (multi-seleção automática): campo com
// opções e operador "=" aceita várias marcações e emite `in` com ARRAY a
// partir da segunda; com uma marcação segue `eq` (o gravado antigo não muda
// de forma). Cobre também o round-trip do seed (um seed com `in` numa entrada
// "=" NÃO pode disparar navegação/persistência na montagem) e as formas que
// ficaram intocadas (Input de texto, checkbox de is_null).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FieldFilterEntry, FieldFilterOptions } from "@/lib/widgets/types";
import { parseViewFilter } from "@/lib/widgets/view-filters";

import { FieldFilterControls } from "./field-filter-controls";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/dashboards/d1",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("@/app/(app)/dashboards/actions", () => ({
  saveLastFieldFilter: vi.fn(async () => ({ ok: true })),
  saveSharedFieldFilter: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/components/snapshots/snapshot-mode", () => ({
  useSnapshotMode: () => ({ snapshot: false }),
}));
const runSpy = vi.fn((fn: () => void) => fn());
vi.mock("@/components/dashboards/pending-context", () => ({
  useNavPending: () => ({ pending: false, run: runSpy }),
}));

import { saveLastFieldFilter } from "@/app/(app)/dashboards/actions";

const saveMock = vi.mocked(saveLastFieldFilter);

const OPTIONS: FieldFilterOptions = {
  responsible_id: [
    { value: "r1", label: "Ana" },
    { value: "r2", label: "Bruno" },
  ],
};

function renderControls(opts?: {
  fields?: FieldFilterEntry[];
  options?: FieldFilterOptions;
  savedValue?: string;
}) {
  return render(
    <FieldFilterControls
      paramKey="ff_w1"
      fields={
        opts?.fields ?? [
          { field: "responsible_id", op: "eq", label: "Responsável" },
        ]
      }
      available={[]}
      options={opts?.options ?? OPTIONS}
      savedValue={opts?.savedValue}
      dashboardId="d1"
      widgetId="w1"
    />
  );
}

// Abre o popover do campo (o gatilho ALTERNA, então só abre se estiver
// fechado) e alterna as opções pelo rótulo.
function pick(...names: string[]) {
  if (screen.queryByRole("dialog") == null) {
    fireEvent.click(screen.getByRole("button", { name: /Responsável/ }));
  }
  for (const name of names) fireEvent.click(screen.getByText(name));
}

// Último valor que o componente mandou persistir, já decodificado.
function lastPersisted() {
  const call = saveMock.mock.calls.at(-1);
  return parseViewFilter((call?.[2] as string) ?? null);
}

beforeEach(() => {
  saveMock.mockClear();
  replaceMock.mockClear();
  runSpy.mockClear();
  window.history.replaceState(null, "", "/dashboards/d1");
});

describe("FieldFilterControls — multi-seleção automática no operador '='", () => {
  it("uma marcação segue emitindo eq com valor único", async () => {
    renderControls();
    pick("Ana");
    await waitFor(() => expect(saveMock).toHaveBeenCalled(), { timeout: 2000 });
    expect(lastPersisted().filters).toEqual([
      { field: "responsible_id", op: "eq", value: "r1" },
    ]);
  });

  it("duas marcações promovem o filtro para in com array", async () => {
    renderControls();
    pick("Ana", "Bruno");
    await waitFor(
      () =>
        expect(lastPersisted().filters).toEqual([
          { field: "responsible_id", op: "in", value: ["r1", "r2"] },
        ]),
      { timeout: 2000 }
    );
  });

  it("desmarcar até sobrar uma volta para eq", async () => {
    renderControls();
    pick("Ana", "Bruno");
    await waitFor(() => expect(saveMock).toHaveBeenCalled(), { timeout: 2000 });
    pick("Bruno"); // desmarca (popover segue aberto)
    await waitFor(
      () =>
        expect(lastPersisted().filters).toEqual([
          { field: "responsible_id", op: "eq", value: "r1" },
        ]),
      { timeout: 2000 }
    );
  });

  it("seed com in/array numa entrada '=' reidrata sem navegar nem persistir", async () => {
    const seed = encodeURIComponent(
      JSON.stringify({
        q: "",
        filters: [{ field: "responsible_id", op: "in", value: ["r1", "r2"] }],
      })
    );
    renderControls({ savedValue: seed });
    // O resumo do gatilho mostra a seleção do seed…
    expect(
      screen.getByRole("button", { name: /2 selecionados/ })
    ).toBeTruthy();
    // …e o round-trip é estável: nada de router.replace nem de persistência
    // (o servidor já renderizou com este mesmo valor).
    await new Promise((r) => setTimeout(r, 600));
    expect(runSpy).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe("FieldFilterControls — formas inalteradas", () => {
  it("campo sem opções continua com input de texto livre", async () => {
    renderControls({
      fields: [{ field: "title", op: "ilike", label: "Título" }],
      options: {},
    });
    const input = screen.getByLabelText("Título");
    fireEvent.change(input, { target: { value: "acme" } });
    await waitFor(
      () =>
        expect(lastPersisted().filters).toEqual([
          { field: "title", op: "ilike", value: "acme" },
        ]),
      { timeout: 2000 }
    );
  });

  it("operador sem valor continua no checkbox", async () => {
    renderControls({
      fields: [{ field: "responsible_id", op: "is_null", label: "Sem dono" }],
    });
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(
      () =>
        expect(lastPersisted().filters).toEqual([
          { field: "responsible_id", op: "is_null" },
        ]),
      { timeout: 2000 }
    );
  });
});
