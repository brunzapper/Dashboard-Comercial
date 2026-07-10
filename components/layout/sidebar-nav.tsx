// Versão: 1.1 | Data: 10/07/2026
// Navegação lateral (Client Component) com destaque do link ativo.
// Recebe já filtrado por papel/permissão pelo layout (server).
// v1.1 (10/07/2026): spinner por link (useLinkStatus) — feedback imediato ao
//   clicar, enquanto a página de destino carrega (complementa o loading.tsx).
"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
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

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <span>{item.label}</span>
            <NavPendingHint />
          </Link>
        );
      })}
    </nav>
  );
}
