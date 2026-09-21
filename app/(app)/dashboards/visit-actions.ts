"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/** Só abertura real registra acesso; prefetch e prévia não chamam esta action. */
export async function recordWorkspaceVisit(path: string): Promise<void> {
  const match = /^\/(dashboards|kanbans|kanbans\/w)\/([0-9a-f-]{36})$/.exec(path);
  if (!match) return;
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  const widget = match[1] === "kanbans/w";
  // O client do usuário aplica a RLS do alvo, inclusive bloqueios de board.
  const { data } = widget
    ? await supabase.from("widgets").select("id, dashboards!inner(status)")
        .eq("id", match[2]).eq("visual_type", "kanban")
        .neq("dashboards.status", "trashed").maybeSingle()
    : await supabase.from("dashboards").select("id")
        .eq("id", match[2]).eq("kind", match[1] === "kanbans" ? "kanban" : "dashboard")
        .neq("status", "trashed").maybeSingle();
  if (!data) return;
  const { error } = await supabase.from("workspace_visits").upsert({
    user_id: session.user.id, path, last_opened_at: new Date().toISOString(),
  }, { onConflict: "user_id,path" });
  if (!error) revalidatePath("/", "page");
}
