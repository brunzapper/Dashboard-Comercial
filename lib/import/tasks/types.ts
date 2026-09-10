// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): `excluir` existe — mas só onde a superfície liga
// (`validateTasksEdit(..., { allowDelete: true })`). A decisão de NÃO ter
// exclusão continua valendo em /operacao/tarefas, que é onde ela foi tomada:
// numa tela de lista, apagar em lote a partir de linguagem natural é
// destrutivo demais. Na Tree o alvo é uma tarefa de UM registro, dita por um
// comentário que a própria pessoa acabou de escrever — e "cancela a demo de
// amanhã" sem exclusão obriga a fazer metade na mão. Precedente literal do
// modo por superfície: `validateRecordsUpdate(..., { selection: true })`.
// Junto: `fromSeries` no catálogo, porque excluir ocorrência de série é o
// único alvo que o tick desfaz (ver o validador).
// Contrato do assistente de IA de TAREFAS (padrão §4.17): lote de até 15 ações
// declarativas (criar/editar/concluir) identificadas por TÍTULO — ids NUNCA
// vêm do JSON (o validador resolve contra o catálogo FRESCO; 0 hits lista as
// visíveis, >1 = ambiguidade). Sem ação de EXCLUSÃO: fica na tela, como no
// contrato de operações (destrutivo, e a trava `locked` existe justamente
// para isso).
//
// A muralha é a RLS de `tasks` (0063) somada aos choke points
// createTask/updateTask/completeTask/moveTaskPhase — nada de service role. Um
// vendedor só enxerga (e portanto só referencia) as próprias tarefas, e o
// `coerceResponsible` do choke point ainda coage o responsável ao dele.

export const TASKS_EDIT_FORMAT = "tarefas-edit";
export const TASKS_EDIT_VERSION = 1;

/**
 * Teto do lote. Cada ação é uma chamada de action com round-trip próprio
 * (insert/update + webhook + revalidate), então o lote é serial e caro;
 * precedente literal de `MAX_AI_OPERATION_ACTIONS`.
 */
export const MAX_AI_TASK_ACTIONS = 15;

/**
 * O que a superfície deixa a IA fazer.
 *
 * Um flag, um validador — nunca um segundo contrato. Molde do
 * `{ selection: true }` de `validateRecordsUpdate`.
 */
export interface TasksEditModes {
  /** Habilita a ação `excluir`. Ausente = o contrato de sempre, sem exclusão. */
  allowDelete?: boolean;
}

/** Uma fase (coluna) aceita — do quadro escolhido ou da tela de tarefas. */
export interface TaskPhaseRef {
  key: string;
  label: string;
  /** Coluna que CONCLUI a tarefa ao receber o card. */
  completes: boolean;
}

/** Campos que criar e editar compartilham, já resolvidos. */
export interface ParsedTaskFields {
  /** `null` limpa a descrição. */
  descricao?: string | null;
  /** Responsável resolvido; `null` desatribui. */
  responsavel?: { id: string; nome: string } | null;
  /** `YYYY-MM-DD`; `null` tira o prazo. */
  data?: string | null;
  /** `HH:MM`; `null` tira a hora (e, com ela, a hora final). */
  hora?: string | null;
  /** `HH:MM`; exige `hora` e precisa ser depois dela (CHECK da 0111). */
  hora_fim?: string | null;
  /** Fase resolvida contra as colunas do quadro efetivo. */
  fase?: TaskPhaseRef;
}

export interface ParsedTaskCreate extends ParsedTaskFields {
  acao: "criar";
  titulo: string;
  /** Quadro de tarefas resolvido; ausente = tarefa solta ("Minhas tarefas"). */
  quadro?: { id: string; nome: string };
}

export interface ParsedTaskEdit extends ParsedTaskFields {
  acao: "editar";
  /** Sempre uma tarefa EXISTENTE, resolvida pelo título. */
  alvo: { id: string; titulo: string };
  novoTitulo?: string;
}

export interface ParsedTaskComplete {
  acao: "concluir";
  alvo: { id: string; titulo: string };
}

/** v1.1: só em superfície com `allowDelete`. Some com a tarefa, não a fecha. */
export interface ParsedTaskDelete {
  acao: "excluir";
  alvo: { id: string; titulo: string };
}

export type ParsedTaskAction =
  | ParsedTaskCreate
  | ParsedTaskEdit
  | ParsedTaskComplete
  | ParsedTaskDelete;

/** Catálogo FRESCO carregado pelo core (na geração E no apply). */
export interface TasksEditContext {
  /** Tarefas VISÍVEIS ao usuário (a RLS já filtrou) — o universo do alvo. */
  tasks: {
    id: string;
    title: string;
    phase: string;
    boardId: string | null;
    completed: boolean;
    responsibleId: string | null;
    dueDate: string | null;
    /** `HH:MM[:SS]` — base do par hora/hora_fim numa edição parcial. */
    dueTime: string | null;
    /**
     * v1.1: veio de uma SÉRIE (`tasks.series_occurrence`)? Só o `excluir`
     * olha para isto — ver o validador.
     */
    fromSeries: boolean;
  }[];
  /** Responsáveis ativos, por nome de exibição. */
  responsibles: { id: string; name: string }[];
  /** Quadros de tarefas visíveis, com as colunas de cada um. */
  boards: { id: string; name: string; phases: TaskPhaseRef[] }[];
  /** Fases da tela "Minhas tarefas" — o quadro efetivo de tarefa sem board. */
  defaultPhases: TaskPhaseRef[];
}

export type TasksEditValidation =
  | { ok: true; actions: ParsedTaskAction[]; warnings: string[] }
  | { ok: false; errors: string[] };
