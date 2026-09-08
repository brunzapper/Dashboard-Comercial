// Versão: 1.0 | Data: 08/09/2026
// Esqueleto do formulário — espelha o corpo (título + campos + botão).
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}
