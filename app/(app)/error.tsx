// Versão: 1.0 | Data: 29/07/2026
// Boundary de erro do segmento autenticado: qualquer exceção não tratada num
// RSC/page filho (timeout de RPC, Supabase fora) cai aqui em vez da tela crua
// do Next. Mantém o chrome (layout sobrevive) e oferece recuperação.
"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Trilha p/ correlacionar com o log do servidor (error.digest).
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold">Algo deu errado</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Não foi possível carregar esta página. Pode ser algo passageiro —
          tente de novo.
          {error?.digest ? ` (código ${error.digest})` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={() => unstable_retry()}>Tentar novamente</Button>
        <Button variant="outline" asChild>
          <Link href="/">Ir para o Workspace</Link>
        </Button>
      </div>
    </div>
  );
}
