// Versão: 1.1 | Data: 16/07/2026
// Fase 10: shell do app (client). Envolve a barra lateral + conteúdo e controla:
//  - barra OCULTA por padrão (revelada por hover numa faixa fina à esquerda),
//    FIXÁVEL por um pin discreto no topo direito da barra (pref. por usuário,
//    persistida em user_settings via updateUserSettings);
//  - "modo tela cheia" (AppChromeContext.toggleFullscreen): esconde o chrome E
//    entra na Fullscreen API do navegador (Esc restaura).
// O conteúdo da barra é montado no server (layout.tsx) e passado em `sidebar`.
// v1.1 (16/07/2026): `topRight` — controle flutuante no topo-direito (sino de
//   alertas de tarefas), oculto no modo tela cheia.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Pin, PinOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { updateUserSettings } from "@/app/(app)/dashboards/actions";

interface AppChrome {
  chromeHidden: boolean;
  setChromeHidden: (v: boolean) => void;
  toggleFullscreen: () => void;
}

const AppChromeContext = createContext<AppChrome | null>(null);

export function useAppChrome(): AppChrome {
  const ctx = useContext(AppChromeContext);
  if (!ctx) throw new Error("useAppChrome deve ser usado dentro de <AppShell>");
  return ctx;
}

export function AppShell({
  initialPinned,
  sidebar,
  topRight,
  children,
}: {
  initialPinned: boolean;
  sidebar: ReactNode;
  // Controle flutuante no topo-direito (ex.: sino de alertas).
  topRight?: ReactNode;
  children: ReactNode;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [hovering, setHovering] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [, startTransition] = useTransition();

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      startTransition(() => void updateUserSettings({ sidebarPinned: next }));
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      setChromeHidden(true);
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      // sair da fullscreen dispara 'fullscreenchange', que restaura o chrome.
      void document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) setChromeHidden(false);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // overlay = barra flutuante (não empurra o conteúdo) quando não fixada.
  const overlay = !pinned && !chromeHidden;

  // Referência estável do value: o shell re-renderiza a cada hover da sidebar
  // (setHovering) — objeto novo por render re-renderizava todos os
  // consumidores de useAppChrome (páginas inteiras) a cada hover.
  const chromeValue = useMemo<AppChrome>(
    () => ({ chromeHidden, setChromeHidden, toggleFullscreen }),
    [chromeHidden, toggleFullscreen]
  );

  return (
    <AppChromeContext.Provider value={chromeValue}>
      <div className="flex min-h-screen">
        {!chromeHidden ? (
          <aside
            onMouseLeave={() => overlay && setHovering(false)}
            className={cn(
              "bg-sidebar text-sidebar-foreground relative flex w-60 shrink-0 flex-col border-r p-4 transition-transform duration-200",
              overlay &&
                "fixed inset-y-0 left-0 z-40 shadow-lg " +
                  (hovering ? "translate-x-0" : "-translate-x-full")
            )}
          >
            <button
              type="button"
              onClick={togglePin}
              aria-label={pinned ? "Desafixar barra lateral" : "Fixar barra lateral"}
              aria-pressed={pinned}
              className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent absolute top-2 right-2 rounded-md p-1.5 transition-colors"
            >
              {pinned ? (
                <PinOff className="size-4" />
              ) : (
                <Pin className="size-4" />
              )}
            </button>
            {sidebar}
          </aside>
        ) : null}

        {/* Faixa fina de hover: revela a barra flutuante quando não fixada. */}
        {overlay ? (
          <div
            aria-hidden
            onMouseEnter={() => setHovering(true)}
            className="fixed inset-y-0 left-0 z-30 w-2"
          />
        ) : null}

        {!chromeHidden ? topRight : null}

        <main
          className={cn(
            "flex-1 overflow-auto",
            chromeHidden ? "p-0" : "p-6"
          )}
        >
          {children}
        </main>
      </div>
    </AppChromeContext.Provider>
  );
}
