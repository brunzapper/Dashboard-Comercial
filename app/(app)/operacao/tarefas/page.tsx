// Versão: 1.2 | Data: 08/09/2026
// v1.2 (08/09/2026): botão "Organizar com IA" (contrato `tarefas-edit` v1) no
//   cabeçalho — a IA cria, reagenda e conclui tarefas com prévia e apply pelos
//   choke points de lib/tasks/actions.ts. maxDuration = 300 pelo orçamento do
//   turno (AI_LOOP_TURN_BUDGET_MS = 240s).
// Versão: 1.1 | Data: 05/08/2026
// Página Tarefas ("Minhas tarefas"): lista/quadro por fase das tarefas
// visíveis ao usuário — a RLS de tasks (0063) escopa o vendedor às próprias
// (criador ou responsável vinculado); gestor/admin veem todas. Filtros de
// status/responsável são client-side (volume pequeno por usuário).
// v1.1 (05/08/2026): movida de /tarefas p/ /operacao/tarefas — card padrão de
// Operação no hub (saiu do nav lateral; /tarefas virou stub de redirect).
import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfigPublic } from "@/lib/ai/config";
import type { OptionItem } from "@/lib/records/types";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import { TarefasClient } from "@/components/tarefas/tarefas-client";
import { TasksAiSheet } from "@/components/tarefas/tasks-ai-sheet";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Tarefas" };
// Turno do assistente de IA tem orçamento de 240s (AI_LOOP_TURN_BUDGET_MS).
export const maxDuration = 300;

export default async function TarefasPage() {
  const session = await getSessionInfo();
  if (!session) return null; // proxy já redireciona sem sessão
  const viewAll = session.permissions.includes("view_all_records");
  const isManager =
    session.roles.includes("admin") || session.roles.includes("gestor");

  const supabase = await createClient();
  const [{ data: tasksData }, { data: respData }] = await Promise.all([
    supabase
      .from("tasks")
      .select(TASK_COLS_WITH_RECORD)
      // Subtarefas vivem no feed da tarefa pai, não na lista/quadro.
      .is("parent_task_id", null)
      .order("completed_at", { ascending: true, nullsFirst: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("due_time", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("responsibles")
      .select("id, display_name")
      .eq("active", true)
      .order("display_name"),
  ]);
  const tasks = (tasksData ?? []) as unknown as TaskRow[];
  const responsibles: OptionItem[] = (respData ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
  }));

  const ai = await loadOrgAiConfigPublic(await getActiveOrgId());

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tarefas</h1>
          <p className="text-muted-foreground text-sm">
            Agende, atribua e conclua tarefas — soltas, vinculadas a registros ou
            organizadas em kanbans de tarefas.
          </p>
        </div>
        <TasksAiSheet ai={ai} />
      </div>
      <TarefasClient
        tasks={tasks}
        responsibles={responsibles}
        canFilterResponsible={viewAll}
        taskCtx={{
          responsibles,
          canAssignOthers: viewAll,
          canLock: isManager,
        }}
      />
    </div>
  );
}
