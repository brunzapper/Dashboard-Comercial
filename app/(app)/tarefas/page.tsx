// Versão: 1.0 | Data: 16/07/2026
// Página Tarefas ("Minhas tarefas"): lista/quadro por fase das tarefas
// visíveis ao usuário — a RLS de tasks (0063) escopa o vendedor às próprias
// (criador ou responsável vinculado); gestor/admin veem todas. Filtros de
// status/responsável são client-side (volume pequeno por usuário).
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { OptionItem } from "@/lib/records/types";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import { TarefasClient } from "@/components/tarefas/tarefas-client";

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tarefas</h1>
        <p className="text-muted-foreground text-sm">
          Agende, atribua e conclua tarefas — soltas, vinculadas a registros ou
          organizadas em kanbans de tarefas.
        </p>
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
