// Versão: 1.0 | Data: 05/07/2026
// Tela de Metas (admin) — Fase 6B.
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { OptionItem } from "@/lib/records/types";
import { GoalsManager, type GoalRow } from "@/components/admin/goals-manager";

export default async function MetasPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [{ data: goalsData }, { data: ops }, { data: resps }] = await Promise.all([
    supabase
      .from("goals")
      .select(
        "id, period_year, period_month, scope, metric, target, operations(name), responsibles(display_name)"
      )
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: true, nullsFirst: true }),
    supabase.from("operations").select("id, name").order("name"),
    supabase.from("responsibles").select("id, display_name").eq("active", true).order("display_name"),
  ]);

  const goals: GoalRow[] = (goalsData ?? []).map((g) => ({
    id: g.id as string,
    period_year: g.period_year as number,
    period_month: (g.period_month as number) ?? null,
    scope: g.scope as string,
    operation_name: (g.operations as { name?: string } | null)?.name ?? null,
    responsible_name:
      (g.responsibles as { display_name?: string } | null)?.display_name ?? null,
    metric: g.metric as string,
    target: Number(g.target),
  }));

  const operations: OptionItem[] = (ops ?? []).map((o) => ({
    id: o.id as string,
    label: o.name as string,
  }));
  const responsibles: OptionItem[] = (resps ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Metas</h1>
        <p className="text-muted-foreground text-sm">
          Defina metas por período e escopo (global, operação ou responsável).
          Na leitura, elas se comunicam por roll-up (responsáveis → operação → global).
        </p>
      </div>
      <GoalsManager goals={goals} operations={operations} responsibles={responsibles} />
    </div>
  );
}
