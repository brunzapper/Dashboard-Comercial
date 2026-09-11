// Versão: 1.2 | Data: 11/09/2026
// v1.2 (11/09/2026): a análise virou CONVERSA, e ela mora numa linha
//   (`tree_ai_threads`, 0139) em vez de num `useState` do widget.
//
//   Três coisas que só a persistência resolve: a segunda tentativa deixa de
//   exigir um comentário novo (é só responder no mesmo fio); várias conversas
//   ficam em andamento ao mesmo tempo (comentar no próximo registro enquanto a
//   análise do anterior roda); e uma proposta esperando confirmação sobrevive a
//   um F5. Como na 0098, o SERVIDOR é a fonte da verdade dos turnos e da prévia
//   — a réplica manda só o texto dela, e o apply lê o JSON da LINHA.
//
//   Junto: `adiar_sequencia` entra no catálogo quando o registro tem série E o
//   usuário pode gravar em `series_settings` — oferecer o que ele não pode
//   aplicar seria um cartão que só falha depois do clique.
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
  type TasksEditModes,
} from "@/lib/import/tasks/types";

/**
 * Os modos desta superfície. `allowSeries` é resolvido POR REGISTRO (ver
 * `loadRecordTaskContext`): sem série no registro, ou sem permissão de gravar a
 * exceção, o verbo simplesmente não existe naquele turno.
 */
const modesFor = (ctx: TasksEditContext): TasksEditModes => ({
  allowDelete: true,
  allowSeries: (ctx.series?.length ?? 0) > 0,
});
// Import só de TIPO (apagado no build — nada de módulo client no server).
import type { AiChatEntry } from "@/components/dashboards/ai-chat-log";
import {
  applyTaskAction,
  summaryOfTaskAction,
  tituloOfTaskAction,
  type TaskFullRow,
} from "@/lib/ai/apply-task-action";

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

/** Perfis que a RLS da 0132 deixa gravar exceção de série. */
const canWriteSeries = (roles: string[]): boolean =>
  roles.includes("admin") || roles.includes("gestor");

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
  recordId: string,
  /** Pode gravar em `series_settings`? (admin/gestor — a RLS da 0132.) */
  canSnooze: boolean
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
          "id, title, description, record_id, board_id, phase, due_date, due_time, due_time_end, responsible_id, completed_at, series_occurrence, series_key, automation_rule_id"
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
    series_key: string | null;
    automation_rule_id: string | null;
  })[];

  // As séries deste registro saem das PRÓPRIAS tarefas (mesma dedução da Tree:
  // `record_attributes` é único por registro, então a 2ª série nunca aparece
  // por lá). O rótulo é o nome da regra — o mesmo que a árvore mostra no tronco.
  const series = canSnooze ? await loadRecordSeries(supabase, rows) : [];

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
    series,
  };

  const catalogJson = JSON.stringify(
    {
      tarefas_deste_registro: rows.map((r) => ({
        titulo: r.title,
        situacao: r.completed_at ? "concluída" : "em aberto",
        // O MESMO valor que o `tarefa_data` do contrato espera — é por ele que
        // a IA separa ocorrências homônimas de uma sequência.
        data: r.due_date,
        de_sequencia: r.series_occurrence != null,
      })),
      responsaveis: resps.map((r) => r.name),
      fases_sem_quadro: defaultPhases.map((p) => p.label),
      ...(series.length > 0
        ? { sequencias_periodicas: series.map((x) => x.label) }
        : {}),
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
 * As séries do registro, pelo que as TAREFAS dele dizem.
 *
 * Mesma dedução da Tree (lib/tree/load.ts): `record_attributes` é único por
 * registro, então a 2ª série nunca chega a conceder o atributo — quem carrega a
 * regra é a tarefa. O rótulo é o nome da regra, o mesmo que a árvore mostra no
 * tronco, para a IA e a pessoa falarem da mesma coisa.
 */
async function loadRecordSeries(
  supabase: Supabase,
  rows: { series_key: string | null; automation_rule_id: string | null }[]
): Promise<{ key: string; label: string }[]> {
  const byRule = new Map<string, string>();
  for (const r of rows) {
    if (r.series_key && r.automation_rule_id && !byRule.has(r.automation_rule_id)) {
      byRule.set(r.automation_rule_id, r.series_key);
    }
  }
  if (byRule.size === 0) return [];
  const { data } = await supabase
    .from("automation_rules")
    .select("id, name")
    .in("id", [...byRule.keys()]);
  const out: { key: string; label: string }[] = [];
  for (const r of (data ?? []) as { id: string; name: string | null }[]) {
    const key = byRule.get(r.id);
    const label = (r.name ?? "").trim();
    // Sem nome não há como a IA se referir a ela, e inventar um rótulo faria a
    // resolução por nome casar com algo que a tela não mostra.
    if (key && label) out.push({ key, label });
  }
  return out;
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
 * Uma conversa aberta, no formato que o dock desenha.
 *
 * `acoes` presente = há proposta esperando confirmação. O JSON dela NÃO vem
 * para o cliente: aplicar lê a linha (precedente da 0098).
 */
export interface CommentThread {
  id: string;
  recordId: string;
  recordTitle: string;
  chat: AiChatEntry[];
  acoes?: { resumo: string; destrutiva: boolean }[];
  updatedAt: string;
}

interface ThreadRow {
  id: string;
  record_id: string;
  record_title: string;
  turns: string[];
  chat: AiChatEntry[];
  pending: { json: string; acoes: { resumo: string; destrutiva: boolean }[] } | null;
  updated_at: string;
}

const THREAD_COLS =
  "id, record_id, record_title, turns, chat, pending, updated_at";

/** Cap de armazenamento — o dock mostra a conversa inteira, mas ela não cresce
 *  sem fim: um fio com 40 idas e vindas é um fio que devia ter virado tarefa. */
const THREAD_TURNS_CAP = 12;

const toThread = (r: ThreadRow): CommentThread => ({
  id: r.id,
  recordId: r.record_id,
  recordTitle: r.record_title,
  chat: Array.isArray(r.chat) ? r.chat : [],
  ...(r.pending ? { acoes: r.pending.acoes } : {}),
  updatedAt: r.updated_at,
});

/** As conversas ABERTAS deste usuário, recentes primeiro. */
export async function listCommentThreadsCore(): Promise<CommentThread[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("tree_ai_threads")
    .select(THREAD_COLS)
    .eq("status", "aberta")
    .order("updated_at", { ascending: false })
    .limit(10);
  return ((data ?? []) as ThreadRow[]).map(toThread);
}

/**
 * Abre a conversa — rápido de propósito.
 *
 * A linha nasce com o comentário já no log, ANTES de a IA ser chamada: é o que
 * dá ao dock o que mostrar enquanto a análise roda (o widget antes escondia o
 * próprio botão que segurava o spinner, e a tela ficava muda), e é o que faz um
 * F5 no meio da análise reencontrar a conversa em vez de perdê-la.
 */
export async function openCommentThreadCore(input: {
  recordId: string;
  recordTitle: string;
  comment: string;
}): Promise<{ ok: boolean; message?: string; thread?: CommentThread }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const comment = input.comment.trim();
  if (!comment) return { ok: false, message: "Escreva o comentário primeiro." };
  const orgId = await getActiveOrgId();
  // Sem org ativa não há como carimbar a linha, e o `with check` da policy
  // recusaria de todo jeito — falhar aqui é dizer por quê (padrão da 0124).
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tree_ai_threads")
    .insert({
      organization_id: orgId,
      user_id: session.user.id,
      record_id: input.recordId,
      record_title: input.recordTitle.slice(0, 200),
      turns: [comment],
      chat: [{ kind: "user", text: comment } satisfies AiChatEntry],
    })
    .select(THREAD_COLS)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: `Não foi possível abrir a conversa: ${error?.message ?? ""}`.trim() };
  }
  return { ok: true, thread: toThread(data as ThreadRow) };
}

/**
 * Roda um turno: a primeira análise, ou uma réplica do usuário.
 *
 * `priorTurns` sai da LINHA — o cliente manda só o texto novo. A prévia ainda
 * não aplicada entra no enunciado com a semântica "a resposta SUBSTITUI esta
 * proposta inteira", que é a mesma do painel de dashboards; sem isso a réplica
 * "só a próxima" seria lida sem o que ela está corrigindo.
 */
export async function runCommentThreadCore(input: {
  threadId: string;
  reply?: string;
}): Promise<{ ok: boolean; message?: string; thread?: CommentThread }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
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
  const { data: row } = await supabase
    .from("tree_ai_threads")
    .select(THREAD_COLS)
    .eq("id", input.threadId)
    .eq("status", "aberta")
    .maybeSingle();
  if (!row) return { ok: false, message: "Conversa não encontrada." };
  const thread = row as ThreadRow;

  const reply = (input.reply ?? "").trim();
  const turns = [...(Array.isArray(thread.turns) ? thread.turns : [])];
  if (reply) turns.push(reply);
  if (turns.length === 0) return { ok: false, message: "Conversa vazia." };

  const loaded = await loadRecordTaskContext(
    supabase,
    thread.record_id,
    canWriteSeries(session.roles)
  );
  if (!loaded) return { ok: false, message: "Registro não encontrado." };
  const modes = modesFor(loaded.ctx);

  const chat: AiChatEntry[] = [
    ...(Array.isArray(thread.chat) ? thread.chat : []),
    ...(reply ? [{ kind: "user", text: reply } satisfies AiChatEntry] : []),
  ];

  const system =
    buildCommentAnalysisPrompt({
      // turns[0] é o comentário; o resto são réplicas.
      comment: turns[0],
      todayIso: todayBrasiliaIso(),
      record: {
        title: loaded.record.title,
        stage: loaded.record.stage,
        responsible: loaded.responsibleName,
      },
      catalogJson: loaded.catalogJson,
      allowDelete: modes.allowDelete,
      allowSeries: modes.allowSeries,
    }) + pendingSection(thread.pending?.json);

  const result = await runJsonGenerationLoop<{
    actions: ParsedTaskAction[];
    warnings: string[];
  }>({
    config: aiConfig,
    system,
    priorTurns: turns.slice(1, reply ? -1 : undefined),
    description: reply
      ? reply
      : "Analise o comentário acima e responda com o JSON do formato combinado.",
    validate: (raw) => {
      const vazio = readEmptyAnswer(raw);
      if (vazio) return { ok: true, value: { actions: [], warnings: vazio.notas } };
      const v = validateTasksEdit(raw, loaded.ctx, modes);
      if (!v.ok) return { ok: false, errors: v.errors };
      const n = narrow(v.actions);
      if (!n.ok) return { ok: false, errors: n.errors };
      return { ok: true, value: { actions: n.actions, warnings: v.warnings } };
    },
  });

  if (!result.ok) {
    // A falha vira turno do log e FICA: é dela que a pessoa parte para pedir
    // outra coisa, sem escrever um comentário novo só para tentar de novo.
    const entry: AiChatEntry = {
      kind: "error",
      text: result.message ?? "A análise falhou.",
      ...(result.errors ? { errors: result.errors } : {}),
    };
    return saveThread(supabase, thread.id, {
      turns,
      chat: [...chat, entry],
      pending: thread.pending,
    });
  }

  const { actions, warnings } = result.value;
  if (actions.length === 0) {
    return saveThread(supabase, thread.id, {
      turns,
      chat: [
        ...chat,
        {
          kind: "ok",
          text:
            warnings[0] ??
            "Não há nada a agendar a partir deste comentário.",
        },
      ],
      // Resposta "nada a fazer" LIMPA a proposta anterior: se a réplica foi
      // "deixa pra lá", manter o cartão anterior seria oferecer o que se acabou
      // de descartar.
      pending: null,
    });
  }

  const acoes = actions.map((a) => ({
    resumo: summaryOfTaskAction(a),
    destrutiva: a.acao === "excluir" || a.acao === "adiar_sequencia",
  }));
  return saveThread(supabase, thread.id, {
    turns,
    chat: [
      ...chat,
      {
        kind: "ok",
        text: "Sugestão:",
        summary: acoes.map((x) => x.resumo),
        ...(warnings.length > 0 ? { errors: warnings } : {}),
      },
    ],
    pending: { json: serializeTasksEdit(actions), acoes },
  });
}

/** O bloco da prévia pendente no enunciado do turno seguinte. */
function pendingSection(json: string | undefined): string {
  if (!json) return "";
  return (
    "\n\n==== PROPOSTA ATUAL (ainda não aplicada) ====\n\n" +
    json +
    "\n\nA sua resposta SUBSTITUI esta proposta inteira. Se a pessoa pediu um " +
    "ajuste, devolva a lista completa já corrigida; se ela desistiu, devolva " +
    '"acoes": [].'
  );
}

async function saveThread(
  supabase: Supabase,
  id: string,
  patch: { turns: string[]; chat: AiChatEntry[]; pending: ThreadRow["pending"] }
): Promise<{ ok: boolean; message?: string; thread?: CommentThread }> {
  const { data, error } = await supabase
    .from("tree_ai_threads")
    .update({
      turns: patch.turns.slice(-THREAD_TURNS_CAP),
      chat: patch.chat.slice(-(THREAD_TURNS_CAP * 2)),
      pending: patch.pending,
    })
    .eq("id", id)
    .select(THREAD_COLS)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, message: `Falha ao gravar a conversa: ${error?.message ?? ""}`.trim() };
  }
  return { ok: true, thread: toThread(data as ThreadRow) };
}

/** Fecha a conversa sem aplicar nada. */
export async function dismissCommentThreadCore(
  threadId: string
): Promise<{ ok: boolean; message?: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tree_ai_threads")
    .update({ status: "descartada", pending: null })
    .eq("id", threadId);
  return error ? { ok: false, message: error.message } : { ok: true };
}

/**
 * Aplica a proposta da conversa: RE-VALIDA com catálogo FRESCO e grava pelos
 * choke points.
 *
 * O JSON vem da LINHA, nunca do cliente. O `record_id` também: o contrato
 * `tarefas-edit` não carrega vínculo com registro de propósito, e a tarefa que
 * nasce de um comentário precisa nascer NA ÁRVORE daquele registro.
 */
export async function applyCommentThreadCore(
  threadId: string
): Promise<ApplyCommentTaskState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("tree_ai_threads")
    .select(THREAD_COLS)
    .eq("id", threadId)
    .eq("status", "aberta")
    .maybeSingle();
  if (!row) return { ok: false, message: "Conversa não encontrada." };
  const thread = row as ThreadRow;
  if (!thread.pending) return { ok: false, message: "Não há o que aplicar." };

  const loaded = await loadRecordTaskContext(
    supabase,
    thread.record_id,
    canWriteSeries(session.roles)
  );
  if (!loaded) return { ok: false, message: "Registro não encontrado." };

  const v = validateTasksEdit(thread.pending.json, loaded.ctx, modesFor(loaded.ctx));
  if (!v.ok) {
    // O catálogo mudou desde a proposta (alguém concluiu a tarefa, a série
    // acabou): dizer isso é melhor que aplicar metade.
    return {
      ok: false,
      message: "A proposta não vale mais — peça um ajuste na conversa.",
      errors: v.errors,
    };
  }
  const n = narrow(v.actions);
  if (!n.ok) return { ok: false, message: n.errors[0], errors: n.errors };

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
      recordId: thread.record_id,
    });
    results.push({ titulo: tituloOfTaskAction(a), ok: res.ok, message: res.message });
    if (res.ok) appliedCount += 1;
  }

  const total = n.actions.length;
  const done = appliedCount === total;
  // Falha parcial mantém a conversa ABERTA: é nela que a pessoa pede o conserto
  // do que não entrou, sem recomeçar do comentário.
  await supabase
    .from("tree_ai_threads")
    .update(
      done
        ? { status: "aplicada", pending: null }
        : {
            chat: [
              ...(Array.isArray(thread.chat) ? thread.chat : []),
              {
                kind: "error",
                text: `${appliedCount} de ${total} aplicadas.`,
                errors: results.flatMap((r) =>
                  r.ok ? [] : [`${r.titulo}: ${r.message ?? "falhou"}`]
                ),
              } satisfies AiChatEntry,
            ],
          }
    )
    .eq("id", threadId);

  return {
    ok: done,
    message: done
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
