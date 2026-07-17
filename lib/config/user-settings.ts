// Versão: 1.0 | Data: 17/07/2026
// Loader das configurações do usuário (user_settings.settings) com React
// cache(): layout (sidebarPinned) e sino (tasksSeenAt) liam a MESMA linha em
// consultas separadas a cada navegação — com cache(), 1 consulta por
// render/request. Quem grava (ex.: markTasksSeen) segue lendo/escrevendo
// direto — a próxima request enxerga o valor novo.
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export const loadUserSettings = cache(async function loadUserSettings(
  userId: string
): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.settings as Record<string, unknown> | null) ?? {};
});
