// Versão: 1.0 | Data: 10/09/2026
// A CASCA da barra de ações em massa — pill sticky no rodapé, contador e o X.
//
// Extraída porque as classes e os nomes acessíveis estavam LITERALMENTE
// duplicados entre `components/registros/records-bulk-bar.tsx` e
// `components/kanban/bulk-action-bar.tsx`, e a seleção de tarefas ia criar a
// terceira e a quarta cópia.
//
// Os nomes acessíveis (`role="toolbar"` / "Ações em massa", o texto
// "N selecionado(s)", "Limpar seleção") são CONTRATO: os testes de seleção que
// já existem ancoram neles, e é o que faz a barra nova ser testável do mesmo
// jeito. Não os mude sem mudar os testes junto.
//
// A casca não sabe de nenhuma ação: quem monta os botões é a barra concreta.
"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function BulkBarShell({
  count,
  onClear,
  error,
  children,
}: {
  /** Itens selecionados. Zero NÃO renderiza nada — a barra some sozinha. */
  count: number;
  onClear: () => void;
  /** Falha agregada da última ação, exibida na própria barra. */
  error?: string | null;
  /** Os botões da tela concreta. */
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Ações em massa"
      className="bg-card sticky bottom-2 z-10 flex flex-wrap items-center gap-2 self-center rounded-full border px-3 py-1.5 shadow-lg"
    >
      <span className="text-sm font-medium">{count} selecionado(s)</span>
      {children}
      {error ? (
        <span className="text-destructive text-xs" role="status">
          {error}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onClear}
        aria-label="Limpar seleção"
        title="Limpar seleção (Esc)"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
