// Versão: 1.0 | Data: 29/07/2026
// 404 raiz: URLs sem rota correspondente (e notFound() fora dos segmentos que
// têm not-found próprio). Antes caía no 404 default do Next, em inglês.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-sm font-medium">404</p>
        <h1 className="text-xl font-semibold">Página não encontrada</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          O endereço pode estar errado ou o conteúdo foi movido.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
      >
        Ir para o início
      </Link>
    </div>
  );
}
