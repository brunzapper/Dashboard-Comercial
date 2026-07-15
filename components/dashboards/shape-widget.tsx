// Versão: 1.0 | Data: 15/07/2026
// Widget Forma (figura geométrica): SVG desenhado em pixels exatos (mede o
// container com ResizeObserver — sem distorção de viewBox, contorno nítido),
// texto centralizado por cima e atalho opcional para outro widget
// (useFocusWidget: clique fora do modo edição navega/centraliza o alvo).
// Renderizado SEM cromo de card (frameless) pelo widget-card.
"use client";

import { useCallback, useRef, useState } from "react";

import type {
  AppearanceSettings,
  ShapeKind,
  WidgetSettings,
} from "@/lib/widgets/types";
import { useFocusWidget } from "./focus-context";

const DEFAULT_FILL = "color-mix(in oklch, var(--color-primary) 15%, transparent)";
const DEFAULT_STROKE = "var(--color-primary)";
const DEFAULT_STROKE_WIDTH = 2;

// Geometria de cada forma no retângulo W×H com inset i (metade do contorno,
// para o traço não ser cortado pelas bordas do SVG).
function shapeElement(
  kind: ShapeKind,
  W: number,
  H: number,
  i: number,
  common: React.SVGProps<SVGElement>
) {
  const rect = { x: i, y: i, width: Math.max(0, W - 2 * i), height: Math.max(0, H - 2 * i) };
  const pts = (list: [number, number][]) =>
    list.map(([x, y]) => `${x},${y}`).join(" ");
  switch (kind) {
    case "retangulo":
      return <rect {...rect} {...(common as React.SVGProps<SVGRectElement>)} />;
    case "retangulo_arredondado":
      return (
        <rect rx={12} {...rect} {...(common as React.SVGProps<SVGRectElement>)} />
      );
    case "elipse":
      return (
        <ellipse
          cx={W / 2}
          cy={H / 2}
          rx={Math.max(0, W / 2 - i)}
          ry={Math.max(0, H / 2 - i)}
          {...(common as React.SVGProps<SVGEllipseElement>)}
        />
      );
    case "losango":
      return (
        <polygon
          points={pts([
            [W / 2, i],
            [W - i, H / 2],
            [W / 2, H - i],
            [i, H / 2],
          ])}
          {...(common as React.SVGProps<SVGPolygonElement>)}
        />
      );
    case "triangulo":
      return (
        <polygon
          points={pts([
            [W / 2, i],
            [W - i, H - i],
            [i, H - i],
          ])}
          {...(common as React.SVGProps<SVGPolygonElement>)}
        />
      );
    case "hexagono":
      return (
        <polygon
          points={pts([
            [0.25 * W, i],
            [0.75 * W, i],
            [W - i, H / 2],
            [0.75 * W, H - i],
            [0.25 * W, H - i],
            [i, H / 2],
          ])}
          {...(common as React.SVGProps<SVGPolygonElement>)}
        />
      );
    case "seta":
      // Seta para a direita: haste com 40% da altura + cabeça nos 30% finais.
      return (
        <polygon
          points={pts([
            [i, 0.3 * H],
            [0.7 * W, 0.3 * H],
            [0.7 * W, i],
            [W - i, H / 2],
            [0.7 * W, H - i],
            [0.7 * W, 0.7 * H],
            [i, 0.7 * H],
          ])}
          {...(common as React.SVGProps<SVGPolygonElement>)}
        />
      );
  }
}

export function ShapeWidget({
  shape,
  appearance,
  editMode,
}: {
  shape?: WidgetSettings["shape"];
  appearance?: AppearanceSettings["shape"];
  editMode: boolean;
}) {
  const focus = useFocusWidget();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  // Callback ref (padrão do grid): re-liga o observer a cada remontagem.
  const setEl = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const measure = () =>
      setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const kind = shape?.kind ?? "retangulo_arredondado";
  const strokeWidth = appearance?.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const link = shape?.link;
  const clickable = !!link && !editMode;

  const body = (
    <div ref={setEl} className="relative h-full w-full">
      {size.w > 0 && size.h > 0 ? (
        <svg width={size.w} height={size.h} className="absolute inset-0" aria-hidden>
          {shapeElement(kind, size.w, size.h, strokeWidth / 2, {
            fill: appearance?.fill ?? DEFAULT_FILL,
            stroke: appearance?.stroke ?? DEFAULT_STROKE,
            strokeWidth,
          })}
        </svg>
      ) : null}
      {shape?.text ? (
        <span
          className="absolute inset-0 flex items-center justify-center p-2 text-center break-words"
          style={{
            color: appearance?.textColor ?? "var(--color-foreground)",
            fontSize: appearance?.fontSize ?? 14,
          }}
        >
          {shape.text}
        </span>
      ) : null}
    </div>
  );

  if (clickable) {
    return (
      <button
        type="button"
        className="block h-full w-full cursor-pointer text-left"
        onClick={() => focus(link)}
        aria-label={`Ir para o widget ligado${shape?.text ? ` (${shape.text})` : ""}`}
        title="Ir para o widget ligado"
      >
        {body}
      </button>
    );
  }
  return body;
}
