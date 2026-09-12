// Versão: 1.0 | Data: 12/09/2026
// Resolve os itens FIXADOS na barra lateral (user_settings.settings.sidebarItems,
// 0141) em links prontos: id/key → rótulo + rota.
//
// Duas regras que valem para sempre:
//  - O que a consulta NÃO devolver some da barra. Board excluído, arquivado,
//    enviado à lixeira ou perdido por permissão nunca vira link quebrado — e a
//    RLS é quem decide, não uma checagem paralela aqui.
//  - A ORDEM é a que o usuário fixou, não a do banco.
//
// Custo: o layout autenticado roda em TODA página, então nada é consultado
// quando a lista está vazia (o caso de quase todo mundo) e cada família custa no
// máximo uma consulta com `in`.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SidebarPin } from "@/lib/config/ui-prefs";
import { widgetKanbanHref } from "@/lib/kanban/hub";
import type { PinnedNavItem } from "@/components/layout/sidebar-nav";
import type { OperacaoCard } from "@/lib/operacao/cards";

export async function resolveSidebarPins(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  pins: SidebarPin[],
  orgId: string | null,
  /** Cards de Operação já recortados por área (allowedOperacaoCards). */
  operacaoCards: OperacaoCard[]
): Promise<PinnedNavItem[]> {
  if (pins.length === 0) return [];

  const boardIds = pins
    .filter((p) => p.kind === "dashboard" || p.kind === "kanban")
    .map((p) => p.id);
  const widgetIds = pins
    .filter((p) => p.kind === "widget-kanban")
    .map((p) => p.id);

  const [boards, widgets] = await Promise.all([
    boardIds.length > 0
      ? (async () => {
          let q = supabase
            .from("dashboards")
            .select("id, name, kind")
            .in("id", boardIds)
            .eq("status", "active");
          if (orgId) q = q.eq("organization_id", orgId);
          const { data } = await q;
          return (data ?? []) as { id: string; name: string; kind: string }[];
        })()
      : Promise.resolve([]),
    widgetIds.length > 0
      ? (async () => {
          const { data } = await supabase
            .from("widgets")
            .select("id, title")
            .in("id", widgetIds)
            .eq("visual_type", "kanban");
          return (data ?? []) as { id: string; title: string | null }[];
        })()
      : Promise.resolve([]),
  ]);

  const boardById = new Map(boards.map((b) => [b.id, b]));
  const widgetById = new Map(widgets.map((w) => [w.id, w]));
  const cardByKey = new Map(operacaoCards.map((c) => [c.key, c]));

  const out: PinnedNavItem[] = [];
  for (const pin of pins) {
    if (pin.kind === "operacao") {
      // Card que sumiu do catálogo (feature desligada, área negada) some da
      // barra — a mesma régua dos cards do hub, sem checagem paralela.
      const card = cardByKey.get(pin.id);
      if (card) {
        out.push({
          kind: "operacao",
          cardKey: card.key,
          href: card.href,
          label: card.label,
        });
      }
      continue;
    }
    if (pin.kind === "widget-kanban") {
      const w = widgetById.get(pin.id);
      if (w) {
        out.push({
          kind: "widget-kanban",
          href: widgetKanbanHref(w.id),
          label: w.title?.trim() || "Kanban (sem título)",
        });
      }
      continue;
    }
    const b = boardById.get(pin.id);
    // O kind precisa BATER com o que foi fixado: um board que virou kanban (ou
    // o contrário) mudaria de rota, e /dashboards/<id> daria 404.
    if (!b) continue;
    const isKanban = b.kind === "kanban";
    if (isKanban !== (pin.kind === "kanban")) continue;
    out.push({
      kind: isKanban ? "kanban" : "dashboard",
      href: isKanban ? `/kanbans/${b.id}` : `/dashboards/${b.id}`,
      label: b.name,
    });
  }
  return out;
}
