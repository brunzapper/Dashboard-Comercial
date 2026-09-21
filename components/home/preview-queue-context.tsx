"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { PreviewQueue, schedulePreviewIdle } from "@/lib/dashboard-preview/queue";

const Context = createContext<PreviewQueue | null>(null);

export function PreviewQueueProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(() => new PreviewQueue(schedulePreviewIdle));
  useEffect(() => {
    queue.start();
    let navigating = false;
    let resume: ReturnType<typeof setTimeout> | undefined;
    // Pausa imediatamente; o cleanup descarta a fila ao desmontar. Manter os
    // descritores até lá permite restaurar a página pelo BFCache do browser.
    const stop = () => { navigating = true; clearTimeout(resume); queue.pause(); };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { navigating = false; queue.start(); }
    };
    const interact = () => {
      if (navigating) return;
      clearTimeout(resume);
      queue.pause();
      resume = setTimeout(() => { if (!document.hidden) queue.start(); }, 300);
    };
    const visibility = () => {
      if (navigating) return;
      if (document.hidden) queue.pause();
      else queue.start();
    };
    const navigate = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) stop();
    };
    // Capture roda antes do Link/Router; não preventDefault e não await.
    document.addEventListener("click", navigate, true);
    document.addEventListener("pointerdown", interact, true);
    document.addEventListener("keydown", interact, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", restore);
    window.addEventListener("popstate", stop);
    return () => {
      document.removeEventListener("click", navigate, true);
      document.removeEventListener("pointerdown", interact, true);
      document.removeEventListener("keydown", interact, true);
      document.removeEventListener("visibilitychange", visibility);
      clearTimeout(resume);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("popstate", stop);
      queue.stop();
    };
  }, [queue]);
  return <Context.Provider value={queue}>{children}</Context.Provider>;
}

export function usePreviewQueue() {
  const queue = useContext(Context);
  if (!queue) throw new Error("Prévia precisa de PreviewQueueProvider");
  return queue;
}
