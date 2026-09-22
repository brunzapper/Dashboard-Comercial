"use client";
import { useEffect } from "react";
import { previewIsReady } from "@/lib/dashboard-preview/readiness";
import { thumbnail } from "@/lib/dashboard-preview/capture";
import { stagePreview } from "@/lib/dashboard-preview/store";
import { schedulePreviewTask } from "@/lib/dashboard-preview/queue";
import { PREVIEW_SIZE, previewNeedsUpdate } from "@/lib/dashboard-preview/geometry";

/** Prepara uma candidata; publicação acontece só depois de sair do dashboard. */
export function PreviewRecorder({ id, scope, ready }: { id: string; scope: string; ready: boolean }) {
  useEffect(() => {
    if (!ready || window.self !== window.top) return;
    const main = document.querySelector<HTMLElement>("main[data-app-main]");
    if (!main) return;
    let controller = new AbortController(), disposed = false, running = false, dirty = true;
    let timer: ReturnType<typeof setTimeout> | undefined, idle: (() => void) | undefined;
    const pause = () => { controller.abort(); clearTimeout(timer); idle?.(); };
    const schedule = () => {
      if (disposed || running || !dirty) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.hidden || !previewIsReady(main)) return;
        idle = schedulePreviewTask(() => {
          if (disposed || running || !dirty) return;
          running = true; controller = new AbortController(); const signal = controller.signal;
          void (async () => {
            const response = await fetch(`/api/dashboard-previews/${id}?metadata`, { signal, priority: "low", cache: "no-store" });
            if (!response.ok) { dirty = false; return; }
            const meta = await response.json();
            if (!previewNeedsUpdate(meta)) { dirty = false; return; }
            const image = await thumbnail(main, signal);
            if (signal.aborted) return;
            await stagePreview({ key: `${scope}:${id}`, scope, id, image, revision: meta.revision,
              accessVersion: meta.accessVersion, width: PREVIEW_SIZE, height: PREVIEW_SIZE, at: Date.now() });
            dirty = false;
            window.dispatchEvent(new Event("dashboard-preview-staged"));
          })().catch(error => { if (error?.name !== "AbortError") dirty = false; })
            .finally(() => { running = false; schedule(); });
        });
      }, 750);
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail !== id) return;
      dirty = true; pause(); schedule();
    };
    const interact = () => { pause(); schedule(); };
    const observer = new MutationObserver(interact);
    observer.observe(main, { subtree: true, childList: true, attributes: true, characterData: true });
    schedule();
    window.addEventListener("dashboard-structure-saved", changed);
    document.addEventListener("pointerdown", interact, true);
    document.addEventListener("keydown", interact, true);
    document.addEventListener("visibilitychange", interact);
    document.addEventListener("scroll", interact, true);
    return () => {
      disposed = true; pause(); observer.disconnect();
      window.removeEventListener("dashboard-structure-saved", changed);
      document.removeEventListener("pointerdown", interact, true);
      document.removeEventListener("keydown", interact, true);
      document.removeEventListener("visibilitychange", interact);
      document.removeEventListener("scroll", interact, true);
    };
  }, [id, scope, ready]);
  return null;
}
