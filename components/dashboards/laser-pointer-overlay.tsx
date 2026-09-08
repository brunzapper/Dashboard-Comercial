// Versão: 1.2 | Data: 05/08/2026
// Overlay do Ponteiro Laser (modo apresentação): a bolinha colorida segue o
// cursor SEMPRE; o traço só é desenhado com o botão esquerdo pressionado
// (traços independentes por pressionada, esmaecendo em TRAIL_TTL_MS —
// helpers puros em lib/laser-trail.ts). Engole cliques (widgets não reagem
// durante a apresentação); wheel não é pointer event e borbulha ao scroller
// (rolagem segue funcionando). Toque é IGNORADO (sem touch-none — a rolagem
// nativa por toque fica preservada). Saídas: Esc, clique-direito (reabre o
// menu do apresentador via onOpenMenu) ou DWELL_MS parado sobre espaço VAZIO
// do canvas — nunca com o botão pressionado (pausa no meio de um desenho não
// encerra o modo). Puro de UI — quem liga/desliga é o dashboard-grid.
// v1.2 (05/08/2026): hook renomeado p/ useHoverEdgePan (o gesto passou a
//   valer também fora do laser, com engate atrasado; aqui segue imediato).
// v1.1 (05/08/2026): auto-pan de borda (useHoverEdgePan) — aproximar o
//   ponteiro das bordas/cantos rola a área de trabalho na direção da borda
//   (os dois eixos) sem sair do modo para a "mãozinha". Enquanto rola, o
//   dwell NÃO conta (senão o pan de apresentação encerraria o modo) e a
//   bolinha/traço em curso são re-ancorados ao cursor a cada frame (o canvas
//   desliza por baixo sem pointermove novo).
"use client";

import { useEffect, useRef, useState } from "react";

import { useHoverEdgePan } from "@/lib/use-hover-edge-pan";

import {
  DWELL_MOVE_PX,
  DWELL_MS,
  appendPoint,
  beginStroke,
  pruneStrokes,
  trailOpacity,
  type TrailStroke,
} from "@/lib/laser-trail";

export function LaserPointerOverlay({
  color,
  onExit,
  onOpenMenu,
  scrollRef,
}: {
  color: string;
  /** Desativa o modo (dwell no vazio ou Esc). */
  onExit: () => void;
  /** Clique-direito: reabre o menu do apresentador ("Desativar…"). */
  onOpenMenu: (x: number, y: number) => void;
  /** Container de rolagem horizontal do grid (auto-pan de borda); sem ele o
   * auto-pan fica inerte. */
  scrollRef?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Traços em ref (fora do estado React): o loop de rAF muta e força render.
  const strokesRef = useRef<TrailStroke[]>([]);
  const drawingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  // Último clientX/Y — o hit-test do dwell roda no timeout, fora do evento.
  const clientRef = useRef({ x: 0, y: 0 });
  const dwellRef = useRef<{ x: number; y: number; timer: number | null }>({
    x: 0,
    y: 0,
    timer: null,
  });
  // Bolinha em coords LOCAIS do canvas (o overlay rola junto do conteúdo).
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null);
  // Snapshot de RENDER dos traços (regra react-hooks/refs: ref não se lê no
  // render): o tick do rAF copia o array externo do ref p/ cá — a identidade
  // nova re-renderiza; os points internos são lidos na hora do render.
  const [renderStrokes, setRenderStrokes] = useState<TrailStroke[]>([]);

  const clearDwell = () => {
    const d = dwellRef.current;
    if (d.timer != null) {
      clearTimeout(d.timer);
      d.timer = null;
    }
  };

  // Arma/re-arma a pausa de saída. Só dispara com o botão solto e sobre
  // espaço vazio: elementsFromPoint enxerga os itens do RGL (o container é
  // pointer-events-none, mas cada item re-habilita com pointer-events-auto);
  // parado SOBRE um widget = apontando, não sai.
  const armDwell = (cx: number, cy: number) => {
    clearDwell();
    dwellRef.current = {
      x: cx,
      y: cy,
      timer: window.setTimeout(() => {
        dwellRef.current.timer = null;
        if (drawingRef.current) return;
        const { x, y } = clientRef.current;
        const overWidget = document
          .elementsFromPoint(x, y)
          .some((el) => !!(el as HTMLElement).closest?.(".react-grid-item"));
        if (!overWidget) onExit();
      }, DWELL_MS),
    };
  };

  // Loop de rAF: expira pontos e re-renderiza; morre sozinho quando não há
  // mais traços nem desenho em curso (bolinha parada não anima nada).
  const ensureLoop = () => {
    if (rafRef.current != null) return;
    const tick = () => {
      rafRef.current = null;
      strokesRef.current = pruneStrokes(strokesRef.current, performance.now());
      setRenderStrokes([...strokesRef.current]);
      if (strokesRef.current.length > 0 || drawingRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // Auto-pan de borda: perto das bordas/cantos a área de trabalho rola na
  // direção da borda (useHoverEdgePan — sem idle: parado na zona segue
  // rolando). Sem scrollRef (viewer sem grid) o hook fica inerte.
  const noScrollRef = useRef<HTMLElement | null>(null);
  const edgePan = useHoverEdgePan(scrollRef ?? noScrollRef, {
    // Rolando: o dwell não conta e a bolinha (e o traço em curso) seguem o
    // CURSOR — o canvas desliza por baixo e as coords locais mudam sem
    // pointermove novo.
    onPan: () => {
      clearDwell();
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const p = {
        x: clientRef.current.x - r.left,
        y: clientRef.current.y - r.top,
        t: performance.now(),
      };
      setDot({ x: p.x, y: p.y });
      if (drawingRef.current) {
        appendPoint(strokesRef.current, p);
        ensureLoop();
      }
    },
    // Saiu da zona: devolve o dwell (mesmo contrato do pointerup — o timer já
    // ignora disparo com o botão pressionado).
    onSettle: () => armDwell(clientRef.current.x, clientRef.current.y),
  });

  // Esc sai do modo a qualquer momento (padrão dos overlays do canvas).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  // Cleanup no unmount (toggle do modo/StrictMode): timer + rAF.
  useEffect(() => {
    return () => {
      clearDwell();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const localPoint = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  };

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-40 cursor-none"
      onPointerMove={(e) => {
        if (e.pointerType === "touch") return;
        clientRef.current = { x: e.clientX, y: e.clientY };
        const p = localPoint(e);
        setDot({ x: p.x, y: p.y });
        edgePan.onSample(e.clientX, e.clientY);
        if (drawingRef.current) {
          appendPoint(strokesRef.current, p);
          ensureLoop();
          return;
        }
        if (edgePan.panningRef.current) return; // rolando: o loop rege o dwell
        const d = dwellRef.current;
        if (
          d.timer == null ||
          Math.hypot(e.clientX - d.x, e.clientY - d.y) > DWELL_MOVE_PX
        ) {
          armDwell(e.clientX, e.clientY);
        }
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "touch" || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation(); // não deixa o pan do canvas armar por baixo
        drawingRef.current = true;
        clearDwell();
        beginStroke(strokesRef.current, localPoint(e));
        ensureLoop();
      }}
      onPointerUp={(e) => {
        if (e.pointerType === "touch") return;
        drawingRef.current = false;
        armDwell(e.clientX, e.clientY);
      }}
      onPointerCancel={(e) => {
        drawingRef.current = false;
        armDwell(e.clientX, e.clientY);
      }}
      onPointerLeave={() => {
        drawingRef.current = false;
        edgePan.stop();
        clearDwell();
        setDot(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation(); // o menu é nosso — não duplica no canvas
        edgePan.stop(); // com o menu aberto a rolagem não continua por baixo
        clearDwell(); // com o menu aberto o dwell não desativa por baixo
        onOpenMenu(e.clientX, e.clientY);
      }}
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        {renderStrokes.map((s, si) =>
          s.points.slice(1).map((b, i) => {
            const a = s.points[i];
            return (
              <line
                key={`${si}-${i}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={4}
                strokeLinecap="round"
                strokeOpacity={trailOpacity(performance.now() - b.t)}
              />
            );
          })
        )}
        {dot ? <circle cx={dot.x} cy={dot.y} r={6} fill={color} /> : null}
      </svg>
    </div>
  );
}
