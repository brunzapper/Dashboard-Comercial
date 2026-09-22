// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DashboardPreview } from "./dashboard-preview";
import { PreviewQueueProvider } from "./preview-queue-context";
import { loadPreviewImage, loadPreviewMetadata, PreviewUnavailable } from "@/lib/dashboard-preview/load";
import { prepareInitialPreview } from "@/lib/dashboard-preview/bootstrap";

vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/lib/dashboard-preview/load", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/dashboard-preview/load")>(),
  loadPreviewImage: vi.fn(), loadPreviewMetadata: vi.fn(),
}));
vi.mock("@/lib/dashboard-preview/bootstrap", () => ({ prepareInitialPreview: vi.fn() }));
const meta = { version: "one", width: 560, height: 560, access_version: 1, format: "tabs-v2", revision: "unchanged" };
const metadata = { revision: "unchanged", accessVersion: 1, preview: meta };
function ui(preview: typeof meta | null = meta, scope = "user") {
  return <PreviewQueueProvider><DashboardPreview id="board" name="Vendas" scope={scope} preview={preview ?? undefined}/></PreviewQueueProvider>;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe() { this.cb([{ isIntersecting: true }] as IntersectionObserverEntry[], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  vi.mocked(loadPreviewImage).mockResolvedValue("data:image/webp;base64,old");
  vi.mocked(loadPreviewMetadata).mockResolvedValue(metadata);
  vi.mocked(prepareInitialPreview).mockResolvedValue({ image: "data:image/webp;base64,new", width: 560, height: 560, format: "tabs-v2" });
});
it("carrega a imagem salva sem edição, evento ou nova captura", async () => {
  const view = render(ui());
  await waitFor(() => expect(view.container.querySelector("img")?.src).toContain("old"));
  await waitFor(() => expect(loadPreviewMetadata).toHaveBeenCalled());
  expect(prepareInitialPreview).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(view.container.querySelector("a")?.style.aspectRatio).toBe("");
});
it("descobre imagem já publicada quando o RSC ainda não a informou", async () => {
  const view = render(ui(null));
  await waitFor(() => expect(view.container.querySelector("img")?.src).toContain("old"));
  expect(prepareInitialPreview).not.toHaveBeenCalled();
});
it.each(["user", "viewer", "other-org-user"])("prepara ausente automaticamente para %s sem mudança de revisão", async scope => {
  vi.mocked(loadPreviewMetadata).mockResolvedValue({ ...metadata, preview: null });
  vi.mocked(fetch).mockImplementation(async () => {
    vi.mocked(loadPreviewMetadata).mockResolvedValue(metadata);
    return { ok: true } as Response;
  });
  const view = render(ui(null, scope));
  await waitFor(() => expect(view.container.querySelector("img")).not.toBeNull());
  expect(prepareInitialPreview).toHaveBeenCalledOnce();
  expect(loadPreviewImage).toHaveBeenCalledWith(scope, "board", meta, expect.any(AbortSignal));
  expect(fetch).toHaveBeenCalledWith("/api/dashboard-previews/board", expect.objectContaining({
    method: "POST", body: expect.stringContaining('"revision":"unchanged"'),
  }));
});
it.each([
  { ...meta, width: 1440, height: 900 },
  { ...meta, format: "legacy" },
  { ...meta, revision: "older" },
  { ...meta, access_version: 0 },
])("mantém a antiga enquanto prepara o formato/revisão/epoch novo", async previous => {
  vi.mocked(loadPreviewMetadata).mockResolvedValue({ ...metadata, preview: previous });
  let release!: (value: { image: string; width: number; height: number; format: string }) => void;
  vi.mocked(prepareInitialPreview).mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const view = render(ui(previous));
  await waitFor(() => expect(prepareInitialPreview).toHaveBeenCalled());
  expect(view.container.querySelector("img")?.src).toContain("old");
  vi.mocked(loadPreviewMetadata).mockResolvedValue({ ...metadata, preview: { ...meta, version: "two" } });
  vi.mocked(loadPreviewImage).mockResolvedValue("data:image/webp;base64,new");
  await act(async () => release({ image: "data:image/webp;base64,new", width: 560, height: 560, format: "tabs-v2" }));
  await waitFor(() => expect(view.container.querySelector("img")?.src).toContain("new"));
});
it("trocar usuário não mostra a captura anterior enquanto a nova carrega", async () => {
  const view = render(ui());
  await waitFor(() => expect(view.container.querySelector("img")).not.toBeNull());
  vi.mocked(loadPreviewImage).mockImplementation(() => new Promise(() => {}));
  view.rerender(ui(meta, "other"));
  expect(view.container.querySelector("img")).toBeNull();
});
it("404 de metadados não prepara um dashboard sem acesso", async () => {
  vi.mocked(loadPreviewMetadata).mockRejectedValue(new PreviewUnavailable(404));
  const view = render(ui(null));
  await waitFor(() => expect(view.container.textContent).toContain("indisponível"));
  expect(prepareInitialPreview).not.toHaveBeenCalled();
});
it("objeto ausente é recuperado mesmo com metadado atual", async () => {
  vi.mocked(loadPreviewImage).mockRejectedValue(new PreviewUnavailable(404));
  vi.mocked(fetch).mockImplementation(async () => {
    vi.mocked(loadPreviewImage).mockResolvedValue("data:image/webp;base64,new");
    return { ok: true } as Response;
  });
  const view = render(ui());
  await waitFor(() => expect(view.container.querySelector("img")?.src).toContain("new"));
  expect(prepareInitialPreview).toHaveBeenCalledOnce();
});
it("retoma depois de offline sem exigir uma edição", async () => {
  vi.mocked(loadPreviewMetadata).mockRejectedValue(new TypeError("offline"));
  const view = render(ui(null));
  await waitFor(() => expect(view.container.textContent).toContain("novamente"));
  vi.mocked(loadPreviewMetadata).mockResolvedValue(metadata);
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(view.container.querySelector("img")).not.toBeNull());
});
it("cancelamento desmonta a preparação e impede publicação", async () => {
  vi.mocked(loadPreviewMetadata).mockResolvedValue({ ...metadata, preview: null });
  let signal!: AbortSignal;
  vi.mocked(prepareInitialPreview).mockImplementation((_host, _id, s) => new Promise((_resolve, reject) => {
    signal = s; s.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  const view = render(ui(null));
  await waitFor(() => expect(prepareInitialPreview).toHaveBeenCalled());
  view.unmount();
  expect(signal.aborted).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
it("trocar filtro na mesma página não paralisa a fila de imagens", async () => {
  const view = render(ui());
  const filter = document.createElement("a");
  filter.href = `${location.pathname}?aba=paineis`;
  filter.onclick = event => event.preventDefault();
  document.body.append(filter);
  act(() => filter.click());
  await waitFor(() => expect(view.container.querySelector("img")).not.toBeNull());
  filter.remove();
});
