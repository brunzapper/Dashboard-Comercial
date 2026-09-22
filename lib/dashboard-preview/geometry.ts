export const PREVIEW_SIZE = 560;
export const PREVIEW_FORMAT = "tabs-v2";

/** Version the capture recipe in the private filename without changing schema. */
export function previewFormat(objectPath: string) {
  return objectPath.split("/").pop()?.startsWith(`${PREVIEW_FORMAT}-`) ? PREVIEW_FORMAT : null;
}

/** Square at the initial viewport's top left, never the full scrolling page. */
export function previewCrop(main: HTMLElement) {
  const rect = main.getBoundingClientRect();
  const start = main.querySelector("[data-preview-start]") ?? main.querySelector("[data-preview-content]");
  const offsetY = Math.max(0, (start?.getBoundingClientRect().top ?? rect.top) - rect.top);
  const width = main.clientWidth || rect.width;
  const height = Math.min(main.clientHeight || rect.height,
    main.ownerDocument.defaultView?.innerHeight || rect.height);
  const side = Math.max(0, Math.min(width, height - offsetY));
  return { width, side, offsetY, top: rect.top + offsetY, left: rect.left,
    bottom: rect.top + offsetY + side, right: rect.left + side };
}

export function previewNeedsUpdate(meta: {
  revision: string; accessVersion: number;
  preview?: { revision: string; access_version: number; width: number; height: number; format?: string | null } | null;
}) {
  const p = meta.preview;
  return !p || p.revision !== meta.revision || p.access_version !== meta.accessVersion ||
    p.format !== PREVIEW_FORMAT ||
    p.width !== PREVIEW_SIZE || p.height !== PREVIEW_SIZE;
}
