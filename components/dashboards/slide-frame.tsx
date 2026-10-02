"use client";
// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): ESQUELETO DE SLIDE — o mesmo topo e rodapé em todas as
//   abas-slide (DashboardSettings.slide + tabs[].headline/kicker). Topo:
//   filete fino com o kicker à esquerda e a data à direita; abaixo, a headline
//   (título-conclusão) na fonte de exibição do estilo; rodapé com a fonte e o
//   nº do slide. É a repetição dessas posições que faz o conjunto parecer
//   projetado. Alturas fixas (lib/dashboards/presentation.ts) — o grid recebe
//   o que sobra no `fitHeight`. Componente de LAYOUT puro: não busca nada.
import { cn } from "@/lib/utils";
import {
  SLIDE_FOOTER_H,
  SLIDE_HEADER_H,
  SLIDE_HEADLINE_H,
  slideDateLabel,
  type SlideFrameContent,
} from "@/lib/dashboards/presentation";

export function SlideFrame({
  content,
  index,
  total,
  compact = false,
  children,
}: {
  content: SlideFrameContent | null;
  /** Posição do slide (0-based) e total — para o "3/12" do rodapé. */
  index: number;
  total: number;
  /** Fora da apresentação: só kicker + headline, sem rodapé nem alturas fixas. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  if (!content) return <>{children}</>;
  const showTop = !!content.kicker || content.date;
  const showFoot = !compact && (!!content.footer || content.number);
  const kicker = content.kicker ? (
    <span className="ds-kicker truncate text-[0.7rem] font-semibold tracking-[0.12em] uppercase opacity-70">
      {content.kicker}
    </span>
  ) : (
    <span />
  );

  if (compact) {
    if (!content.kicker && !content.headline) return <>{children}</>;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5 px-1">
          {content.kicker ? kicker : null}
          {content.headline ? (
            <h2 className="ds-display text-2xl leading-tight font-normal tracking-tight">
              {content.headline}
            </h2>
          ) : null}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {showTop ? (
        <div
          className="flex shrink-0 items-center justify-between gap-4 border-b"
          style={{ height: SLIDE_HEADER_H }}
        >
          {kicker}
          {content.date ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {slideDateLabel(new Date())}
            </span>
          ) : null}
        </div>
      ) : null}
      {content.headline ? (
        <div
          className="flex shrink-0 items-end overflow-hidden"
          style={{ height: SLIDE_HEADLINE_H }}
        >
          <h2 className="ds-display truncate pb-1 text-[1.65rem] leading-none font-normal tracking-tight">
            {content.headline}
          </h2>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
      {showFoot ? (
        <div
          className={cn(
            "text-muted-foreground flex shrink-0 items-end justify-between gap-4 text-xs"
          )}
          style={{ height: SLIDE_FOOTER_H }}
        >
          <span className="truncate">{content.footer ?? ""}</span>
          {content.number ? (
            <span className="tabular-nums">
              {index + 1}/{total}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
