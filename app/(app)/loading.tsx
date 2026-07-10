// Versão: 1.0 | Data: 10/07/2026
// Loading UI do segmento autenticado (app). Cobre TODAS as páginas filhas: numa
// navegação pelo menu lateral (layout já montado), só a página troca e este
// fallback aparece na hora — elimina o "trava e nada acontece" ao clicar.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando">
      <div className="bg-muted h-8 w-56 animate-pulse rounded-md" />
      <div className="bg-muted h-9 w-full max-w-md animate-pulse rounded-md" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-muted h-28 animate-pulse rounded-lg"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
