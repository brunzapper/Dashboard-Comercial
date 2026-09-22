export const PREVIEW_SIZE = 560;

/** Square at the initial viewport's top left, never the full scrolling page. */
export function previewCrop(main: HTMLElement) {
  const rect = main.getBoundingClientRect();
  const width = main.clientWidth || rect.width;
  const height = Math.min(main.clientHeight || rect.height,
    main.ownerDocument.defaultView?.innerHeight || rect.height);
  const side = Math.min(width, height);
  return { width, side, top: rect.top, left: rect.left,
    bottom: rect.top + side, right: rect.left + side };
}

export function previewNeedsUpdate(meta: {
  revision: string; accessVersion: number;
  preview?: { revision: string; access_version: number; width: number; height: number } | null;
}) {
  const p = meta.preview;
  return !p || p.revision !== meta.revision || p.access_version !== meta.accessVersion ||
    p.width !== PREVIEW_SIZE || p.height !== PREVIEW_SIZE;
}
