"use client";
/* Miniaturas já comprimidas e privadas: não passam pelo otimizador público do Next. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cacheImage, imageKey, readLocalImage } from "@/lib/dashboard-preview/store";
import { usePreviewQueue } from "./preview-queue-context";

// v2.0 | 21/09/2026 — prévia stale (access_version < epoch) é EXIBIDA
// normalmente; a recaptura é automática na próxima visita ao dashboard.
export interface PreviewImage { version: string; width: number; height: number; access_version: number }
type RefreshedPreview = { scopeKey: string; base?: string; meta: PreviewImage };
const published = new Map<string, RefreshedPreview>();
/** Apenas lê a miniatura pronta; jamais monta dashboard/engine. */
export function DashboardPreview({ id, name, scope, preview }: {
  id: string; name: string; scope: string; preview?: PreviewImage;
}) {
  const ref = useRef<HTMLAnchorElement>(null), queue = usePreviewQueue();
  const [visible, setVisible] = useState(false);
  const scopeKey = JSON.stringify([scope,id]);
  const [fresh, setFresh] = useState<RefreshedPreview | undefined>(() => published.get(scopeKey));
  const [result, setResult] = useState<{key: string; image: string; scope: string; id: string; meta: PreviewImage}>();
  // v2.0: epoch não é mais gate na RLS — prévia stale é exibida e recapturada
  // na próxima visita ao dashboard; validação não compara access_version.
  const validFresh = fresh?.scopeKey === scopeKey &&
    (fresh.base === preview?.version || fresh.meta.version === preview?.version);
  const meta = validFresh ? fresh?.meta : preview;
  const key = meta ? imageKey(scope,id,meta.version) : "";
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail !== id) return;
      void fetch(`/api/dashboard-previews/${id}?metadata`, {cache:"no-store",priority:"low"})
        .then(r => r.ok ? r.json() : null).then(m => {
          if(!m?.preview) return;
          const entry={scopeKey,base:preview?.version,meta:m.preview};
          // Não reusar uma antiga captura quando o RSC não autorizou nenhuma.
          if(preview) { published.set(scopeKey,entry); if(published.size>200)published.delete(published.keys().next().value!); }
          setFresh(entry);
        }).catch(() => {});
    };
    window.addEventListener("dashboard-preview-published", changed);
    return () => window.removeEventListener("dashboard-preview-published", changed);
  }, [id,scopeKey,preview]);
  useEffect(() => {
    if (!key || !visible || !ref.current || !meta) return;
    return queue.enqueue({ bounds: () => ref.current!.getBoundingClientRect(), run: async signal => {
      let image = (await readLocalImage(key))?.image;
      if (!image) {
        const response = await fetch(`/api/dashboard-previews/${id}?v=${meta.version}`, {signal, priority:"low"});
        if (!response.ok) return;
        const blob = await response.blob();
        image = await new Promise<string>((resolve,reject) => {
          const reader = new FileReader(); reader.onload=()=>resolve(reader.result as string); reader.onerror=reject; reader.readAsDataURL(blob);
        });
        if (signal.aborted) return;
        await cacheImage(key,image);
      }
      const decoded = new Image(); decoded.src=image; await decoded.decode();
      if (!signal.aborted) setResult({key,image,scope,id,meta});
    }});
  }, [id,key,meta,queue,visible,scope]);
  // v2.0: sem comparação de access_version — prévia stale é exibida
  const shown = result?.scope === scope && result.id === id ? result : undefined;
  const dimensions = shown?.meta ?? meta;
  return <Link ref={ref} href={`/dashboards/${id}`} prefetch={false} aria-label={`Abrir dashboard ${name}`}
    className="bg-muted relative mx-3 block overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:ring-ring"
    style={{aspectRatio:dimensions ? `${dimensions.width} / ${dimensions.height}` : "16 / 9"}}>
    <span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs" aria-hidden>
      {meta ? "" : "Prévia ainda não preparada"}
    </span>
    {shown ? <img src={shown.image} alt="" aria-hidden decoding="async"
      className="pointer-events-none absolute inset-0 h-full w-full object-cover" /> : null}
  </Link>;
}
