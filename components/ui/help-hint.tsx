// Versão: 1.0 | Data: 30/07/2026
// Popover "?" genérico de ajuda contextual (molde: SourceConceptsHint) — o
// veículo padrão para explicação de conceito/comportamento que antes vivia em
// parágrafos sempre-visíveis. Fica junto do rótulo do controle; o conteúdo só
// aparece quando o usuário pede. Avisos críticos (comportamento destrutivo ou
// surpreendente) NÃO entram aqui — continuam inline, sempre visíveis.
"use client";

import { CircleHelp } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function HelpHint({
  title,
  ariaLabel,
  className,
  children,
}: {
  /** Linha de abertura em negrito (opcional). */
  title?: string;
  /** Rótulo acessível do botão "?" — descreva o assunto da ajuda. */
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center align-middle",
            className
          )}
          aria-label={ariaLabel}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="flex flex-col gap-2 text-xs">
          {title ? <p className="font-medium">{title}</p> : null}
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
