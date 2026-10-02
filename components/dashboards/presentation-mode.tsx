// Versão: 1.3 | Data: 02/10/2026
// v1.3 (02/10/2026): (a) a barra flutuante SE ESCONDE: some após 2 s sem
//   interação e só volta com o ponteiro 1 s parado perto da borda de baixo
//   (useAutoHideBar) — numa apresentação a barra competia com o slide. (b)
//   "Exportar PDF" saiu da barra e foi para o menu ⋮ do dashboard (abaixo de
//   Snapshots); `printSlides(onDone)` avisa o fim da impressão para o painel
//   sair do modo, e `usePresentationMode({ keepOnFullscreenExit })` não
//   encerra o modo quando o diálogo de impressão tira a tela cheia.
// v1.2 (02/10/2026): botão "Exportar PDF" na barra (printSlides: um slide por
//   página 16:9 pela impressão do navegador; regras em globals.css).
// Versão: 1.1 | Data: 01/10/2026
// v1.1 (01/10/2026): `ready` — enquanto os slides preparam (pré-render, ver
//   presentation-warmup.tsx) só a saída responde ao teclado. A tela cheia é
//   pedida JÁ no clique (o navegador só a concede com o gesto ainda fresco) e
//   cobre a espera; navegar fica para quando tudo estiver pronto.
// Modo APRESENTAR do dashboard: cada aba vira um slide, em tela cheia, com o
// painel VIVO (widgets interativos, laser disponível). Navegação por teclado
// (←/→, PageUp/PageDown, espaço, Home/End, Esc) e pela barra flutuante.
//
// A troca de slide é a MESMA troca de aba do board (`selectTab` → `?tab=`):
// nenhum segundo estado de "aba atual". A regra de navegação é pura
// (lib/dashboards/presentation.ts). Estado efêmero — nada persiste.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MousePointer2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  isTypingTarget,
  presentationKeyAction,
  stepSlide,
} from "@/lib/dashboards/presentation";

/**
 * Teclado + tela cheia enquanto `active`. Sair da tela cheia pelo navegador
 * (Esc nativo) também encerra o modo.
 */
export function usePresentationMode(opts: {
  active: boolean;
  slideIds: string[];
  currentId: string;
  onSelect: (id: string) => void;
  onExit: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  /** v1.1: false = preparando (só Esc responde). Ausente = pronto. */
  ready?: boolean;
  /** v1.3: exportando PDF — sair da tela cheia (o diálogo de impressão o faz)
   * não encerra o modo; quem encerra é o fim da impressão. */
  keepOnFullscreenExit?: boolean;
}) {
  const { active, slideIds, currentId, onSelect, onExit, containerRef } = opts;
  const ready = opts.ready ?? true;
  const keepRef = useRef(opts.keepOnFullscreenExit === true);
  useEffect(() => {
    keepRef.current = opts.keepOnFullscreenExit === true;
  }, [opts.keepOnFullscreenExit]);

  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    // Tela cheia é melhoria, não requisito (iframe/permissão negam): o modo
    // segue funcionando como sobreposição fixa.
    if (el && !document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => undefined);
    }
    const onFs = () => {
      if (!document.fullscreenElement && !keepRef.current) onExit();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
    // Entrar/sair é o que importa; trocar de slide não refaz a tela cheia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (isTypingTarget(e.target)) return;
      const action = presentationKeyAction(e.key);
      if (!action) return;
      e.preventDefault();
      if (action === "exit") return onExit();
      if (!ready) return; // v1.1: preparando — ainda não navega.
      const next = stepSlide(slideIds, currentId, action);
      if (next !== currentId) onSelect(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, ready, slideIds, currentId, onSelect, onExit]);
}

export function PresentationBar({
  slideIds,
  currentId,
  title,
  onSelect,
  onExit,
  laserMode,
  onLaserChange,
}: {
  slideIds: string[];
  currentId: string;
  title: string;
  onSelect: (id: string) => void;
  onExit: () => void;
  laserMode: boolean;
  onLaserChange: (on: boolean) => void;
}) {
  const idx = Math.max(0, slideIds.indexOf(currentId));
  const go = (action: "prev" | "next") => {
    const next = stepSlide(slideIds, currentId, action);
    if (next !== currentId) onSelect(next);
  };
  const bar = useAutoHideBar();
  return (
    <div
      data-visible={bar.visible || undefined}
      aria-hidden={bar.visible ? undefined : true}
      onPointerEnter={bar.onEnter}
      onPointerLeave={bar.onLeave}
      onFocus={bar.onEnter}
      onBlur={bar.onLeave}
      className={cn(
        "bg-background/90 fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border px-2 py-1 shadow-lg backdrop-blur transition-opacity duration-300",
        bar.visible ? "opacity-100" : "pointer-events-none opacity-0"
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-full"
        aria-label="Slide anterior"
        disabled={idx === 0}
        onClick={() => go("prev")}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-28 px-1 text-center text-sm">
        <span className="font-medium">{title || "Slide"}</span>
        <span className="text-muted-foreground ml-2 tabular-nums">
          {idx + 1}/{slideIds.length}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-full"
        aria-label="Próximo slide"
        disabled={idx >= slideIds.length - 1}
        onClick={() => go("next")}
      >
        <ChevronRight className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8 rounded-full", laserMode && "bg-red-500/15 text-red-600")}
        aria-label={laserMode ? "Desligar ponteiro laser" : "Ligar ponteiro laser"}
        title="Ponteiro laser"
        onClick={() => onLaserChange(!laserMode)}
      >
        <MousePointer2 className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-full"
        aria-label="Sair da apresentação"
        title="Sair (Esc)"
        onClick={onExit}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

/**
 * v1.2 (02/10/2026): imprime os slides — `body[data-printing="slides"]` liga as
 * regras de impressão de globals.css (só as camadas de slide aparecem, uma por
 * página 1280×720, com as cores de fundo). O navegador oferece "Salvar como
 * PDF". A marca sai no `afterprint` (e logo após o print, que bloqueia).
 */
export function printSlides(onDone?: () => void) {
  if (typeof window === "undefined") return;
  const body = document.body;
  let done = false;
  const clear = () => {
    if (done) return;
    done = true;
    delete body.dataset.printing;
    window.removeEventListener("afterprint", clear);
    onDone?.();
  };
  body.dataset.printing = "slides";
  window.addEventListener("afterprint", clear);
  window.print();
  // `print()` bloqueia até o diálogo fechar na maioria dos navegadores; onde
  // não bloqueia, o `afterprint` acima chega depois e é ignorado (done).
  if (!("onafterprint" in window)) clear();
}

// ------------------------------------------------------------- barra oculta

/** v1.3: tempos da barra (exportados para os testes). */
export const BAR_HIDE_AFTER_MS = 2000;
export const BAR_REVEAL_AFTER_MS = 1000;
/** Faixa inferior da tela (px) em que a proximidade revela a barra. */
export const BAR_REVEAL_ZONE_PX = 96;

/**
 * v1.3: a barra começa visível, some após `BAR_HIDE_AFTER_MS` sem interação
 * e só reaparece com o ponteiro `BAR_REVEAL_AFTER_MS` contínuos na faixa de
 * baixo (sair da faixa antes cancela). Com o ponteiro ou o foco DENTRO dela,
 * não some. O teclado de navegação não a mostra — interromperia o slide.
 */
export function useAutoHideBar() {
  const [visible, setVisible] = useState(true);
  const inside = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const revealTimer = useRef<number | null>(null);

  const clearHide = () => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const clearReveal = () => {
    if (revealTimer.current != null) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
  };
  const scheduleHide = useCallback(() => {
    clearHide();
    hideTimer.current = window.setTimeout(() => {
      if (!inside.current) setVisible(false);
    }, BAR_HIDE_AFTER_MS);
  }, []);

  // Entrada: visível e contando para sumir.
  useEffect(() => {
    scheduleHide();
    return () => {
      clearHide();
      clearReveal();
    };
  }, [scheduleHide]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const near = e.clientY >= window.innerHeight - BAR_REVEAL_ZONE_PX;
      if (!near) {
        clearReveal();
        return;
      }
      if (visible) {
        // Perto e já visível: interação — adia o sumiço.
        if (!inside.current) scheduleHide();
        return;
      }
      if (revealTimer.current == null) {
        revealTimer.current = window.setTimeout(() => {
          revealTimer.current = null;
          setVisible(true);
          scheduleHide();
        }, BAR_REVEAL_AFTER_MS);
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [visible, scheduleHide]);

  const onEnter = useCallback(() => {
    inside.current = true;
    clearHide();
  }, []);
  const onLeave = useCallback(() => {
    inside.current = false;
    scheduleHide();
  }, [scheduleHide]);

  return { visible, onEnter, onLeave };
}
