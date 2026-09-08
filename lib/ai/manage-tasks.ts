// Versão: 1.0 | Data: 08/09/2026
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
  completeTask,
  createTask,
  moveTaskPhase,
  updateTask,
} from "@/lib/tasks/actions";

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

/** Linha crua do catálogo — o apply precisa dela inteira para o merge. */
interface TaskFullRow {
  id: string;
  title: string;
  description: string | null;
  record_id: string | null;
  board_id: string | null;
  phase: string;
  due_date: string | null;
  due_time: string | null;
  due_time_end: string | null;
  responsible_id: string | null;
  completed_at: string | null;
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
          "id, title, description, record_id, board_id, phase, due_date, due_time, due_time_end, responsible_id, completed_at"
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

  const rows = (tasksData ?? []) as TaskFullRow[];
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

function summaryOf(a: ParsedTaskAction): string {
  if (a.acao === "concluir") return `concluir · "${a.alvo.titulo}"`;
  const parts: string[] = [];
  if (a.acao === "criar") {
    parts.push(`criar · "${a.titulo}"`);
    if (a.quadro) parts.push(`quadro: ${a.quadro.nome}`);
  } else {
    parts.push(`editar · "${a.alvo.titulo}"`);
    if (a.novoTitulo) parts.push(`renomear p/ "${a.novoTitulo}"`);
  }
  if (a.responsavel !== undefined)
    parts.push(a.responsavel ? `responsável: ${a.responsavel.nome}` : "sem responsável");
  if (a.data !== undefined) parts.push(a.data ? `data: ${a.data}` : "sem prazo");
  if (a.hora !== undefined && a.hora)
    parts.push(a.hora_fim ? `${a.hora}–${a.hora_fim}` : `às ${a.hora}`);
  if (a.fase) parts.push(`fase: ${a.fase.label}`);
  if (a.descricao !== undefined)
    parts.push(a.descricao === null ? "limpar descrição" : "com descrição");
  return parts.join(" · ");
}

const tituloOf = (a: ParsedTaskAction): string =>
  a.acao === "criar" ? a.titulo : a.alvo.titulo;

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
    summary: actions.map((a, i) => `${i + 1}. ${summaryOf(a)}`),
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
    summary: v.actions.map((a, i) => `${i + 1}. ${summaryOf(a)}`),
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

/** Converte o par hora/hora_fim já validado para os campos do form. */
function timeFields(
  atual: { due_time: string | null; due_time_end: string | null },
  a: { hora?: string | null; hora_fim?: string | null }
): { hora: string; horaFim: string } {
  const hora = a.hora !== undefined ? (a.hora ?? "") : (atual.due_time ?? "");
  // Sem hora inicial não pode haver final (CHECK 0111) — limpar a hora limpa
  // as duas, como faz o form da tela.
  if (!hora) return { hora: "", horaFim: "" };
  const horaFim =
    a.hora_fim !== undefined ? (a.hora_fim ?? "") : (atual.due_time_end ?? "");
  return { hora: hora.slice(0, 5), horaFim: horaFim ? horaFim.slice(0, 5) : "" };
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
    const item: ApplyTasksResultItem = { index: i, titulo: tituloOf(a), ok: false };
    results.push(item);

    if (a.acao === "concluir") {
      const res = await completeTask(a.alvo.id);
      if (!res.ok) {
        item.message = res.message ?? "Falha ao concluir.";
        continue;
      }
      item.ok = true;
      appliedCount += 1;
      continue;
    }

    if (a.acao === "criar") {
      const { hora, horaFim } = timeFields(
        { due_time: null, due_time_end: null },
        a
      );
      const fd = new FormData();
      fd.set("title", a.titulo);
      if (a.descricao) fd.set("description", a.descricao);
      if (a.data) fd.set("due_date", a.data);
      if (hora) fd.set("due_time", hora);
      if (horaFim) fd.set("due_time_end", horaFim);
      if (a.responsavel) fd.set("responsible_id", a.responsavel.id);
      if (a.quadro) fd.set("board_id", a.quadro.id);
      if (a.fase) fd.set("phase", a.fase.key);
      const res = await createTask({}, fd);
      if (!res.ok) {
        item.message = res.message ?? "Falha ao criar.";
        continue;
      }
      item.ok = true;
      appliedCount += 1;
      continue;
    }

    // ---- editar. O updateTask escreve o UPDATE a partir do form INTEIRO:
    // chave ausente vira null. Partimos da linha ATUAL para não apagar
    // descrição, responsável e o vínculo com o REGISTRO ao mexer só na data.
    const atual = rowById.get(a.alvo.id);
    if (!atual) {
      item.message = "A tarefa não existe mais.";
      continue;
    }
    const { hora, horaFim } = timeFields(atual, a);
    const fd = new FormData();
    fd.set("id", atual.id);
    fd.set("title", a.novoTitulo ?? atual.title);
    const descricao =
      a.descricao !== undefined ? a.descricao : atual.description;
    if (descricao) fd.set("description", descricao);
    const data = a.data !== undefined ? a.data : atual.due_date;
    if (data) fd.set("due_date", data);
    if (hora) fd.set("due_time", hora);
    if (horaFim) fd.set("due_time_end", horaFim);
    const respId =
      a.responsavel !== undefined
        ? (a.responsavel?.id ?? null)
        : atual.responsible_id;
    if (respId) fd.set("responsible_id", respId);
    // Vínculo com registro: preservado SEMPRE (o contrato não o edita).
    if (atual.record_id) fd.set("record_id", atual.record_id);

    const res = await updateTask({}, fd);
    if (!res.ok) {
      item.message = res.message ?? "Falha ao salvar.";
      continue;
    }
    // Fase é choke point PRÓPRIO (moveTaskPhase) — o updateTask não a toca.
    if (a.fase && a.fase.key !== atual.phase) {
      const mv = await moveTaskPhase(atual.id, a.fase.key, a.fase.completes);
      if (!mv.ok) {
        item.message = `Tarefa salva, mas a fase falhou: ${mv.message ?? ""}`.trim();
        continue;
      }
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
