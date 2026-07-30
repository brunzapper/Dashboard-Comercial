// Versão: 1.3 | Data: 29/07/2026
// Fase 10: shell do app (client). Envolve a barra lateral + conteúdo e controla:
//  - barra OCULTA por padrão (revelada por hover numa faixa fina à esquerda),
//    FIXÁVEL por um pin discreto no topo direito da barra (pref. por usuário,
//    persistida em user_settings via updateUserSettings);
// v1.3 (29/07/2026): botão de menu (hambúrguer) quando a barra está desafixada
//   — antes o ÚNICO gatilho era a faixa de hover (aria-hidden), inalcançável
//   por toque e teclado. Escape fecha e devolve o foco; navegar fecha; falha
//   ao salvar o pin agora avisa (notifyOnError).
//  - "modo tela cheia" (AppChromeContext.toggleFullscreen): esconde o chrome E
//    entra na Fullscreen API do navegador (Esc restaura).
// O conteúdo da barra é montado no server (layout.tsx) e passado em `sidebar`.
// v1.2 (17/07/2026): marca a flag de sessão do app (lib/app-session) ao montar
//   — insumo do RestoreLastView (Home) p/ restaurar a última view só na
//   REABERTURA do app.
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
import { Menu, Pin, PinOff, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { markAppSessionActive } from "@/lib/app-session";
import { notifyOnError } from "@/lib/feedback/notify";
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
  // Abertura EXPLÍCITA (botão de menu): torna a barra alcançável por toque e
  // teclado — o hover da faixa lateral não existe nesses meios. Independente
  // de `hovering` para o mouse-leave não fechar o que o clique abriu.
  const [openedByButton, setOpenedByButton] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [, startTransition] = useTransition();

  // Marca "app aberto nesta sessão do navegador" em QUALQUER página (inclui
  // entrada direta por bookmark num board): visita posterior à Home não deve
  // redirecionar. Filhos rodam efeitos antes (React), então na entrada pela
  // própria Home o RestoreLastView ainda lê a flag ausente e restaura.
  useEffect(() => {
    markAppSessionActive();
  }, []);

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      startTransition(() =>
        void notifyOnError(
          updateUserSettings({ sidebarPinned: next }),
          "Não foi possível salvar a preferência da barra"
        )
      );
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
  const sidebarVisible = !overlay || hovering || openedByButton;

  // Escape fecha a barra aberta pelo botão e devolve o foco a ele.
  useEffect(() => {
    if (!openedByButton) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenedByButton(false);
      document.getElementById("sidebar-menu-button")?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openedByButton]);

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
            onClick={(e) => {
              // Navegar por um link fecha a barra aberta pelo botão (toque);
              // cliques em botões internos (pin, logout já navega) não fecham.
              if (!openedByButton) return;
              if ((e.target as HTMLElement).closest("a")) {
                setOpenedByButton(false);
              }
            }}
            className={cn(
              "bg-sidebar text-sidebar-foreground relative flex w-60 shrink-0 flex-col border-r p-4 transition-transform duration-200",
              overlay &&
                "fixed inset-y-0 left-0 z-40 shadow-lg " +
                  (sidebarVisible ? "translate-x-0" : "-translate-x-full")
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

        {/* Botão de menu: única forma de abrir a barra desafixada por toque ou
            teclado (a faixa de hover é aria-hidden e só reage a mouse). */}
        {overlay ? (
          <button
            type="button"
            id="sidebar-menu-button"
            onClick={() => {
              // Alterna pela VISIBILIDADE efetiva: se a barra já está à vista
              // (hover ou botão), fecha; senão abre e mantém aberta.
              if (sidebarVisible) {
                setOpenedByButton(false);
                setHovering(false);
              } else {
                setOpenedByButton(true);
              }
            }}
            aria-label={
              sidebarVisible ? "Fechar menu de navegação" : "Abrir menu de navegação"
            }
            aria-expanded={sidebarVisible}
            className={cn(
              "bg-background/80 text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring/50 fixed top-3 z-50 rounded-md border p-1.5 shadow-sm backdrop-blur transition-[left] duration-200 focus-visible:ring-[3px] focus-visible:outline-none",
              sidebarVisible ? "left-[15.5rem]" : "left-3"
            )}
          >
            {sidebarVisible ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
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
