// @vitest-environment jsdom
// Versão: 1.1 | Data: 04/09/2026
// Testes do FieldFilterControls v1.6 (multi-seleção automática): campo com
// opções e operador "=" aceita várias marcações e emite `in` com ARRAY a
// partir da segunda; com uma marcação segue `eq` (o gravado antigo não muda
// de forma). Cobre também o round-trip do seed (um seed com `in` numa entrada
// "=" NÃO pode disparar navegação/persistência na montagem) e as formas que
// ficaram intocadas (Input de texto, checkbox de is_null).
// v1.1 (04/09/2026): cobre a v1.7 — desmontar antes do debounce (troca de aba
// do dashboard) FLUSHA o que estava pendente, nos DOIS transportes (URL e
// célula compartilhada), e nada é gravado quando ninguém mexeu (o payload
// armado pelo próprio seed não é flushado).
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

import {
  saveLastFieldFilter,
  saveSharedFieldFilter,
} from "@/app/(app)/dashboards/actions";

const saveMock = vi.mocked(saveLastFieldFilter);
const sharedSaveMock = vi.mocked(saveSharedFieldFilter);

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
  shared?: boolean;
  widgetId?: string;
}) {
  return render(
    <FieldFilterControls
      paramKey={`ff_${opts?.widgetId ?? "w1"}`}
      shared={opts?.shared}
      fields={
        opts?.fields ?? [
          { field: "responsible_id", op: "eq", label: "Responsável" },
        ]
      }
      available={[]}
      options={opts?.options ?? OPTIONS}
      savedValue={opts?.savedValue}
      dashboardId="d1"
      widgetId={opts?.widgetId ?? "w1"}
    />
  );
}

// Abre o popover do campo (o gatilho ALTERNA, então só abre se estiver
// fechado) e alterna as opções pelo rótulo.
function pick(...names: string[]) {
  if (screen.queryByRole("dialog") == null) {
    fireEvent.click(screen.getByRole("button", { name: /Responsável/ }));
  }
  // Mira a checkbox da opção, não o texto: com a opção já selecionada, o
  // rótulo aparece TAMBÉM no resumo do gatilho.
  for (const name of names) {
    fireEvent.click(screen.getByRole("checkbox", { name }));
  }
}

// Último valor que o componente mandou persistir, já decodificado.
function lastPersisted() {
  const call = saveMock.mock.calls.at(-1);
  return parseViewFilter((call?.[2] as string) ?? null);
}

beforeEach(() => {
  saveMock.mockClear();
  sharedSaveMock.mockClear();
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

// Bug do dashboard: a troca de aba desmonta os widgets da aba anterior. Antes
// da v1.7, o cleanup do debounce (350ms) matava o timer e o filtro recém
// aplicado/limpo era descartado — no modo URL nem chegava à URL/preferência,
// no modo compartilhado nem ao banco.
describe("FieldFilterControls — troca de aba (desmonte)", () => {
  it("modo URL: desmontar antes do debounce ainda navega e persiste", () => {
    const view = renderControls();
    pick("Ana");
    expect(replaceMock).not.toHaveBeenCalled();
    view.unmount();
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(String(replaceMock.mock.calls[0][0])).toContain("ff_w1=");
    expect(saveMock).toHaveBeenCalledTimes(1);
    // No flush o overlay do board não é aceso (o card já morreu).
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("modo compartilhado: desmontar antes do debounce ainda grava a célula", () => {
    const view = renderControls({ shared: true, widgetId: "w2" });
    pick("Ana");
    expect(sharedSaveMock).not.toHaveBeenCalled();
    view.unmount();
    expect(sharedSaveMock).toHaveBeenCalledTimes(1);
    expect(sharedSaveMock.mock.calls[0][0]).toBe("d1");
    expect(sharedSaveMock.mock.calls[0][1]).toBe("w2");
    expect(parseViewFilter(sharedSaveMock.mock.calls[0][2] as string).filters)
      .toEqual([{ field: "responsible_id", op: "eq", value: "r1" }]);
  });

  it("desmontar sem interação não grava nem navega", () => {
    renderControls({ widgetId: "w3" }).unmount();
    expect(saveMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("desfazer a mudança antes do debounce cancela o pendente", () => {
    const view = renderControls({ widgetId: "w4" });
    pick("Ana");
    pick("Ana"); // desmarca: volta ao valor já aplicado
    view.unmount();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("compartilhado: remontar antes do eco mantém o otimista e não re-grava", () => {
    const view = renderControls({ shared: true, widgetId: "w5" });
    pick("Ana");
    view.unmount();
    expect(sharedSaveMock).toHaveBeenCalledTimes(1);
    // Volta à aba com o savedValue ANTIGO (o refresh ainda não aterrissou).
    renderControls({ shared: true, widgetId: "w5" });
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
    expect(sharedSaveMock).toHaveBeenCalledTimes(1);
  });
});
