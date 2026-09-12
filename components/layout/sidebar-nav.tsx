// Versão: 1.3 | Data: 12/09/2026
// Navegação lateral (Client Component) com destaque do link ativo.
// Recebe já filtrada por papel/permissão pelo layout (server).
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
  FileInput,
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

export interface NavItem {
  href: string;
  label: string;
}

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
const LINK_ACTIVE = "bg-brand/10 text-brand";
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
  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

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
                  <span className="truncate">{item.label}</span>
                </span>
                <NavPendingHint />
              </Link>
            );
          })}
        </nav>
      ) : null}

      <nav className="flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              LINK_BASE,
              isActive(item.href) ? LINK_ACTIVE : LINK_IDLE
            )}
          >
            <span>{item.label}</span>
            <NavPendingHint />
          </Link>
        ))}
      </nav>
    </div>
  );
}
