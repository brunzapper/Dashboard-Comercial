// Versão: 1.0 | Data: 10/10/2026
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
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:sticky md:top-[46px] md:mx-0 md:flex-col md:gap-px md:overflow-visible md:px-0 md:pb-0"
    >
      {GROUP_ORDER.map((group) => {
        const items = tabs.filter((t) => t.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="contents md:flex md:flex-col md:gap-px">
            <p className="text-muted-foreground text-2xs hidden px-2 pt-2.5 pb-1 font-semibold first:pt-0 md:block">
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
                    "shrink-0 rounded-sm px-2 py-1.5 text-sm whitespace-nowrap transition-colors md:py-1",
                    active
                      ? "bg-brand/10 text-brand font-semibold"
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
