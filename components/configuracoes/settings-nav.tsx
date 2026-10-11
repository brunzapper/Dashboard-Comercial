// Versão: 1.1 | Data: 11/10/2026
// v1.1 (11/10/2026): legibilidade. Os grupos ficavam COLADOS porque o rótulo
//   usava `first:pt-0` — e cada rótulo é o primeiro filho do PRÓPRIO grupo, então
//   a regra zerava o respiro de todos. Agora o espaço entre grupos é do
//   contêiner (`md:gap-5`) e nunca do rótulo. Rótulo de grupo em caixa-alta
//   (text-xs, linguagem do kicker) em vez de 10px solto; itens com mais folga e
//   o ativo com a mesma barrinha na cor da marca da barra lateral; filete à
//   direita separando a coluna do conteúdo.
// v1.0 (10/10/2026): MENU VERTICAL AGRUPADO de Configurações. Substitui a
//   tira de abas horizontal (settings-tabs.tsx), que com 11 sub-áreas quebrava
//   em duas linhas. NÃO é a "navegação focada" revertida na v1.7 do layout:
//   todos os itens continuam visíveis e a um clique — só passam a ficar em
//   coluna, agrupados (Organização / Dados e operação / Aparência e conta).
//   Abaixo de `md` vira uma tira horizontal com rolagem (nunca quebra linha).
//   Os itens chegam já filtrados pelo gate (allowedSettingsTabs); grupo vazio
//   não mostra rótulo.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import {
  SETTINGS_GROUP_LABELS,
  type SettingsGroup,
  type SettingsTab,
} from "@/lib/nav/settings-tabs";

const GROUP_ORDER: SettingsGroup[] = ["organizacao", "dados", "aparencia"];

export function SettingsNav({ tabs }: { tabs: SettingsTab[] }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Seções de configurações"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:sticky md:top-[46px] md:mx-0 md:flex-col md:gap-5 md:overflow-visible md:border-r md:px-0 md:pr-3 md:pb-0"
    >
      {GROUP_ORDER.map((group) => {
        const items = tabs.filter((t) => t.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="contents md:flex md:flex-col md:gap-0.5">
            <p className="text-muted-foreground hidden px-2.5 pb-1.5 text-xs font-semibold tracking-wide uppercase md:block">
              {SETTINGS_GROUP_LABELS[group]}
            </p>
            {items.map((tab) => {
              const active = isActive(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "shrink-0 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors",
                    active
                      ? "bg-brand/10 text-brand font-medium md:shadow-[inset_2px_0_0_var(--brand)]"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
