"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pendingPreviews, removePending } from "@/lib/dashboard-preview/store";
import { schedulePreviewTask } from "@/lib/dashboard-preview/queue";

/** Sobrevive à troca de página; outbox sobrevive inclusive ao fechamento da aba. */
export function PreviewPublisher({ scope }: { scope: string }) {
  const path = usePathname();
  useEffect(() => {
    if (window.self !== window.top) return;
    let stopped = false, busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined, idle: (() => void) | undefined;
    const controller = new AbortController();
    const schedule = () => {
      clearTimeout(timer); idle?.();
      if (stopped || busy || document.hidden) return;
      timer = setTimeout(() => { idle = schedulePreviewTask(() => {
        busy = true; let more = false;
        void (async () => {
          for (const entry of await pendingPreviews()) {
            if (stopped) break;
            if (entry.scope !== scope || path === `/dashboards/${entry.id}`) continue;
            const response = await fetch(`/api/dashboard-previews/${entry.id}`, {
              method: "POST", headers: { "Content-Type": "application/json" }, priority: "low",
              body: JSON.stringify(entry), signal: controller.signal,
            });
            if (response.ok || [400,403,404,409].includes(response.status)) await removePending(entry.key,entry.revision);
            if (response.ok) window.dispatchEvent(new CustomEvent("dashboard-preview-published", {detail:entry.id}));
            // Uma requisição pequena por idle; falha transitória fica na outbox.
            more = response.ok; break;
          }
        })().catch(() => {}).finally(() => { busy = false; if(more) schedule(); });
      }); }, 1500);
    };
    schedule();
    window.addEventListener("dashboard-preview-staged", schedule);
    window.addEventListener("online", schedule);
    document.addEventListener("pointerdown", schedule, true);
    document.addEventListener("keydown", schedule, true);
    document.addEventListener("visibilitychange", schedule);
    const retry = setInterval(schedule, 15_000);
    return () => {
      stopped = true; controller.abort(); clearTimeout(timer); idle?.(); clearInterval(retry);
      window.removeEventListener("dashboard-preview-staged", schedule);
      window.removeEventListener("online", schedule);
      document.removeEventListener("pointerdown", schedule, true);
      document.removeEventListener("keydown", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [path, scope]);
  return null;
}
