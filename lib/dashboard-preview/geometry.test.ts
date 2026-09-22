// @vitest-environment jsdom
import { expect, it } from "vitest";
import { previewCrop, previewNeedsUpdate, previewFormat, PREVIEW_FORMAT } from "./geometry";

it.each(["data-preview-start", "data-preview-content"])("inicia em %s, sem título/voltar", marker => {
  const main = document.createElement("main");
  main.innerHTML = `<header>Título e voltar</header><div ${marker}>Abas/conteúdo</div>`;
  Object.defineProperties(main, { clientWidth: { value: 1440 }, clientHeight: { value: 6000 } });
  main.getBoundingClientRect = () => ({ top: 0, left: 0 }) as DOMRect;
  main.lastElementChild!.getBoundingClientRect = () => ({ top: 160 }) as DOMRect;
  expect(previewCrop(main)).toMatchObject({ offsetY: 160, top: 160, side: window.innerHeight - 160 });
});

it("renova capturas quadradas antigas, mas não recaptura o formato atual", () => {
  const meta = { revision: "same", accessVersion: 1,
    preview: { revision: "same", access_version: 1, width: 560, height: 560 } };
  expect(previewNeedsUpdate(meta)).toBe(true);
  expect(previewNeedsUpdate({ ...meta, preview: { ...meta.preview, format: PREVIEW_FORMAT } })).toBe(false);
  expect(previewFormat("org/user/board/tabs-v2-uuid.webp")).toBe(PREVIEW_FORMAT);
  expect(previewFormat("org/user/board/uuid.webp")).toBeNull();
});
