// Versão: 1.0 | Data: 29/07/2026
// 404 do segmento autenticado: captura notFound() de dashboards/[id],
// kanbans/[id] etc. MANTENDO o chrome do app (sidebar), em vez de derrubar o
// usuário no 404 raiz sem navegação.
import Link from "next/link";

export default function AppNotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-sm font-medium">404</p>
        <h1 className="text-xl font-semibold">Não encontrado</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Este dashboard, kanban ou página não existe — ou você não tem acesso
          a ele.
        </p>
      </div>
      <Link
        href="/"
        className="hover:bg-accent rounded-md border px-4 py-2 text-sm font-medium"
      >
        Ir para o Workspace
      </Link>
    </div>
  );
}
