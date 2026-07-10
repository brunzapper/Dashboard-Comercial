// Versão: 1.0 | Data: 10/07/2026
// Loading UI específica de um dashboard: cabeçalho + barra de período + grid de
// widgets em skeleton, para a navegação até o dashboard dar feedback imediato
// enquanto os widgets são computados no servidor.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando dashboard">
      <div className="flex items-center justify-between">
        <div className="bg-muted h-8 w-64 animate-pulse rounded-md" />
        <div className="bg-muted h-8 w-40 animate-pulse rounded-md" />
      </div>
      <div className="bg-muted h-12 w-full animate-pulse rounded-lg" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-muted h-60 animate-pulse rounded-lg"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
