// Versão: 1.0 | Data: 29/07/2026
// Loading do viewer público: a page computa TODOS os widgets do snapshot no
// server — antes o destinatário externo via tela branca até a resposta.
// Skeleton fiel ao layout (header com selos + grid de cards), sempre claro.
import { Skeleton } from "@/components/ui/skeleton";

export default function SnapshotLoading() {
  return (
    <div
      className="min-h-screen bg-white p-4 text-neutral-900 md:p-6"
      aria-busy="true"
      aria-label="Carregando painel"
    >
      <div className="mb-4 flex flex-col gap-2">
        <Skeleton className="h-7 w-64 bg-neutral-200" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-40 bg-neutral-200" />
          <Skeleton className="h-5 w-48 bg-neutral-200" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-40 rounded-lg bg-neutral-200"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
