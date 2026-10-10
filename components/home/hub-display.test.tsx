// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): lista densa (colunas, cores de aba saneadas, grupo
//   Fixados) e recorte por dono.
// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HubDisplayProvider, useHubDisplay, type HubDisplay } from "./hub-display-context";
import { HubLayoutControls } from "./hub-layout-controls";
import { BoardGrid, HubOwnerFilterChips, type DashboardRow } from "./hub-cards";
import type { UiPrefKey } from "@/lib/config/ui-prefs";

const { save, refresh, errorToast } = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn(), errorToast: vi.fn() }));
vi.mock("@/app/(app)/dashboards/actions", () => ({ saveUiPrefs: save }));
vi.mock("@/lib/use-debounced-refresh", () => ({ useDebouncedRefresh: () => refresh }));
vi.mock("sonner", () => ({ toast: { error: errorToast } }));
vi.mock("@/components/dashboards/board-card-menu", () => ({ BoardCardMenu: () => null }));
vi.mock("./pin-button", () => ({ PinButton: () => null }));
vi.mock("./dashboard-preview", () => ({ DashboardPreview: ({ name }: { name: string }) => <div>Prévia: {name}</div> }));

const initial: HubDisplay = { layout: "grid", sort: "created_desc", columns: 3, cardHeight: 0, showDescription: false, showAccess: true };
const keys = { layout: "hubLayout", sort: "hubSort", columns: "hubColumns", cardHeight: "hubCardHeight", showDescription: "hubShowDescription", showAccess: "hubShowAccess" } as const;
const rows: DashboardRow[] = [
  { id: "older", name: "Antigo", description: "Descrição antiga", created_at: "2026-01-01", owner_user_id: null, visible_to_roles: [], kind: "dashboard", status: "active", trashed_at: null, settings: null },
  { id: "newer", name: "Novo", description: "Descrição nova", created_at: "2026-02-01", owner_user_id: null, visible_to_roles: [], kind: "dashboard", status: "active", trashed_at: null, settings: null },
];
function Probe() {
  const { set, display } = useHubDisplay();
  return <><output data-testid="state">{JSON.stringify(display)}</output>
    <button onClick={() => set({ showDescription: !display.showDescription })}>Descrição</button>
    <button onClick={() => set({ columns: 4, layout: "list" })}>Patch misto</button></>;
}
function setup(locked: UiPrefKey[] = []) {
  return render(<HubDisplayProvider initial={initial} keys={keys} locked={locked}>
    <HubLayoutControls isAdmin /><Probe />
    <BoardGrid rows={rows} canCreate={false} isAdmin={false} pins={[]} />
  </HubDisplayProvider>);
}
beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue({ ok: true }); });
describe("exibição imediata dos cards", () => {
  it("aplica o quadrado ao card inteiro somente no modo prévia", () => {
    const { container } = setup();
    expect(container.querySelector("[data-hub-preview]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Prévia" }));
    const cards = container.querySelectorAll("[data-hub-preview]");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('[data-slot="card-header"]')).not.toBeNull();
    expect(cards[0].textContent).toContain("Prévia:");
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    expect(container.querySelector("[data-hub-preview]")).toBeNull();
  });
  it("clicar no texto da opção da engrenagem alterna a descrição", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Configurar exibição dos cards" }));
    fireEvent.click(screen.getByText("Exibir descrição"));
    expect(screen.getByText("Descrição nova")).toBeInTheDocument();
    await waitFor(() => expect(save).toHaveBeenCalledWith({ hubShowDescription: true }));
  });
  it("aplica lista, descrição e ordem antes do save e mantém após sucesso, sem refresh", async () => {
    let finish!: (value: { ok: boolean }) => void;
    save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    // v1.1 (10/10/2026): a lista de boards é a LINHA DENSA.
    expect(container.querySelector("[data-hub-dense]")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descrição" }));
    expect(screen.getByText("Descrição nova")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Ordenar cards" }), { target: { value: "created_asc" } });
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Antigo", "Novo"]);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await act(async () => finish({ ok: true }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Descrição nova")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("falha de um controle reverte só ele e preserva alterações posteriores", async () => {
    save.mockResolvedValueOnce({ ok: false, message: "Falha" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    fireEvent.click(screen.getByRole("button", { name: "Descrição" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cartão" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText("Descrição nova")).toBeInTheDocument();
    expect(errorToast).toHaveBeenCalled();
  });
  it("falha antiga não desfaz escolha nova no mesmo controle", async () => {
    save.mockResolvedValueOnce({ ok: false });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    fireEvent.click(screen.getByRole("button", { name: "Prévia" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Prévia" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Prévia: Novo")).toBeInTheDocument();
  });
  it("não aplica nem grava campo travado de patch misto", async () => {
    setup(["hubLayout"]);
    fireEvent.click(screen.getByRole("button", { name: "Patch misto" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ hubColumns: 4 }));
    expect(screen.getByTestId("state")).toHaveTextContent('"layout":"grid"');
  });
});

describe("lista densa (v1.1, 10/10/2026)", () => {
  const dense: DashboardRow[] = [
    { id: "a", name: "Comercial", description: null, owner_user_id: "me", owner_name: "Paula Costa",
      visible_to_roles: [], kind: "dashboard", status: "active", trashed_at: null, widget_count: 18,
      settings: { tabs: [{ id: "t1", color: "#ff0000" }, { id: "t2", color: "javascript:x" }, { id: "t3" }] } },
    { id: "b", name: "Metas", description: null, owner_user_id: "other", visible_to_roles: ["gestor"],
      kind: "dashboard", status: "active", trashed_at: null, widget_count: 1, settings: null },
  ];
  function setupDense(pins: string[] = []) {
    return render(<HubDisplayProvider initial={{ ...initial, layout: "list" }} keys={keys} locked={[]}>
      <HubOwnerFilterChips />
      <BoardGrid rows={dense} canCreate={false} isAdmin={false} pins={pins} userId="me" />
    </HubDisplayProvider>);
  }
  it("cada linha mostra abas, widgets, dono e só as cores hex das abas", () => {
    const { container } = setupDense();
    const first = container.querySelectorAll("[data-hub-row]")[0];
    expect(first.textContent).toContain("3 abas");
    expect(first.textContent).toContain("18 widgets");
    expect(first.textContent).toContain("PC");
    expect(first.querySelectorAll("i[style]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-hub-row]")[1].textContent).toContain("1 aba");
  });
  it("fixados vão para o grupo do topo", () => {
    setupDense(["b"]);
    expect(screen.getByText("Fixados")).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Metas", "Comercial"]);
  });
  it("recorte Meus / Compartilhados", () => {
    setupDense();
    fireEvent.click(screen.getByRole("button", { name: "Meus" }));
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Comercial"]);
    fireEvent.click(screen.getByRole("button", { name: "Compartilhados" }));
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Metas"]);
  });
});
