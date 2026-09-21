import type { PreviewUpload } from "./validation";
export interface PendingPreview extends PreviewUpload { key: string; id: string; scope: string; at: number }
interface LocalImage { key: string; image: string; at: number }
let database: Promise<IDBDatabase | null> | undefined;
async function open() {
  return database ??= new Promise<IDBDatabase | null>(resolve => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    const request = indexedDB.open("workspace-preview-images-v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("images", { keyPath: "key" });
      request.result.createObjectStore("pending", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
}
async function read<T>(store: string, key?: string): Promise<T | undefined> {
  try {
    const db = await open(); if (!db) return;
    return await new Promise(resolve => {
      const objects = db.transaction(store).objectStore(store);
      const request = key === undefined ? objects.getAll() : objects.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  } catch { return; }
}
async function write(store: string, value: LocalImage | PendingPreview | string) {
  try {
    const db = await open(); if (!db) return;
    await new Promise<void>(resolve => {
      const tx = db.transaction(store, "readwrite"), objects = tx.objectStore(store);
      if (typeof value === "string") objects.delete(value); else objects.put(value);
      const all = objects.getAll();
      all.onsuccess = () => {
        let bytes = 0;
        for (const item of (all.result as LocalImage[]).sort((a,b) => b.at-a.at)) {
          bytes += item.image.length * 2;
          if (bytes > 8 * 1024 * 1024) objects.delete(item.key);
        }
      };
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    });
  } catch { /* Falha do cache não afeta o uso normal. */ }
}
export const imageKey = (scope: string, id: string, version: string) => JSON.stringify([scope,id,version]);
export const readLocalImage = (key: string) => read<LocalImage>("images",key);
export const cacheImage = (key: string, image: string) => write("images", {key,image,at:Date.now()});
export const stagePreview = (entry: PendingPreview) => write("pending",entry);
export const pendingPreviews = async () => await read<PendingPreview[]>("pending") ?? [];
export async function removePending(key: string, revision: string) {
  try {
    const db = await open(); if(!db)return;
    await new Promise<void>(resolve=>{
      const tx=db.transaction("pending","readwrite"),store=tx.objectStore("pending"),request=store.get(key);
      request.onsuccess=()=>{if(request.result?.revision===revision)store.delete(key);};
      tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();
    });
  }catch { /* Repetição posterior é idempotente. */ }
}
