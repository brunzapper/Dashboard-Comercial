// Versão: 1.0 | Data: 18/07/2026
// Badge discreto em /registros: "N alteração(ões) aguardando envio ao Bitrix".
// Observabilidade da fila de write-back (bitrix_writeback_queue) sem bloquear
// nada — as edições entram na fila e o tick por minuto as drena; aqui só
// mostramos que há itens a caminho, com link p/ Configurações → Log (detalhe +
// "Reenfileirar"). Polling leve (30s) pausado com a aba oculta (padrão do
// SyncPanel); some quando a fila está vazia. A contagem vem de
// getWritebackPendingCount (RLS: só gestor/admin enxergam a fila).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getWritebackPendingCount } from "@/app/(app)/registros/sync-actions";

const POLL_MS = 30_000;

export function WritebackPendingBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const n = await getWritebackPendingCount();
        if (active) setCount(n);
      } catch {
        /* ignora falhas transitórias de polling */
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    // Voltou para a aba → atualiza na hora (sem esperar o próximo tick).
    document.addEventListener("visibilitychange", poll);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  if (count === 0) return null;
  return (
    <Link
      href="/configuracoes/log"
      className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors"
      title="Ver o log de write-back (Configurações → Log)"
    >
      <span className="bg-primary inline-block size-1.5 animate-pulse rounded-full" />
      {count === 1
        ? "1 alteração aguardando envio ao Bitrix"
        : `${count} alterações aguardando envio ao Bitrix`}
    </Link>
  );
}
