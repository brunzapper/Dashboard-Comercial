// Versão: 1.0 | Data: 05/08/2026
// Loading das sub-abas de /operacao (nível do layout): as abas em si vêm do
// layout (ficam visíveis); o skeleton cobre só o corpo. Agenda/Tarefas têm
// loading próprio no segmento, que prevalece; este cobre Remuneração.
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Carregando operação"
    >
      <Skeleton className="h-6 w-56" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-12 w-full"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
