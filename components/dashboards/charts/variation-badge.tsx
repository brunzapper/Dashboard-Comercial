"use client";
// Versão: 1.0 | Data: 17/07/2026
// Badge de variação vs. período de comparação: número colorido (verde/
// vermelho, invertível), setinha ↑/↓, ou os dois — conforme
// ComparisonSettings.style/format. Usado pelo Card, pelas células da tabela
// agregada e pelos itens de ranking do Card. Sem valor comparável → "—"
// (ou nada, com `hideWhenUnavailable`).
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import {
  computeVariation,
  formatVariation,
  variationTone,
} from "@/lib/widgets/variation";
import type { ComparisonSettings } from "@/lib/widgets/types";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<string, string> = {
  good: "text-chart-2",
  bad: "text-destructive",
  flat: "text-muted-foreground",
};

export function VariationBadge({
  cur,
  prev,
  settings,
  fmtAbs,
  className,
  style: styleProp,
  hideWhenUnavailable,
}: {
  cur: number | null | undefined;
  prev: number | null | undefined;
  settings: ComparisonSettings;
  /** Formata o valor absoluto na escala da métrica (moeda/percentual). */
  fmtAbs?: (n: number) => string;
  className?: string;
  /** Estilos extras (ex.: fontSize dos controles de fonte do widget). */
  style?: React.CSSProperties;
  /** Sem variação disponível: não renderiza nada (em vez de "—"). */
  hideWhenUnavailable?: boolean;
}) {
  const v = computeVariation(cur, prev);
  if (!v) {
    if (hideWhenUnavailable) return null;
    return (
      <span className={cn("text-muted-foreground", className)} style={styleProp}>
        —
      </span>
    );
  }
  const style = settings.style ?? "both";
  const tone = variationTone(v, settings.invertColors);
  const text = formatVariation(v, settings.format ?? "pct", fmtAbs);
  const Icon = v.dir === "up" ? ArrowUp : v.dir === "down" ? ArrowDown : ArrowRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 whitespace-nowrap tabular-nums",
        style !== "arrow" && TONE_CLASS[tone],
        className
      )}
      style={styleProp}
      title={text}
    >
      {style !== "color" ? (
        <Icon
          aria-hidden
          className={cn("size-[1em] shrink-0", style === "arrow" && TONE_CLASS[tone])}
        />
      ) : null}
      {text}
    </span>
  );
}
