// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): a proposta cobre as QUATRO ações — criar, editar,
//   concluir e excluir —, até MAX_COMMENT_TASK_ACTIONS por comentário.
//
//   O que estava errado: "liguei, ele pediu para adiar a proposta para sexta e
//   cancelar a demo de amanhã" é um editar e um excluir, e a v1.0 só sabia
//   propor criar. A IA lia isso e, no melhor caso, sugeria uma TERCEIRA
//   tarefa — deixando as duas primeiras para a pessoa fazer à mão.
//
//   `excluir` não existia no contrato: entra com `allowDelete`, um modo do
//   MESMO validador (molde do `{ selection: true }` de
//   validateRecordsUpdate). /operacao/tarefas segue sem exclusão — a decisão
//   continua valendo onde foi tomada.
//
//   Aplicar deixou de ser um `createTask` local: é o `applyTaskAction`
//   compartilhado com o assistente de tarefas, que é quem guarda o merge a
//   partir da linha atual e a fase pelo choke point próprio.
// NÚCLEO do "Salvar e analisar" da Tree — ler um comentário e decidir se ele
// pede um próximo passo com data.
//
// Padrão §4.17, sem exceção: a IA NUNCA escreve. `analyzeCommentCore` valida a
// resposta pelo MESMO `validateTasksEdit` do contrato `tarefas-edit` e devolve
// prévia; `applyCommentTaskCore` RE-VALIDA com catálogo fresco e grava só por
// `createTask`. O que a tela mostra é um cartão de um clique — quase
// automático, e ainda assim com um humano apertando o botão.
//
// Por que reusar o contrato de tarefas em vez de criar um: o objeto de saída é
// o mesmo (uma tarefa com título, prazo, hora e responsável), e um segundo
// contrato traria um segundo validador, um segundo SPEC e um segundo teste de
// paridade para dizer a mesma coisa — a régua paralela da invariante 25. O que
// esta superfície tem de próprio é o ENUNCIADO (lib/import/tasks/
// analyze-instructions.ts), o modo `allowDelete` e o TETO de ações que o
// código impõe depois de validar.
//
// Por que o apply não chama `applyTasksCore` inteiro: aquele core carrega o
// gate, o catálogo e a mensagem da OUTRA tela. O que importa não duplicar é o
// executor por ação, e ele é compartilhado (`lib/ai/apply-task-action.ts`).
// O `recordId` vai como argumento — o contrato `tarefas-edit` não carrega
// vínculo com registro de propósito, e a tarefa que nasce de um comentário
// precisa nascer NA ÁRVORE daquele registro.
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadOrgAiConfig } from "@/lib/ai/config";
import { runJsonGenerationLoop } from "@/lib/ai/json-loop";
import { todayBrasiliaIso } from "@/lib/date/today";
import { DEFAULT_TASK_PHASES, type KanbanSettings } from "@/lib/kanban/types";
import { deriveColumns } from "@/lib/kanban/columns";
import {
  buildCommentAnalysisPrompt,
  MAX_COMMENT_TASK_ACTIONS,
} from "@/lib/import/tasks/analyze-instructions";
import {
  serializeTasksEdit,
  validateTasksEdit,
} from "@/lib/import/tasks/validate";
import {
  TASKS_EDIT_FORMAT,
  TASKS_EDIT_VERSION,
  type ParsedTaskAction,
  type TaskPhaseRef,
  type TasksEditContext,
} from "@/lib/import/tasks/types";

/** Esta superfície é a única que liga a exclusão — ver o cabeçalho. */
const MODES = { allowDelete: true } as const;
import {
  applyTaskAction,
  summaryOfTaskAction,
  tituloOfTaskAction,
  type TaskFullRow,
} from "@/lib/ai/apply-task-action";

/** O que a análise devolve para a tela. `task` ausente = nada a agendar. */
export interface CommentAnalysisState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** A proposta, no formato do contrato — é ela que volta no apply. */
  json?: string;
  /** Uma linha por ação, para o cartão de confirmação. */
  acoes?: { resumo: string; destrutiva: boolean }[];
  /** Avisos do validador + a explicação do modelo quando não propôs nada. */
  notas?: string[];
}

export interface ApplyCommentTaskResultItem {
  titulo: string;
  ok: boolean;
  message?: string;
}

export interface ApplyCommentTaskState {
  ok: boolean;
  message?: string;
  errors?: string[];
  /** Resultado POR ITEM: falha de uma não aborta as outras. */
  results?: ApplyCommentTaskResultItem[];
  appliedCount?: number;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

const phaseRefs = (settings: KanbanSettings): TaskPhaseRef[] =>
  deriveColumns(settings, []).map((c) => ({
    key: c.key,
    label: c.label,
    completes: c.completesTask === true,
  }));

interface RecordContext {
  ctx: TasksEditContext;
  catalogJson: string;
  /** A linha INTEIRA por id — o `editar` parte dela (ver apply-task-action). */
  rowById: Map<string, TaskFullRow>;
  record: { title: string; stage: string | null; responsibleId: string | null };
  responsibleName: string | null;
}

/**
 * Catálogo FRESCO desta superfície (geração E apply).
 *
 * Recorte deliberadamente menor que o de `/operacao/tarefas`: só as tarefas
 * DESTE registro, porque é sobre ele que o comentário fala. O catálogo existe
 * aqui para o modelo não propor uma tarefa que já está aberta — não para lhe
 * dar acesso à agenda inteira do time. A RLS de `tasks` recorta antes disso.
 */
async function loadRecordTaskContext(
  supabase: Supabase,
  recordId: string
): Promise<RecordContext | null> {
  const [{ data: record }, { data: tasksData }, { data: respData }] =
    await Promise.all([
      supabase
        .from("records")
        .select("id, title, stage, responsible_id")
        .eq("id", recordId)
        .maybeSingle(),
      supabase
        .from("tasks")
        .select(
          "id, title, description, record_id, board_id, phase, due_date, due_time, due_time_end, responsible_id, completed_at, series_occurrence"
        )
        .eq("record_id", recordId)
        .is("parent_task_id", null)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(100),
      supabase
        .from("responsibles")
        .select("id, display_name")
        .eq("active", true)
        .order("display_name"),
    ]);
  if (!record) return null;

  const rows = (tasksData ?? []) as (TaskFullRow & {
    series_occurrence: number | null;
  })[];

  // Mesma derivação do tarefas-client: os padrões mais as fases já em uso. A
  // IA não pode oferecer uma coluna que a tela não mostra.
  const known = new Set(DEFAULT_TASK_PHASES.map((p) => p.key));
  const extras = [...new Set(rows.map((r) => r.phase))].filter(
    (p) => p && !known.has(p)
  );
  const defaultPhases = phaseRefs({
    mode: "tarefas",
    columns: [
      ...DEFAULT_TASK_PHASES,
      ...extras.map((key) => ({ key, label: key })),
    ],
  });

  const resps = ((respData ?? []) as { id: string; display_name: string | null }[])
    .map((r) => ({ id: r.id, name: (r.display_name ?? "").trim() }))
    .filter((r) => r.name !== "");
  const respNameById = new Map(resps.map((r) => [r.id, r.name]));

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
      // v1.1: excluir ocorrência de série não gruda (o tick a recria) — quem
      // recusa é o validador, e é esta chave que o alimenta.
      fromSeries: r.series_occurrence != null,
    })),
    responsibles: resps,
    // Sem quadros: a tarefa que nasce de um comentário é do registro, e
    // escolher um quadro para ela é decisão de quem organiza, não do texto.
    boards: [],
    defaultPhases,
  };

  const catalogJson = JSON.stringify(
    {
      tarefas_deste_registro: rows.map((r) => ({
        titulo: r.title,
        situacao: r.completed_at ? "concluída" : "em aberto",
        data: r.due_date,
      })),
      responsaveis: resps.map((r) => r.name),
      fases_sem_quadro: defaultPhases.map((p) => p.label),
    },
    null,
    2
  );

  return {
    ctx,
    catalogJson,
    rowById: new Map(rows.map((r) => [r.id, r])),
    record: {
      title: (record.title as string) ?? "",
      stage: (record.stage as string | null) ?? null,
      responsibleId: (record.responsible_id as string | null) ?? null,
    },
    responsibleName: record.responsible_id
      ? (respNameById.get(record.responsible_id as string) ?? null)
      : null,
  };
}

/**
 * A resposta "não há o que agendar", reconhecida ANTES do validador.
 *
 * `validateTasksEdit` recusa `acoes: []`, e com razão: em /operacao/tarefas a
 * pessoa PEDIU alguma coisa, e uma lista vazia é o modelo não tendo feito o
 * trabalho. Aqui a pergunta é outra — "vale agendar?" — e "não" é a resposta
 * mais comum. Sem este caminho, o laço tentaria três vezes e devolveria erro
 * para o comportamento CERTO.
 *
 * Não é um validador paralelo: ele não interpreta ação nenhuma. Só reconhece o
 * envelope do contrato com a lista vazia; qualquer outra coisa segue para o
 * validador de verdade.
 *
 * Exportado para teste — ele e o `narrow` são os dois pontos de decisão que só
 * existem nesta superfície, e são puros.
 */
export function readEmptyAnswer(raw: string): { notas: string[] } | null {
  let obj: unknown;
  try {
    // O laço já lida com cercas de código; aqui basta o que for JSON puro.
    obj = JSON.parse(raw.trim().replace(/^```(?:json)?|```$/g, "").trim());
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (o.formato !== TASKS_EDIT_FORMAT || o.versao !== TASKS_EDIT_VERSION) {
    return null;
  }
  if (!Array.isArray(o.acoes) || o.acoes.length > 0) return null;
  const notas = (Array.isArray(o.notas) ? o.notas : [])
    .map((n) => (typeof n === "string" ? n.trim() : ""))
    .filter((n) => n !== "");
  return { notas };
}

/**
 * O TETO desta superfície, aplicado DEPOIS do validador.
 *
 * É um estreitamento do contrato, não uma régua paralela: o que decide se o
 * JSON é válido segue sendo `validateTasksEdit` — inclusive quais ações
 * existem (o modo `allowDelete`) e a recusa de excluir ocorrência de série.
 * Aqui fica só o que é próprio da leitura de UM comentário: ele rende poucas
 * coisas, e um lote grande num cartão de um clique seria uma lista que
 * ninguém lê antes de clicar.
 */
export function narrow(
  actions: ParsedTaskAction[]
): { ok: true; actions: ParsedTaskAction[] } | { ok: false; errors: string[] } {
  if (actions.length > MAX_COMMENT_TASK_ACTIONS) {
    return {
      ok: false,
      errors: [
        `Um comentário rende no máximo ${MAX_COMMENT_TASK_ACTIONS} ações. Escolha as mais importantes e explique o resto em "notas".`,
      ],
    };
  }
  return { ok: true, actions };
}

/**
 * Lê o comentário e propõe (ou não) uma tarefa. NÃO escreve nada.
 */
export async function analyzeCommentCore(input: {
  recordId: string;
  comment: string;
}): Promise<CommentAnalysisState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const comment = input.comment.trim();
  if (!comment) return { ok: false, message: "Escreva o comentário primeiro." };

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
  const loaded = await loadRecordTaskContext(supabase, input.recordId);
  if (!loaded) return { ok: false, message: "Registro não encontrado." };

  const system = buildCommentAnalysisPrompt({
    comment,
    todayIso: todayBrasiliaIso(),
    record: {
      title: loaded.record.title,
      stage: loaded.record.stage,
      responsible: loaded.responsibleName,
    },
    catalogJson: loaded.catalogJson,
    allowDelete: MODES.allowDelete,
  });

  const result = await runJsonGenerationLoop<{
    actions: ParsedTaskAction[];
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: [],
    // O comentário já está no `system`; o turno é a pergunta.
    description:
      "Analise o comentário acima e responda com o JSON do formato combinado.",
    validate: (raw) => {
      const vazio = readEmptyAnswer(raw);
      if (vazio) return { ok: true, value: { actions: [], warnings: vazio.notas } };
      const v = validateTasksEdit(raw, loaded.ctx, MODES);
      if (!v.ok) return { ok: false, errors: v.errors };
      const n = narrow(v.actions);
      if (!n.ok) return { ok: false, errors: n.errors };
      return { ok: true, value: { actions: n.actions, warnings: v.warnings } };
    },
  });
  if (!result.ok) {
    return { ok: false, message: result.message, errors: result.errors };
  }

  const { actions, warnings } = result.value;
  if (actions.length === 0) {
    // Resposta LEGÍTIMA: o comentário não pedia próximo passo. A explicação do
    // modelo, quando vier, é mais útil que a frase genérica.
    return {
      ok: true,
      message:
        warnings[0] ?? "Comentário salvo. Não há nada a agendar a partir dele.",
      notas: warnings,
    };
  }
  return {
    ok: true,
    json: serializeTasksEdit(actions),
    // O resumo por ação tem dono único (apply-task-action.ts) — a mesma frase
    // que o assistente de /operacao/tarefas mostra na prévia dele.
    acoes: actions.map((a) => ({
      resumo: summaryOfTaskAction(a),
      destrutiva: a.acao === "excluir",
    })),
    notas: warnings,
  };
}

/**
 * Aplica a proposta: re-valida com catálogo FRESCO e cria pelo choke point.
 *
 * O `record_id` vem do ARGUMENTO (a tela), nunca do JSON — a mesma regra de
 * "o alvo vem sempre do seletor da UI" que vale em todo o §4.17. Responsável
 * padrão é o do registro: um follow-up sem dono é um follow-up que ninguém faz.
 */
export async function applyCommentTaskCore(input: {
  recordId: string;
  raw: string;
}): Promise<ApplyCommentTaskState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const supabase = await createClient();
  const loaded = await loadRecordTaskContext(supabase, input.recordId);
  if (!loaded) return { ok: false, message: "Registro não encontrado." };

  const v = validateTasksEdit(input.raw, loaded.ctx, MODES);
  if (!v.ok) {
    return {
      ok: false,
      message: "A proposta tem problemas — peça um ajuste e tente de novo.",
      errors: v.errors,
    };
  }
  const n = narrow(v.actions);
  if (!n.ok) return { ok: false, message: n.errors[0], errors: n.errors };
  if (n.actions.length === 0) return { ok: false, message: "Não há o que aplicar." };

  const results: ApplyCommentTaskResultItem[] = [];
  let appliedCount = 0;
  for (const a of n.actions) {
    // Responsável padrão do `criar`: o do registro. Um follow-up sem dono é um
    // follow-up que ninguém faz. Só quando a IA não nomeou ninguém.
    const acao: ParsedTaskAction =
      a.acao === "criar" && a.responsavel === undefined && loaded.record.responsibleId
        ? {
            ...a,
            responsavel: {
              id: loaded.record.responsibleId,
              nome: loaded.responsibleName ?? "",
            },
          }
        : a;

    const res = await applyTaskAction(acao, {
      rowById: loaded.rowById,
      recordId: input.recordId,
    });
    results.push({ titulo: tituloOfTaskAction(a), ok: res.ok, message: res.message });
    if (res.ok) appliedCount += 1;
  }

  const total = n.actions.length;
  return {
    ok: appliedCount === total,
    message:
      appliedCount === total
        ? total === 1
          ? "Aplicada."
          : `${appliedCount} ações aplicadas.`
        : appliedCount > 0
          ? `${appliedCount} de ${total} aplicadas — veja os erros por item.`
          : "Nenhuma ação aplicada — veja os erros por item.",
    results,
    appliedCount,
  };
}
