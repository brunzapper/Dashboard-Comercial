// Versão: 1.0 | Data: 12/09/2026
// Registra a rota atual no rastro de navegação (lib/nav/history.ts) a cada
// mudança de tela. É o que permite ao BackLink voltar para onde a pessoa
// estava, em vez de um destino fixo.
//
// Escrita em sessionStorage num efeito — sistema externo, que é exatamente
// para o que efeito serve; nada de estado React aqui (não há nada a
// re-renderizar). Renderiza null.
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { trackRoute } from "@/lib/nav/history";

export function RouteTracker() {
  // Só o pathname: useSearchParams exigiria fronteira de Suspense, e mudar de
  // query (trocar a base em /registros, a aba do dashboard) é a MESMA tela —
  // "voltar" ali deve sair dela, não desfazer o último filtro. A query entra no
  // rastro mesmo assim, lida do window na hora de gravar.
  const pathname = usePathname();

  useEffect(() => {
    trackRoute(pathname + window.location.search);
  }, [pathname]);

  return null;
}
