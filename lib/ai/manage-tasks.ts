// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): o executor por ação saiu para `lib/ai/apply-task-action.ts`
// — o "Salvar e analisar" da Tree passou a aplicar as mesmas ações, e uma
// segunda cópia reencontraria uma a uma as armadilhas descritas abaixo. Esta
// superfície NÃO liga a exclusão (`allowDelete` ausente): apagar em lote a
// partir de linguagem natural, numa tela de lista, é destrutivo demais — a
// decisão continua onde foi tomada.
// NÚCLEO do assistente de IA de TAREFAS (/operacao/tarefas → "Organizar com
// IA"). Padrão §4.17 — a IA NUNCA escreve: generateTasksCore valida o lote
// (lib/import/tasks/validate — títulos resolvidos contra o catálogo FRESCO,
// fases contra o quadro efetivo) e devolve prévia; applyTasksCore RE-VALIDA
// com contexto fresco e aplica item a item SÓ pelos choke points existentes
// (createTask/updateTask/completeTask/moveTaskPhase). A muralha é a RLS de
// `tasks` (0063) — nada de service role, e nenhum gate de papel: tarefa é de
// todo mundo, e o vendedor só enxerga (logo, só referencia) as suas.
//
// A armadilha do `updateTask`: ele monta o UPDATE a partir do FormData
// INTEIRO — chave ausente vira null. Editar só a data com um form parcial
// apagaria descrição, responsável e, pior, o vínculo com o registro. Por isso
// o apply parte da LINHA ATUAL e sobrepõe o delta.
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { aiSection, runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { deriveColumns } from "@/lib/kanban/columns";
import { DEFAULT_TASK_PHASES, type KanbanSettings } from "@/lib/kanban/types";
import type { DashboardSettings } from "@/lib/widgets/types";
import { buildTasksPromptText } from "@/lib/import/tasks/instructions";
import { validateTasksEdit } from "@/lib/import/tasks/validate";
import type {
  ParsedTaskAction,
  TaskPhaseRef,
  TasksEditContext,
} from "@/lib/import/tasks/types";
import {
  applyTaskAction,
  summaryOfTaskAction,
  tituloOfTaskAction,
  type TaskFullRow,
} from "@/lib/ai/apply-task-action";

export interface GenerateTasksInput {
  description: string;
  priorTurns?: string[];
  /** Prévia pendente — a resposta SUBSTITUI a proposta inteira. */
  pendingJson?: string;
}

export interface GenerateTasksState {
  ok: boolean;
  message?: string;
  errors?: string[];
  actions?: ParsedTaskAction[];
  summary?: string[];
  warnings?: string[];
}

export interface ApplyTasksResultItem {
  index: number;
  titulo: string;
  ok: boolean;
  message?: string;
}

export interface ApplyTasksState {
  ok: boolean;
  message?: string;
  errors?: string[];
  results?: ApplyTasksResultItem[];
  appliedCount?: number;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function gate(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  return null;
}

interface LoadedContext {
  ctx: TasksEditContext;
  catalogJson: string;
  rowById: Map<string, TaskFullRow>;
}

const phaseRefs = (settings: KanbanSettings): TaskPhaseRef[] =>
  deriveColumns(settings, []).map((c) => ({
    key: c.key,
    label: c.label,
    completes: c.completesTask === true,
  }));

/**
 * Contexto FRESCO (geração E apply): tarefas VISÍVEIS (a RLS já filtra),
 * responsáveis ativos e os quadros de tarefas com as colunas de cada um.
 */
async function loadTasksEditContext(supabase: Supabase): Promise<LoadedContext> {
  const [{ data: tasksData }, { data: respData }, { data: boardsData }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, description, record_id, board_id, phase, due_date, due_time, due_time_end, responsible_id, completed_at, series_occurrence"
        )
        // Subtarefas vivem no feed do pai, não são cards — fora do contrato.
        .is("parent_task_id", null)
        .order("completed_at", { ascending: true, nullsFirst: true })
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(300),
      supabase
        .from("responsibles")
        .select("id, display_name")
        .eq("active", true)
        .order("display_name"),
      supabase
        .from("dashboards")
        .select("id, name, settings")
        .eq("kind", "kanban")
        .order("name"),
    ]);

  const rows = (tasksData ?? []) as (TaskFullRow & {
    series_occurrence: number | null;
  })[];
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // Fases da tela "Minhas tarefas": os padrões MAIS as fases já em uso por
  // tarefas de quadro (mesma derivação do tarefas-client — a IA não pode
  // oferecer uma coluna que a tela não mostra).
  const known = new Set(DEFAULT_TASK_PHASES.map((p) => p.key));
  const extras = [...new Set(rows.map((r) => r.phase))].filter(
    (p) => p && !known.has(p)
  );
  const defaultPhases = phaseRefs({
    mode: "tarefas",
    columns: [...DEFAULT_TASK_PHASES, ...extras.map((key) => ({ key, label: key }))],
  });

  // Só quadros em modo TAREFAS — um kanban de registros não recebe tarefa.
  const boards: TasksEditContext["boards"] = [];
  for (const b of (boardsData ?? []) as {
    id: string;
    name: string | null;
    settings: unknown;
  }[]) {
    const kanban = (b.settings as DashboardSettings | null)?.kanban;
    if (!kanban || kanban.mode !== "tarefas") continue;
    const nome = (b.name ?? "").trim();
    if (!nome) continue;
    boards.push({ id: b.id, name: nome, phases: phaseRefs(kanban) });
  }

  const boardNameById = new Map(boards.map((b) => [b.id, b.name]));
  const respNameById = new Map(
    ((respData ?? []) as { id: string; display_name: string | null }[]).map(
      (r) => [r.id, (r.display_name ?? "").trim()]
    )
  );

  const ctx: TasksEditContext = {
    tasks: rows.map((r) => ({
      id: r.id,
      title: r.title,
      phase: r.phase,
      boardId: r.board_id,
      completed: r.completed_at != null,
      responsibleId: r.responsible_id,
      dueDate: r.due_date,
      dueTime: r.due_time,
      // Esta superfície não exclui, então nada consulta a chave — mas o
      // catálogo é um só, e mentir aqui esconderia o alvo do dia em que ela
      // ligar a exclusão.
      fromSeries: r.series_occurrence != null,
    })),
    responsibles: ((respData ?? []) as { id: string; display_name: string | null }[])
      .map((r) => ({ id: r.id, name: (r.display_name ?? "").trim() }))
      .filter((r) => r.name !== ""),
    boards,
    defaultPhases,
  };

  const catalogJson = JSON.stringify(
    {
      tarefas: rows.map((r) => ({
        titulo: r.title,
        situacao: r.completed_at ? "concluída" : "em aberto",
        quadro: r.board_id ? (boardNameById.get(r.board_id) ?? null) : null,
        fase: r.phase,
        responsavel: r.responsible_id
          ? (respNameById.get(r.responsible_id) ?? null)
          : null,
        data: r.due_date,
        hora: r.due_time ? r.due_time.slice(0, 5) : null,
      })),
      responsaveis: ctx.responsibles.map((r) => r.name),
      quadros: boards.map((b) => ({
        nome: b.name,
        fases: b.phases.map((p) => p.label),
      })),
      fases_sem_quadro: defaultPhases.map((p) => p.label),
    },
    null,
    2
  );

  return { ctx, catalogJson, rowById };
}

export async function generateTasksCore(
  input: GenerateTasksInput
): Promise<GenerateTasksState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const description = input.description.trim();
  if (!description)
    return { ok: false, message: "Descreva o que quer fazer com as tarefas." };

  const orgId = await getActiveOrgId();
  const aiConfig = orgId ? await loadOrgAiConfig(orgId) : null;
  if (!aiConfig) {
    return {
      ok: false,
      message:
        "IA não configurada para a organização — um administrador define o provedor em Configurações → Integrações.",
    };
  }

  const supabase = await createClient();
  const { ctx, catalogJson } = await loadTasksEditContext(supabase);

  let system = buildTasksPromptText({ catalogJson });
  const pending = (input.pendingJson ?? "").trim();
  if (pending) {
    system += aiSection(
      "PRÉVIA PENDENTE (AINDA NÃO APLICADA)",
      "No turno anterior você propôs as ações abaixo e o usuário AINDA NÃO " +
        "confirmou. Sua resposta deste turno SUBSTITUI a proposta INTEIRA: " +
        "re-inclua as ações que continuarem desejadas.\n\n" +
        pending
    );
  }

  const result = await runJsonGenerationLoop<{
    actions: ParsedTaskAction[];
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: input.priorTurns ?? [],
    description,
    validate: (raw) => {
      const v = validateTasksEdit(raw, ctx);
      if (!v.ok) return { ok: false, errors: v.errors };
      return { ok: true, value: { actions: v.actions, warnings: v.warnings } };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }
  const { actions, warnings } = result.value;
  return {
    ok: true,
    message: "Prévia pronta — revise as ações e confirme a aplicação.",
    actions,
    summary: actions.map((a, i) => `${i + 1}. ${summaryOfTaskAction(a)}`),
    warnings,
  };
}

/** Valida um JSON COLADO (fluxo de IA externa) — mesma prévia, sem IA. */
export async function previewTasksCore(raw: string): Promise<GenerateTasksState> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  if (!raw.trim()) return { ok: false, message: "Cole o JSON devolvido pela IA." };
  const supabase = await createClient();
  const { ctx } = await loadTasksEditContext(supabase);
  const v = validateTasksEdit(raw, ctx);
  if (!v.ok) {
    return {
      ok: false,
      message: "O JSON tem problemas — corrija na IA externa e cole de novo.",
      errors: v.errors,
    };
  }
  return {
    ok: true,
    message: "Prévia pronta — revise as ações e confirme a aplicação.",
    actions: v.actions,
    summary: v.actions.map((a, i) => `${i + 1}. ${summaryOfTaskAction(a)}`),
    warnings: v.warnings,
  };
}

/** Prompt completo p/ IA externa: MESMO SPEC do chat + catálogo atual. */
export async function buildTasksPromptCore(): Promise<{
  ok: boolean;
  prompt?: string;
  message?: string;
}> {
  const err = await gate();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  const { catalogJson } = await loadTasksEditContext(supabase);
  return { ok: true, prompt: buildTasksPromptText({ catalogJson }) };
}

export async function applyTasksCore(raw: string): Promise<ApplyTasksState> {
  const err = await gate();
  if (err) return { ok: false, message: err };

  const supabase = await createClient();
  const { ctx, rowById } = await loadTasksEditContext(supabase);
  const validation = validateTasksEdit(raw, ctx);
  if (!validation.ok) {
    return {
      ok: false,
      message: "A proposta tem problemas — peça um ajuste e tente de novo.",
      errors: validation.errors,
    };
  }
  const actions = validation.actions;
  const results: ApplyTasksResultItem[] = [];
  let appliedCount = 0;

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const item: ApplyTasksResultItem = {
      index: i,
      titulo: tituloOfTaskAction(a),
      ok: false,
    };
    results.push(item);

    // O executor é o MESMO da Tree (lib/ai/apply-task-action.ts) — é ele que
    // guarda o merge a partir da linha atual e a fase pelo choke point.
    // Sem `recordId`: nesta tela a tarefa criada nasce solta.
    const res = await applyTaskAction(a, { rowById });
    if (!res.ok) {
      item.message = res.message;
      continue;
    }
    item.ok = true;
    appliedCount += 1;
  }

  const total = actions.length;
  const message =
    appliedCount === total
      ? `${appliedCount} ação(ões) aplicada(s).`
      : appliedCount > 0
        ? `${appliedCount} de ${total} ações aplicadas — veja os erros por item.`
        : "Nenhuma ação aplicada — veja os erros por item.";
  return { ok: appliedCount === total, message, results, appliedCount };
}
