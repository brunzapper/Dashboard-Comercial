// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { loadPreviewImage } from "./load";
import { readLocalImage, cacheImage } from "./store";
vi.mock("./store", () => ({ imageKey: () => "key", readLocalImage: vi.fn(), cacheImage: vi.fn() }));
const meta = { version: "one", width: 560, height: 560, access_version: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("Image", class { src = ""; async decode() { if (this.src === "broken") throw new Error("decode"); } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["webp"], { type: "image/webp" }) }));
});
it.each(["absent", "broken", "unavailable"])("busca imagem pronta quando cache está %s", async state => {
  if (state === "broken") vi.mocked(readLocalImage).mockResolvedValue({ key: "key", image: "broken", at: 0 });
  if (state === "unavailable") vi.mocked(readLocalImage).mockRejectedValue(new Error("quota"));
  const image = await loadPreviewImage("viewer", "board", meta, new AbortController().signal);
  expect(image).toMatch(/^data:image\/webp;base64,/);
  expect(fetch).toHaveBeenCalledOnce();
  expect(cacheImage).toHaveBeenCalledWith("key", image);
});
it("reutiliza cache válido sem rede", async () => {
  vi.mocked(readLocalImage).mockResolvedValue({ key: "key", image: "valid", at: 0 });
  expect(await loadPreviewImage("user", "board", meta, new AbortController().signal)).toBe("valid");
  expect(fetch).not.toHaveBeenCalled();
});
