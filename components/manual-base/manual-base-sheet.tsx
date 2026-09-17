// Versão: 1.0 | Data: 17/09/2026
// O painel "Base manual" do menu ⋮ do dashboard (0142).
//
// Carrega LAZY na abertura (molde do BoardSourcesDialog): a maioria dos
// dashboards não usa a Base manual, e a base pode ter mudado em outra aba ou
// por outra pessoa desde que a página carregou.
//
// O conteúdo é o gestor ÚNICO — o mesmo de Registros → Base manual e do widget
// "Base do Dashboard". Aqui ele vem COMPLETO (com a gestão de dados e o
// assistente de IA): é a porta de entrada de quem está montando a análise.
"use client";

import { useEffect, useState, useTransition } from "react";

import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import { ManualBaseManager } from "@/components/manual-base/manual-base-manager";
import { ManualBaseAssistant } from "@/components/manual-base/manual-base-assistant";
import {
  getManualBaseState,
  type ManualBaseState,
} from "@/app/(app)/dashboards/manual-base-actions";

export function ManualBaseSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<ManualBaseState | null>(null);
  const [, startTransition] = useTransition();

  // Recarrega a cada abertura. setState fica DENTRO da transition (regra
  // react-hooks/set-state-in-effect do projeto).
  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      setState(null);
      setState(await getManualBaseState());
    });
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <ResizableSheetContent
        storageKey="panel-w:manual-base"
        defaultWidth={860}
        className="overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Base manual</SheetTitle>
          <SheetDescription>
            Números digitados que entram nas fórmulas deste e de qualquer outro
            dashboard — mensagens enviadas, contas alcançadas, investimento. Use
            o dado como métrica ou divida registros do Sync por ele.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {!state ? (
            <p className="text-muted-foreground text-sm">Carregando…</p>
          ) : !state.ok ? (
            <p className="text-destructive text-sm">
              {state.message ?? "Não foi possível carregar a Base manual."}
            </p>
          ) : (
            <ManualBaseManager
              series={state.series}
              entries={state.entries}
              responsibles={state.responsibles}
              operations={state.operations}
              canEdit={state.canEdit}
              assistant={state.canEdit ? <ManualBaseAssistant /> : null}
            />
          )}
        </div>
      </ResizableSheetContent>
    </Sheet>
  );
}
