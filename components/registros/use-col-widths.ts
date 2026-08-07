// Versão: 1.0 | Data: 07/08/2026
// Larguras de coluna da tabela de /registros — chrome de UI por usuário,
// persistido em localStorage (`registros:colWidths:<fonte>`), NUNCA no banco.
// Hidratação-safe: o SSR renderiza {} (sem estilo) e o localStorage entra
// pós-mount; storage indisponível (modo privado) degrada para só-memória.
// A gravação é debounced (~250ms): o ResizeHandle dispara a cada pointermove.
"use client";

import { useEffect, useRef, useState } from "react";

const MIN_W = 40;
const MAX_W = 2000;

function clamp(w: number): number {
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));
}

function loadWidths(storageKey: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp(v);
    }
    return out;
  } catch {
    return {};
  }
}

export function useColWidths(storageKey: string): {
  widths: Record<string, number>;
  setWidth: (key: string, w: number) => void;
  widthStyle: (key: string) => React.CSSProperties;
} {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const latest = useRef<Record<string, number>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = widths;
  }, [widths]);

  // Carga pós-mount + recarga ao trocar de fonte (a chave muda). Leitura no
  // initializer causaria hydration mismatch (padrão use-panel-width/
  // comp-overview: SSR determinístico, flicker de um frame aceito).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidths(loadWidths(storageKey));
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [storageKey]);

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(latest.current));
      } catch {
        // storage indisponível — segue só em memória
      }
    }, 250);
  }

  function setWidth(key: string, w: number) {
    const next = clamp(w);
    setWidths((cur) => (cur[key] === next ? cur : { ...cur, [key]: next }));
    scheduleSave();
  }

  function widthStyle(key: string): React.CSSProperties {
    const w = widths[key];
    return w ? { width: w, minWidth: w, maxWidth: w } : {};
  }

  return { widths, setWidth, widthStyle };
}
