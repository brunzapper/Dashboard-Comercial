// v2.0 | 21/09/2026 — removida pausa em interação (pointerdown/keydown);
// rolar e clicar dentro do hub NÃO interrompem o carregamento das prévias.
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { PreviewQueue, schedulePreviewTask } from "@/lib/dashboard-preview/queue";

const Context = createContext<PreviewQueue | null>(null);
const PreparationContext = createContext<PreviewQueue | null>(null);

export function PreviewQueueProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(() => new PreviewQueue(schedulePreviewTask));
  const [preparation] = useState(() => new PreviewQueue(schedulePreviewTask, 1));
  useEffect(() => {
    const queues = [queue, preparation];
    const pathname = location.pathname;
    queues.forEach(q => q.start());
    let navigating = false;
    const stop = () => { navigating = true; queues.forEach(q => q.pause()); };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { navigating = false; queues.forEach(q => q.start()); }
    };
    const historyChanged = () => {
      if (location.pathname !== pathname) stop();
      else { navigating = false; queues.forEach(q => q.start()); }
    };
    const visibility = () => {
      if (navigating) return;
      if (document.hidden) queues.forEach(q => q.pause());
      else queues.forEach(q => q.start());
    };
    const navigate = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      // Same-page filters preserve this provider: pausing here would leave the
      // queue stopped forever because no unmount/pageshow follows the RSC update.
      if (url.origin !== location.origin || url.pathname !== location.pathname) stop();
    };
    document.addEventListener("click", navigate, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", restore);
    window.addEventListener("popstate", historyChanged);
    return () => {
      document.removeEventListener("click", navigate, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("popstate", historyChanged);
      queues.forEach(q => q.stop());
    };
  }, [queue, preparation]);
  return <Context.Provider value={queue}><PreparationContext.Provider value={preparation}>{children}</PreparationContext.Provider></Context.Provider>;
}

export function usePreviewPreparationQueue() {
  const queue = useContext(PreparationContext);
  if (!queue) throw new Error("Prévia precisa de PreviewQueueProvider");
  return queue;
}

export function usePreviewQueue() {
  const queue = useContext(Context);
  if (!queue) throw new Error("Prévia precisa de PreviewQueueProvider");
  return queue;
}
