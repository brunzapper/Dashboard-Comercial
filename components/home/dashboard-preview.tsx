"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { previewCache, previewCacheKey } from "@/lib/dashboard-preview/cache";
import { capturePreview } from "@/lib/dashboard-preview/capture";
import { usePreviewQueue } from "./preview-queue-context";

/** Reutiliza uma captura inerte; só uma prévia ausente monta o dashboard real. */
export function DashboardPreview({ id, name, revision, scope }: {
  id: string; name: string; revision: string; scope: string;
}) {
  const container = useRef<HTMLAnchorElement>(null);
  const worker = useRef<HTMLSpanElement>(null);
  const queue = usePreviewQueue();
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState({ width: 1440, height: 900, scale: 0.25, measured: false, theme: "" });
  const [result, setResult] = useState<{ key: string; html?: string; failed?: boolean } | null>(null);
  const key = previewCacheKey(scope, id, revision, size.width, size.height, size.theme);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const width = Math.max(320, document.querySelector("main[data-app-main]")?.clientWidth || window.innerWidth);
      const height = window.innerHeight, scale = element.clientWidth / width;
      const root = document.documentElement;
      const theme = root.className + root.style.cssText;
      setSize((prev) => prev.width === width && prev.height === height && prev.scale === scale && prev.theme === theme && prev.measured
        ? prev : { width, height, scale, measured: true, theme });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    const theme = new MutationObserver(measure);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", measure);
    measure();
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => {
      resize.disconnect();
      theme.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const element = container.current, host = worker.current;
    if (!visible || !size.measured || !element || !host) return;
    return queue.enqueue({
      bounds: () => (element.closest("[data-hub-card]") ?? element).getBoundingClientRect(),
      run: async (signal) => {
        try {
          const cached = previewCache.get(key);
          const html = cached ?? await capturePreview(host, `/dashboards/${id}/preview`, size.width, size.height, signal);
          if (signal.aborted) return;
          if (!cached) previewCache.set(key, html);
          setResult({ key, html });
        } catch {
          if (!signal.aborted) setResult({ key, failed: true });
        }
      },
    });
  }, [id, key, queue, visible, size.measured, size.width, size.height]);

  const current = result?.key === key ? result : null;
  return (
    <Link
      ref={container}
      href={`/dashboards/${id}`}
      prefetch={false}
      aria-label={`Abrir dashboard ${name}`}
      className="bg-muted relative mx-3 block overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:ring-ring"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      <span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs" aria-hidden>
        {current?.failed ? "Abra o dashboard para visualizar" : "Preparando prévia…"}
      </span>
      <span ref={worker} aria-hidden />
      {visible && current?.html ? (
        <iframe
          title={`Prévia de ${name}`}
          srcDoc={current.html}
          sandbox="allow-same-origin"
          data-preview-static
          tabIndex={-1}
          aria-hidden
          className="bg-background pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: size.width, height: size.height, transform: `scale(${size.scale})` }}
        />
      ) : null}
    </Link>
  );
}
