import { cacheImage, imageKey, readLocalImage } from "./store";

export interface PreviewImage {
  version: string; width: number; height: number; access_version: number; format?: string | null;
}
export interface PreviewMetadata {
  revision: string; accessVersion: number;
  preview: (PreviewImage & { revision: string }) | null;
}

export class PreviewUnavailable extends Error {
  constructor(public status: number) { super("Prévia indisponível"); }
}

export async function loadPreviewMetadata(id: string, signal: AbortSignal): Promise<PreviewMetadata> {
  const response = await fetch(`/api/dashboard-previews/${id}?metadata`, {
    signal, cache: "no-store", priority: "low",
  });
  if (!response.ok) throw new PreviewUnavailable(response.status);
  return response.json();
}

/** A broken/evicted IndexedDB entry must never prevent a network read. */
export async function loadPreviewImage(scope: string, id: string, meta: PreviewImage, signal: AbortSignal) {
  const key = imageKey(scope, id, meta.version);
  const decode = async (image: string) => {
    const decoded = new Image(); decoded.src = image; await decoded.decode();
    signal.throwIfAborted();
    return image;
  };
  try {
    const local = await readLocalImage(key);
    if (local) return await decode(local.image);
  } catch { signal.throwIfAborted(); }
  const response = await fetch(`/api/dashboard-previews/${id}?v=${meta.version}`, { signal, priority: "low" });
  if (!response.ok) throw new PreviewUnavailable(response.status);
  const blob = await response.blob();
  const image = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string); reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  await decode(image);
  await cacheImage(key, image);
  return image;
}
