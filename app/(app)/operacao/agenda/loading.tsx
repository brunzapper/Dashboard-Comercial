// Versão: 1.0 | Data: 29/07/2026
// Loading da Agenda do workspace: toolbar + grade de calendário.
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Carregando agenda"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-40" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={`h${i}`} className="h-6 w-full" />
        ))}
        {Array.from({ length: 35 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-20 w-full"
            style={{ animationDelay: `${(i % 7) * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
