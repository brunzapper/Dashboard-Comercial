"use client";
/* Miniaturas privadas já comprimidas: não passam pelo otimizador público. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadPreviewImage, loadPreviewMetadata, PreviewUnavailable, type PreviewImage } from "@/lib/dashboard-preview/load";
import { previewNeedsUpdate } from "@/lib/dashboard-preview/geometry";
import { usePreviewPreparationQueue, usePreviewQueue } from "./preview-queue-context";

export type { PreviewImage } from "@/lib/dashboard-preview/load";

/** Always read saved images. Missing/obsolete captures are prepared once per user. */
export function DashboardPreview({ id, name, scope, preview }: {
  id: string; name: string; scope: string; preview?: PreviewImage;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const displayed = useRef<{ scope: string; id: string; version: string } | undefined>(undefined);
  const queue = usePreviewQueue(), preparation = usePreviewPreparationQueue();
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ image: string; scope: string; id: string }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "150px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const reload = () => setAttempt(n => n + 1);
    const changed = (event: Event) => { if ((event as CustomEvent).detail === id) reload(); };
    window.addEventListener("dashboard-preview-published", changed);
    window.addEventListener("online", reload);
    return () => {
      window.removeEventListener("dashboard-preview-published", changed);
      window.removeEventListener("online", reload);
    };
  }, [id]);
  useEffect(() => {
    if (!visible || !ref.current) return;
    let disposed = false, cancelPreparation: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const bounds = () => ref.current?.getBoundingClientRect() ?? { top: 0, left: 0 };
    const show = async (meta: PreviewImage, signal: AbortSignal) => {
      if (displayed.current?.scope === scope && displayed.current.id === id && displayed.current.version === meta.version) return;
      const image = await loadPreviewImage(scope, id, meta, signal);
      if (!disposed && !signal.aborted) {
        displayed.current = { scope, id, version: meta.version };
        setResult({ image, scope, id }); setError(undefined);
      }
    };
    const failed = (error: unknown, signal: AbortSignal) => {
      if (disposed || signal.aborted) return;
      if (error instanceof PreviewUnavailable && [401, 403, 404].includes(error.status)) {
        displayed.current = undefined;
        setResult(undefined); setError("Prévia indisponível"); return;
      }
      setError("Tentando carregar a prévia novamente…");
      retry = setTimeout(() => setAttempt(n => n + 1), Math.min(30_000, 2000 * 2 ** Math.min(attempt, 4)));
    };
    const cancelRead = queue.enqueue({ bounds, run: async signal => {
      try {
        // The RSC's authorized image can appear immediately, before metadata IO.
        if (preview && (displayed.current?.scope !== scope || displayed.current.id !== id)) {
          await show(preview, signal).catch(() => { signal.throwIfAborted(); });
        }
        const meta = await loadPreviewMetadata(id, signal);
        let missingImage = false;
        if (meta.preview) {
          try { await show(meta.preview, signal); }
          catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof PreviewUnavailable) || error.status !== 404) throw error;
            missingImage = true;
          }
        }
        if (disposed || signal.aborted || (!missingImage && !previewNeedsUpdate(meta))) return;
        // Separate serial queue: heavy initial captures never delay ready images.
        cancelPreparation?.();
        cancelPreparation = preparation.enqueue({ bounds, run: async captureSignal => {
          const host = document.createElement("div");
          host.setAttribute("aria-hidden", "true");
          try {
            const latest = await loadPreviewMetadata(id, captureSignal);
            if (!missingImage && !previewNeedsUpdate(latest) && latest.preview) {
              await show(latest.preview, captureSignal); return;
            }
            const { prepareInitialPreview } = await import("@/lib/dashboard-preview/bootstrap");
            captureSignal.throwIfAborted();
            document.body.append(host);
            const image = await prepareInitialPreview(host, id, captureSignal);
            const response = await fetch(`/api/dashboard-previews/${id}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              signal: captureSignal, priority: "low",
              body: JSON.stringify({ ...image, revision: latest.revision, accessVersion: latest.accessVersion }),
            });
            if (!response.ok) throw new PreviewUnavailable(response.status);
            const published = await loadPreviewMetadata(id, captureSignal);
            if (!published.preview) throw new Error("Prévia ainda não publicada");
            await show(published.preview, captureSignal);
          } catch (error) { failed(error, captureSignal); }
          finally { host.remove(); }
        }});
      } catch (error) { failed(error, signal); }
    }});
    return () => { disposed = true; clearTimeout(retry); cancelRead(); cancelPreparation?.(); };
  }, [id, scope, preview, visible, queue, preparation, attempt]);
  const shown = result?.scope === scope && result.id === id ? result : undefined;
  return <Link ref={ref} href={`/dashboards/${id}`} prefetch={false} aria-label={`Abrir dashboard ${name}`}
    className="bg-muted relative mx-3 block min-h-0 overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:ring-ring">
    {!shown ? <span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs" aria-hidden>
      {error ?? "Carregando prévia…"}
    </span> : <img src={shown.image} alt="" aria-hidden decoding="async"
      className="pointer-events-none absolute inset-0 h-full w-full object-cover object-left-top" />}
  </Link>;
}
