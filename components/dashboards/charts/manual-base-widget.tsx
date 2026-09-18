// Versão: 1.0 | Data: 17/09/2026
// Widget "Base do Dashboard" (0142): a grade dos números DIGITADOS, editável
// dentro do painel. Ele não consulta registro nenhum — é o MESMO gestor da
// página Registros → Base manual e do menu ⋮, em modo `compact`.
//
// Os dados vêm por action (getManualBaseState) em vez de props da page: a
// maioria dos dashboards não usa a Base manual, e descer a base inteira em
// toda renderização do painel seria peso sem uso. O gatilho de re-busca é o
// CARIMBO da base (useManualBaseStamp): salvar aqui agenda o router.refresh()
// do padrão de save em background, o RSC devolve um carimbo novo, e este
// widget — e os demais, pelo fingerprint deferido — recarregam.
"use client";

import { useEffect, useState, useTransition } from "react";

import { ManualBaseManager } from "@/components/manual-base/manual-base-manager";
import { useManualBaseStamp } from "@/components/manual-base/manual-base-stamp-context";
import {
  getManualBaseState,
  type ManualBaseState,
} from "@/app/(app)/dashboards/manual-base-actions";
import type { BaseManualSettings } from "@/lib/widgets/types";

export function ManualBaseWidget({ settings }: { settings?: BaseManualSettings }) {
  const stamp = useManualBaseStamp();
  const [state, setState] = useState<ManualBaseState | null>(null);
  const [, startTransition] = useTransition();

  // Carga inicial e recarga por carimbo. setState fica DENTRO da transition
  // (regra react-hooks/set-state-in-effect do projeto).
  useEffect(() => {
    startTransition(async () => {
      const s = await getManualBaseState();
      setState(s);
    });
  }, [stamp]);

  if (!state) {
    return (
      <p className="text-muted-foreground p-3 text-sm">Carregando a Base manual…</p>
    );
  }
  if (!state.ok) {
    return (
      <p className="text-muted-foreground p-3 text-sm">
        {state.message ?? "Não foi possível carregar a Base manual."}
      </p>
    );
  }

  return (
    <div className="h-full overflow-auto p-2">
      <ManualBaseManager
        series={state.series}
        entries={state.entries}
        responsibles={state.responsibles}
        operations={state.operations}
        families={state.families}
        members={state.members}
        declarations={state.declarations}
        canEdit={state.canEdit}
        compact
        onlySeries={settings?.series}
      />
    </div>
  );
}
