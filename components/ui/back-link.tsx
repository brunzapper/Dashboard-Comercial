// Versão: 2.0 | Data: 12/09/2026
// Botão "voltar" ÚNICO do app (o padrão visual estava copiado em três formas:
// docs de Integrações, telas do Workflow e links de texto nas sub-páginas de
// Registros).
//
// v2.0 (12/09/2026): volta para a tela ANTERIOR, não para um destino fixo. A
// v1.0 sempre levava ao `href` informado, e isso mandava para o Workspace quem
// tinha chegado ali de /registros ou de um dashboard — "voltar" apontando para
// um lugar onde a pessoa não estava. O destino agora sai do rastro de
// navegação (lib/nav/history.ts) e o `fallback` vale quando não há rastro:
// primeira tela da sessão, link colado, aba nova.
//
// Segue sendo um <Link> com href concreto, nunca router.back(): com o back do
// histórico, quem entrou direto pela URL sairia do app.
"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { previousRoute, routeLabel } from "@/lib/nav/history";

export function BackLink({
  fallback,
  fallbackLabel,
  className,
}: {
  /** Destino quando não há tela anterior nesta aba do navegador. */
  fallback: string;
  /** Nome do destino de fallback (ex.: "Workspace"). */
  fallbackLabel: string;
  className?: string;
}) {
  // A rota atual sai de window.location, e não de useSearchParams: aquele hook
  // exige fronteira de Suspense para o build prerenderizar, e isto aqui é um
  // botão que aparece em meia dúzia de telas. Inicializador de useState = roda
  // uma vez por montagem, no cliente; no servidor o primeiro paint usa o
  // fallback e a montagem corrige.
  const [target] = useState(() => {
    if (typeof window === "undefined") {
      return { href: fallback, label: fallbackLabel };
    }
    const current = window.location.pathname + window.location.search;
    const prev = previousRoute(current);
    return prev
      ? { href: prev, label: routeLabel(prev) }
      : { href: fallback, label: fallbackLabel };
  });

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={className ? `gap-1 ${className}` : "gap-1"}
    >
      <Link href={target.href} aria-label={`Voltar para ${target.label}`}>
        <ArrowLeft className="size-4" />
        {target.label}
      </Link>
    </Button>
  );
}
