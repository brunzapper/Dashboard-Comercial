// Versão: 1.0 | Data: 05/07/2026
// Tela de Responsáveis (admin) — Fase 6B.
import { createClient } from "@/lib/supabase/server";
import { requireSettingsArea } from "@/lib/auth/access";
import type { OptionItem } from "@/lib/records/types";
import {
  ResponsiblesManager,
  type ResponsibleRow,
} from "@/components/admin/responsibles-manager";

export default async function ResponsaveisPage() {
  await requireSettingsArea("responsaveis");
  const supabase = await createClient();

  const [{ data: resps }, { data: ops }, { data: maps }] = await Promise.all([
    supabase
      .from("responsibles")
      .select("id, display_name, bitrix_user_id, active")
      .order("display_name"),
    supabase.from("operations").select("id, name").order("name"),
    supabase
      .from("responsible_operations")
      .select("responsible_id, operation_id, priority, operations(name)"),
  ]);

  const opsById = new Map((ops ?? []).map((o) => [o.id as string, o.name as string]));
  const mapByResp = new Map<string, ResponsibleRow["ops"]>();
  for (const m of maps ?? []) {
    const rid = m.responsible_id as string;
    const arr = mapByResp.get(rid) ?? [];
    arr.push({
      operation_id: m.operation_id as string,
      operation_name:
        (m.operations as { name?: string } | null)?.name ??
        opsById.get(m.operation_id as string) ??
        "—",
      priority: (m.priority as number) ?? 1,
    });
    mapByResp.set(rid, arr);
  }

  const responsibles: ResponsibleRow[] = (resps ?? []).map((r) => ({
    id: r.id as string,
    display_name: r.display_name as string,
    bitrix_user_id: (r.bitrix_user_id as string) ?? null,
    active: r.active as boolean,
    ops: mapByResp.get(r.id as string) ?? [],
  }));

  const operations: OptionItem[] = (ops ?? []).map((o) => ({
    id: o.id as string,
    label: o.name as string,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Responsáveis</h1>
        <p className="text-muted-foreground text-sm">
          Ative/desative quem aparece nos dropdowns e mapeie operações (a de
          prioridade 1 é a padrão puxada nas vendas).
        </p>
      </div>
      <ResponsiblesManager responsibles={responsibles} operations={operations} />
    </div>
  );
}
