// Versão: 1.0 | Data: 29/07/2026
// Loading das abas de Configurações (nível do layout do hub): as abas em si
// vêm do layout (ficam visíveis); o skeleton cobre só o corpo da aba.
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-busy="true"
      aria-label="Carregando configurações"
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
