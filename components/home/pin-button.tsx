// Versão: 1.0 | Data: 12/09/2026
// Alfinete de "fixar na barra lateral" (0141). Componente PRÓPRIO, e de
// propósito FORA do BoardCardMenu: aquele menu só é renderizado para quem pode
// gerir ou duplicar o board (ele retorna null caso contrário), e fixar é
// personalização da barra de QUEM OLHA — um leitor sem permissão nenhuma
// também fixa.
//
// Save otimista em background (lib/feedback/use-background-save.ts): o alfinete
// responde na hora, a action roda sem revalidatePath e a falha reverte o
// controle com toast.
"use client";

import { useState } from "react";
import { Pin, PinOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";
import { toggleSidebarPinned } from "@/app/(app)/dashboards/actions";
import type { SidebarPinKind } from "@/lib/config/ui-prefs";

export function PinButton({
  kind,
  id,
  label,
  pinned: initialPinned,
  className,
}: {
  kind: SidebarPinKind;
  id: string;
  /** Nome do item — só para o aria-label; o que se grava é o id. */
  label: string;
  pinned: boolean;
  className?: string;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const { save, pendingKeys } = useBackgroundSave();
  const key = `${kind}:${id}`;
  const busy = pendingKeys.has(key);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        const next = !pinned;
        setPinned(next);
        save({
          key,
          context: "Não foi possível alterar os itens fixados",
          action: () => toggleSidebarPinned(kind, id),
          revert: () => setPinned(!next),
        });
      }}
      aria-pressed={pinned}
      aria-label={
        pinned
          ? `Desafixar ${label} da barra lateral`
          : `Fixar ${label} na barra lateral`
      }
      title={
        pinned ? "Desafixar da barra lateral" : "Fixar na barra lateral"
      }
      className={cn(
        "hover:bg-accent rounded-md p-1.5 transition-colors disabled:opacity-50",
        pinned ? "text-brand" : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
    </button>
  );
}
