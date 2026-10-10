// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): BARRA DE LOCAL — a âncora fina (38px) no topo do
//   conteúdo. Substitui os dois controles FLUTUANTES (o ⋮ fixo no canto
//   esquerdo e o sino fixo no direito), que dividiam o canto com o título de
//   cada página e obrigavam 8 cabeçalhos a carregar `pr-8` e o <main> a ter
//   `pl-12`. Agora há um lugar para eles:
//     [menu] Painéis / Comercial — Sudeste ······················ [sino]
//   O botão de menu só existe com a barra lateral SOLTA (fixada, ela já está
//   à vista). As migalhas sobem um nível (lib/nav/breadcrumbs.ts) — o BackLink
//   das páginas segue sendo o "voltar à tela anterior".
//   Fundo: a mesma superfície da janela (--app-surface, quando um dashboard
//   pinta o entorno) com blur; a borda inferior só aparece depois de rolar.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { MoreVertical, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { breadcrumbsFor } from "@/lib/nav/breadcrumbs";
import { useLocationTitle } from "./location-title-context";

export function LocationBar({
  showMenuButton,
  menuOpen,
  onToggleMenu,
  right,
}: {
  showMenuButton: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  right?: ReactNode;
}) {
  const pathname = usePathname();
  const leaf = useLocationTitle();
  const crumbs = breadcrumbsFor(pathname, leaf);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // Só no evento (setState síncrono no corpo do efeito cai na regra
    // react-hooks/set-state-in-effect); a página abre no topo.
    const onScroll = () => setScrolled(window.scrollY > 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      data-location-bar
      className={cn(
        "sticky top-0 z-30 flex h-[38px] shrink-0 items-center gap-1.5 border-b px-3 backdrop-blur transition-colors",
        scrolled ? "border-border" : "border-transparent"
      )}
    >
      {showMenuButton ? (
        <button
          type="button"
          id="sidebar-menu-button"
          onClick={onToggleMenu}
          aria-label={
            menuOpen ? "Fechar menu de navegação" : "Abrir menu de navegação"
          }
          aria-expanded={menuOpen}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 grid size-6 shrink-0 place-items-center rounded-sm focus-visible:ring-[3px] focus-visible:outline-none"
        >
          {menuOpen ? <X className="size-4" /> : <MoreVertical className="size-4" />}
        </button>
      ) : null}
      <nav
        aria-label="Você está em"
        className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs"
      >
        {crumbs.map((c, i) => (
          <Fragment key={`${i}:${c.label}`}>
            {i > 0 ? (
              <span aria-hidden className="opacity-55">
                /
              </span>
            ) : null}
            {c.href ? (
              <Link
                href={c.href}
                className="hover:bg-accent hover:text-foreground shrink-0 rounded-sm px-1.5 py-0.5 font-medium"
              >
                {c.label}
              </Link>
            ) : (
              <span
                aria-current="page"
                className="text-foreground truncate px-0.5 font-medium"
              >
                {c.label}
              </span>
            )}
          </Fragment>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1">{right}</div>
    </div>
  );
}
