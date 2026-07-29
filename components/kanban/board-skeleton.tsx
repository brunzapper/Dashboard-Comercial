// Versão: 1.0 | Data: 29/07/2026
// Skeleton do quadro kanban — compartilhado pelos loading.tsx de
// /kanbans/[id] e /kanbans/w/[widgetId] (toolbar + colunas com cards).
import { Skeleton } from "@/components/ui/skeleton";

export function BoardSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Carregando quadro"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-56" />
        <div className="ml-auto flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24" />
          ))}
        </div>
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="flex w-64 shrink-0 flex-col gap-2">
            <Skeleton
              className="h-7 w-full"
              style={{ animationDelay: `${col * 80}ms` }}
            />
            {Array.from({ length: 3 - (col % 2) }).map((_, card) => (
              <Skeleton
                key={card}
                className="h-24 w-full rounded-lg"
                style={{ animationDelay: `${(col + card) * 80}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
