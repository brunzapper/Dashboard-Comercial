// v2.0 | 21/09/2026 — removida pausa em interação (pointerdown/keydown);
// rolar e clicar dentro do hub NÃO interrompem o carregamento das prévias.
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { PreviewQueue, schedulePreviewTask } from "@/lib/dashboard-preview/queue";

const Context = createContext<PreviewQueue | null>(null);

export function PreviewQueueProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(() => new PreviewQueue(schedulePreviewTask));
  useEffect(() => {
    queue.start();
    let navigating = false;
    const stop = () => { navigating = true; queue.pause(); };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { navigating = false; queue.start(); }
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
    document.addEventListener("click", navigate, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", restore);
    window.addEventListener("popstate", stop);
    return () => {
      document.removeEventListener("click", navigate, true);
      document.removeEventListener("visibilitychange", visibility);
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
