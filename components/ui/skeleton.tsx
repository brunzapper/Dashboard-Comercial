// Versão: 1.0 | Data: 29/07/2026
// Componente Skeleton (shadcn/ui) — bloco pulsante de carregamento. Fonte
// única do padrão `bg-muted animate-pulse` que antes era copiado à mão nos
// loading.tsx e nos fallbacks de widget.
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  );
}

export { Skeleton };
