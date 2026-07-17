// Versão: 1.0 | Data: 17/07/2026
// Home: restaura a última view de board (user_settings.lastView) SOMENTE em
// sessão nova do navegador (lib/app-session) — reabrir o app volta ao board em
// que o usuário estava. Visita à Home durante o uso não redireciona e LIMPA o
// lastView (fechar na Home = reabrir na Home). O alvo chega validado do server
// (HomePage: forma da rota + board presente na lista visível por RLS).
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { isFreshAppSession, markAppSessionActive } from "@/lib/app-session";
import { updateUserSettings } from "@/app/(app)/dashboards/actions";

export function RestoreLastView({
  target,
  hadStored,
}: {
  // Rota validada para restaurar (null = nada a restaurar).
  target: string | null;
  // Havia lastView gravado (mesmo inválido)? Visita in-session limpa.
  hadStored: boolean;
}) {
  const router = useRouter();
  // Guard por instância: StrictMode (dev) roda o efeito 2x na MESMA montagem —
  // sem isso, a 2ª execução veria a flag já marcada e limparia o lastView logo
  // após restaurar. Navegação de verdade cria instância nova (ref zerada).
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const fresh = isFreshAppSession();
    markAppSessionActive();
    if (fresh) {
      if (target) router.replace(target);
    } else if (hadStored) {
      void updateUserSettings({ lastView: null });
    }
  }, [target, hadStored, router]);

  return null;
}
