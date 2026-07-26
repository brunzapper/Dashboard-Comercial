// Versão: 1.0 | Data: 26/07/2026
// Loader das PASTAS DE BASES (source_folders, 0107) — agrupamento de
// EXIBIÇÃO das bases; ver lib/source-folders.ts (helpers puros).
// Mesma resiliência de lib/config/sources.ts: tabela ausente (migração
// pendente) ou erro devolve [] e toda a UI degrada para as listas planas de
// sempre. orgId opcional filtra a org ATIVA (multi-org/Owner); a RLS já
// escopa às orgs do usuário. O viewer público /s/[token] NÃO carrega pastas
// (nenhum picker/aba lá).
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SourceFolder } from "@/lib/source-folders";

export const loadSourceFolders = cache(async function loadSourceFolders(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<SourceFolder[]> {
  try {
    let query = supabase
      .from("source_folders")
      .select("id, label, sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (orgId) query = query.eq("organization_id", orgId);
    const { data, error } = await query;
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      label: (r.label as string) || "",
      sortOrder: Number(r.sort_order ?? 0),
    }));
  } catch {
    return [];
  }
});
