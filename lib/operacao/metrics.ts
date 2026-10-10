// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): NÚMERO VIVO dos cards de Operação ("12 vencem até hoje",
//   "2 falharam em 7 dias"). Um botão esticado com o nome da rota não dá
//   motivo para clicar; um número dá — e diz onde é urgente antes de entrar.
//
//   Regras:
//   - Client RLS do USUÁRIO (nunca service role): cada um vê o número do que
//     pode ver. Consultas de tabela com organização levam a org EXPLÍCITA.
//   - Best-effort: falha (tabela ausente, RLS) ⇒ card sem número, nunca erro
//     na tela. As consultas rodam em paralelo e SÓ nas páginas que exibem os
//     cards de Operação — o layout autenticado não chama isto.
//   - Contagem por `head: true` (sem trazer linhas). Frases e tons moram em
//     metric-format.ts (puro, testado).
//   - Formulários (key `form:`) ficam sem número de propósito.
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { todayBrasiliaIso } from "@/lib/date/today";
import { listDueTasks } from "@/lib/tasks/actions";
import {
  agendaMetric,
  closingMetric,
  daysUntilMonthEnd,
  failedRunsMetric,
  mappingsMetric,
  tasksMetric,
  type OperacaoMetric,
} from "./metric-format";

type Loader = () => Promise<OperacaoMetric | null>;

export async function loadOperacaoMetrics(
  cardKeys: string[],
  orgId: string | null
): Promise<Record<string, OperacaoMetric>> {
  const supabase = await createClient();
  const today = todayBrasiliaIso();
  const keys = new Set(cardKeys);

  const loaders: Record<string, Loader> = {
    // O MESMO recorte do sino (regra de notificação), com janela zero:
    // vencidas + vencendo hoje.
    tarefas: async () => tasksMetric((await listDueTasks(0)).length),
    agenda: async () => {
      const { count, error } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .is("completed_at", null)
        .eq("due_date", today);
      return error ? null : agendaMetric(count ?? 0);
    },
    remuneracao: async () => closingMetric(daysUntilMonthEnd(today)),
    workflow: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      let q = supabase
        .from("workflow_runs")
        .select("id", { count: "exact", head: true })
        .in("status", ["error", "partial"])
        .gte("created_at", since);
      if (orgId) q = q.eq("organization_id", orgId);
      const { count, error } = await q;
      return error ? null : failedRunsMetric(count ?? 0);
    },
    mapeamentos: async () => {
      let q = supabase
        .from("value_mappings")
        .select("id", { count: "exact", head: true });
      if (orgId) q = q.eq("organization_id", orgId);
      const { count, error } = await q;
      return error ? null : mappingsMetric(count ?? 0);
    },
  };

  const entries = await Promise.all(
    Object.entries(loaders)
      .filter(([key]) => keys.has(key))
      .map(async ([key, load]) => {
        try {
          return [key, await load()] as const;
        } catch {
          return [key, null] as const;
        }
      })
  );
  const out: Record<string, OperacaoMetric> = {};
  for (const [key, metric] of entries) if (metric) out[key] = metric;
  return out;
}
