// Versão: 1.0 | Data: 29/07/2026
// Loading de /registros (e sub-rotas bases/log/importar, como boundary mais
// próximo): header + barra de filtros + tabela. A query paginada + FK labels
// tornam esta uma das rotas mais lentas do app.
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Carregando registros"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-44" />
        <div className="ml-auto flex gap-2 pr-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-28" />
          ))}
        </div>
      </div>
      <Skeleton className="h-9 w-full max-w-xl" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-11 w-full"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
