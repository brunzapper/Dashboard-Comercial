// Versão: 1.0 | Data: 17/07/2026
// Registra a última view de board (dashboard/kanban) em user_settings.lastView
// para o RestoreLastView (Home) redirecionar ao reabrir o app. Grava pathname
// + ?tab= (aba ativa — selectTab espelha na URL e o Next sincroniza
// useSearchParams); descarta focus/período (o período já é restaurado por
// user_preferences.lastPeriod). Efeito client-side: prefetch de <Link> nunca
// grava. Fire-and-forget, mesmo padrão do sidebarPinned (app-shell).
"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { updateUserSettings } from "@/app/(app)/dashboards/actions";

function TrackLastViewInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const view = tab
    ? `${pathname}?${new URLSearchParams({ tab }).toString()}`
    : pathname;
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    if (!view || view === lastSaved.current) return;
    lastSaved.current = view;
    void updateUserSettings({ lastView: view });
  }, [view]);

  return null;
}

export function TrackLastView() {
  // useSearchParams pede um boundary de Suspense (docs: prerendering).
  return (
    <Suspense fallback={null}>
      <TrackLastViewInner />
    </Suspense>
  );
}
