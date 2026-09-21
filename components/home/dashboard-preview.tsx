"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/** O iframe renderiza a janela inicial a 100%; só a miniatura é reduzida.
 * Não ajusta o canvas inteiro ao card: conteúdo além da janela fica recortado.
 */
export function DashboardPreview({ id, name }: { id: string; name: string }) {
  const container = useRef<HTMLAnchorElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState({ width: 1440, height: 900, scale: 0.25 });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const width = Math.max(320, document.querySelector("main[data-app-main]")?.clientWidth || window.innerWidth);
      setSize({ width, height: window.innerHeight, scale: element.clientWidth / width });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    window.addEventListener("resize", measure);
    measure();
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "150px" });
    observer.observe(element);
    return () => {
      resize.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
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
        Prévia do dashboard
      </span>
      {visible ? (
        <iframe
          title={`Prévia de ${name}`}
          src={`/dashboards/${id}/preview`}
          loading="lazy"
          tabIndex={-1}
          aria-hidden
          className="bg-background pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{ width: size.width, height: size.height, transform: `scale(${size.scale})` }}
        />
      ) : null}
    </Link>
  );
}
