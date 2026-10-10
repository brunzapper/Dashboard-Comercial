// Versão: 1.5 | Data: 10/10/2026
// v1.5 (10/10/2026): itens fixos com ÍCONE e contagem opcional, ativo com
//   barrinha interna na marca; Painéis acende também em /dashboards e /kanbans.
// Navegação lateral (Client Component) com destaque do link ativo.
// Recebe já filtrada por papel/permissão pelo layout (server).
// v1.4 (03/10/2026): item fixado com nome cortado (dashboard, kanban…) mostra o
//   nome inteiro em tooltip ao passar o mouse — só quando não cabe.
// v1.3 (12/09/2026): seção "Fixados" (0141) — dashboards, kanbans e módulos de
//   Operação que o usuário alfinetou no hub. Vem ACIMA dos itens fixos: é o
//   atalho do dia a dia dele. Os rótulos são resolvidos no servidor a partir do
//   que a RLS devolve, então item excluído ou sem acesso simplesmente não chega
//   aqui — a barra nunca oferece link quebrado.
// v1.2 (27/07/2026): item ativo na cor da marca (bg-brand/10 + text-brand,
//   configurável em Configurações → Tema); hover segue neutro.
// v1.1 (10/07/2026): spinner por link (useLinkStatus) — feedback imediato ao
//   clicar, enquanto a página de destino carrega (complementa o loading.tsx).
"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Database,
  FileInput,
  Layers,
  Settings,
  HandCoins,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Loader2,
  Shuffle,
  SquareKanban,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { OverflowTooltip } from "@/components/ui/overflow-tooltip";

export interface NavItem {
  href: string;
  label: string;
  /** v1.5 (10/10/2026): ícone do item fixo (chave de NAV_ICONS). */
  icon?: NavIconKey;
  /** v1.5: número ao lado do rótulo (ex.: tarefas exigindo atenção). */
  count?: number;
  /** v1.5: prefixos que também ativam o item (Painéis ⇐ /dashboards…). */
  matches?: string[];
}

// v1.5 (10/10/2026): ícones dos itens FIXOS — chave serializável (o item é
// montado no servidor e o componente de ícone não atravessa a fronteira).
const NAV_ICONS = {
  paineis: LayoutDashboard,
  operacao: LayoutGrid,
  registros: Database,
  campos: Layers,
  configuracoes: Settings,
} satisfies Record<string, LucideIcon>;
export type NavIconKey = keyof typeof NAV_ICONS;

/** Item fixado já resolvido pelo servidor (rótulo + destino existentes). */
export interface PinnedNavItem extends NavItem {
  /** Escolhe o ícone; "operacao" ainda desdobra pela key do card. */
  kind: "dashboard" | "kanban" | "widget-kanban" | "operacao";
  /** Key do card de Operação (só quando kind === "operacao"). */
  cardKey?: string;
}

// Mesmo vocabulário visual do hub — o usuário reconhece o item pelo ícone que
// já viu no card.
const OPERACAO_ICONS: Record<string, LucideIcon> = {
  agenda: CalendarDays,
  tarefas: ListChecks,
  remuneracao: HandCoins,
  mapeamentos: Shuffle,
  workflow: Workflow,
};

function pinnedIcon(item: PinnedNavItem): LucideIcon {
  if (item.kind === "dashboard") return LayoutDashboard;
  if (item.kind === "kanban" || item.kind === "widget-kanban") {
    return SquareKanban;
  }
  if (item.cardKey?.startsWith("form:")) return FileInput;
  return OPERACAO_ICONS[item.cardKey ?? ""] ?? LayoutGrid;
}

// Deve ser descendente de um <Link>: reflete o estado "pending" da navegação.
function NavPendingHint() {
  const { pending } = useLinkStatus();
  return (
    <Loader2
      aria-hidden
      className={cn(
        "size-4 shrink-0 animate-spin transition-opacity",
        pending ? "opacity-100" : "opacity-0"
      )}
    />
  );
}

const LINK_BASE =
  "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors";
// v1.5 (10/10/2026): item ativo com a barrinha interna de 2px na marca — o
// fundo sozinho some em telas lavadas/projetores.
const LINK_ACTIVE = "bg-brand/10 text-brand shadow-[inset_2px_0_0_var(--brand)]";
const LINK_IDLE =
  "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

export function SidebarNav({
  items,
  pinned = [],
}: {
  items: NavItem[];
  pinned?: PinnedNavItem[];
}) {
  const pathname = usePathname();
  const isActive = (href: string, matches: string[] = []) =>
    pathname === href ||
    (href !== "/" && pathname.startsWith(`${href}/`)) ||
    matches.some((m) => pathname === m || pathname.startsWith(`${m}/`));

  return (
    <div className="flex flex-col gap-3">
      {pinned.length > 0 ? (
        <nav className="flex flex-col gap-1" aria-label="Fixados">
          <p className="text-muted-foreground px-3 pb-0.5 text-xs font-medium">
            Fixados
          </p>
          {pinned.map((item) => {
            const Icon = pinnedIcon(item);
            return (
              <Link
                key={`${item.kind}:${item.href}`}
                href={item.href}
                className={cn(
                  LINK_BASE,
                  isActive(item.href) ? LINK_ACTIVE : LINK_IDLE
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="size-4 shrink-0" />
                  {/* v1.4: nome cortado mostra o nome inteiro no hover. */}
                  <OverflowTooltip text={item.label} side="right">
                    <span className="truncate">{item.label}</span>
                  </OverflowTooltip>
                </span>
                <NavPendingHint />
              </Link>
            );
          })}
        </nav>
      ) : null}

      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon ? NAV_ICONS[item.icon] : null;
          const active = isActive(item.href, item.matches);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(LINK_BASE, active ? LINK_ACTIVE : LINK_IDLE)}
            >
              <span className="flex min-w-0 items-center gap-2">
                {Icon ? <Icon className="size-4 shrink-0 opacity-85" /> : null}
                <span className="truncate">{item.label}</span>
              </span>
              <span className="flex items-center gap-1.5">
                {item.count ? (
                  <span className="text-muted-foreground text-micro tabular-nums">
                    {item.count > 99 ? "99+" : item.count}
                  </span>
                ) : null}
                <NavPendingHint />
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
