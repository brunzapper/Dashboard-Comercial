// Versão: 1.0 | Data: 23/07/2026
// Monta o DashboardImportContext (catálogos que a validação pura precisa) a
// partir do banco. Compartilhado por importDashboardJson (colar JSON) e pela
// geração DIRETA via IA (ai-generate-actions.ts) — mesma verdade, sem duplicar
// as consultas. Recebe o client (RLS do usuário) como argumento.
import "server-only";

import { loadSources } from "@/lib/config/sources";
import type { createClient } from "@/lib/supabase/server";
import type {
  DashboardImportContext,
  ImportDefRow,
} from "@/lib/import/dashboard/types";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function loadImportContext(
  supabase: ServerClient
): Promise<DashboardImportContext> {
  const [sources, defsRes, corrRes, respRes, opRes] = await Promise.all([
    loadSources(supabase),
    supabase
      .from("field_definitions")
      .select("id, field_key, label, data_type, formula, applies_to, source_system"),
    supabase.from("field_correspondences").select("key"),
    supabase.from("responsibles").select("display_name"),
    supabase.from("operations").select("name"),
  ]);
  return {
    sources,
    defs: ((defsRes.data ?? []) as Record<string, unknown>[]).map((d) => ({
      id: String(d.id),
      field_key: String(d.field_key),
      label: String(d.label ?? d.field_key),
      data_type: d.data_type as ImportDefRow["data_type"],
      formula: (d.formula as ImportDefRow["formula"]) ?? null,
      applies_to: (d.applies_to as string[] | null) ?? null,
      source_system: (d.source_system as string | null) ?? null,
    })),
    correspondenceKeys: (corrRes.data ?? []).map((c) => String(c.key)),
    responsibleNames: (respRes.data ?? [])
      .map((r) => String((r as { display_name?: unknown }).display_name ?? ""))
      .filter(Boolean),
    operationNames: (opRes.data ?? [])
      .map((o) => String((o as { name?: unknown }).name ?? ""))
      .filter(Boolean),
  };
}
