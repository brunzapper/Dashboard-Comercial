// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): ESTADO VAZIO compartilhado — ícone, título, uma frase
//   que diz o que aparece ali e as ações para começar. Substitui o
//   `<p className="text-muted-foreground text-sm">Nenhum…</p>` solto que cada
//   tela repetia: o vazio é o primeiro contato com a tela e precisa dizer
//   O QUE fazer, não só que não há nada. Server-safe (sem estado).
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  /** Uma frase: o que aparece aqui e como começa. */
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-empty-state
      className={cn(
        "border-border-strong flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed px-5 py-12 text-center",
        className
      )}
    >
      {Icon ? (
        <span className="bg-muted text-muted-foreground grid size-9 place-items-center rounded-md">
          <Icon className="size-4" aria-hidden />
        </span>
      ) : null}
      <h3 className="text-sm font-semibold">{title}</h3>
      {children ? (
        <p className="text-muted-foreground max-w-[38ch] text-xs leading-relaxed">
          {children}
        </p>
      ) : null}
      {actions ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
