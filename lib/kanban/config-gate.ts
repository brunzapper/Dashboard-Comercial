// Versão: 1.0 | Data: 28/07/2026
// Gate de CONFIGURAÇÃO de um quadro kanban (widget ou board dedicado): admin
// || dono || board_access 'edit' — o mesmo canConfig da page /kanbans/[id].
// Extraído de lib/kanban/automations/actions.ts (compartilhado com a
// alocação-como-campo); leituras com o client do USUÁRIO — RLS prova a
// visibilidade. Fora de arquivo "use server" de propósito: helper síncrono à
// sessão, não uma action exportável.
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { KanbanOwner } from "./data";

export async function ensureKanbanConfigGate(
  owner: KanbanOwner
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  let dashboardId = owner.id;
  if (owner.kind === "widget") {
    const { data: w } = await supabase
      .from("widgets")
      .select("dashboard_id")
      .eq("id", owner.id)
      .maybeSingle();
    if (!w) return { ok: false, message: "Widget não encontrado." };
    dashboardId = w.dashboard_id as string;
  }
  if (session.roles.includes("admin")) return { ok: true };
  const { data: d } = await supabase
    .from("dashboards")
    .select("owner_user_id")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!d) return { ok: false, message: "Quadro não encontrado." };
  if (d.owner_user_id === session.user.id) return { ok: true };
  const { data: access } = await supabase
    .from("board_access")
    .select("level")
    .eq("dashboard_id", dashboardId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (access?.level === "edit") return { ok: true };
  return { ok: false, message: "Sem permissão para configurar este quadro." };
}
