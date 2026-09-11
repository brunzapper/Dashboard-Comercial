// Versão: 1.2 | Data: 11/09/2026
// v1.2 (11/09/2026): DUAS adições que vieram do mesmo caso real — um
// comentário sobre um registro cuja série tem 3 ocorrências abertas, todas com
// o MESMO título (é assim que uma série é).
//
//  (a) `tarefa_data` — o alvo ganha uma segunda coordenada. O título sozinho
//      NUNCA resolveu uma ocorrência de série, então `editar`/`concluir`/
//      `excluir` eram estruturalmente impossíveis justamente nas tarefas de que
//      a Tree é feita: o validador devolvia "casa com 3 tarefas" e a IA
//      repassava a pergunta para a pessoa. Não pode se chamar `data`: em
//      `editar`, `data` já é a data NOVA.
//
//  (b) `adiar_sequencia` — "o cliente pediu para contactar no fim de outubro"
//      é uma decisão sobre a SEQUÊNCIA, não sobre as tarefas dela. Remarcar as
//      três ocorrências empilharia três tarefas no mesmo dia e o tick abriria a
//      quarta assim mesmo. Atrás do modo `allowSeries`, mesmo molde do
//      `allowDelete`.
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
  /**
   * v1.2: habilita `adiar_sequencia`. Só faz sentido onde existe um REGISTRO em
   * contexto (a Tree) — em /operacao/tarefas não há série a que se referir, e
   * o catálogo nem publica a lista.
   */
  allowSeries?: boolean;
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

/**
 * Uma tarefa EXISTENTE, já resolvida contra o catálogo fresco.
 *
 * v1.2: `data` guarda o `tarefa_data` que a IA mandou, quando mandou — e só
 * então. É ele que desempata ocorrências homônimas de uma série, e é ele que a
 * serialização devolve ao fio para a prévia reinjetada não cair de novo no erro
 * de ambiguidade que acabou de resolver. Ausente = o título bastou.
 */
export interface ParsedTaskTarget {
  id: string;
  titulo: string;
  data?: string | null;
}

export interface ParsedTaskEdit extends ParsedTaskFields {
  acao: "editar";
  alvo: ParsedTaskTarget;
  novoTitulo?: string;
}

export interface ParsedTaskComplete {
  acao: "concluir";
  alvo: ParsedTaskTarget;
}

/** v1.1: só em superfície com `allowDelete`. Some com a tarefa, não a fecha. */
export interface ParsedTaskDelete {
  acao: "excluir";
  alvo: ParsedTaskTarget;
}

/**
 * v1.2: adiar a SEQUÊNCIA de uma série para ESTE registro até uma data.
 *
 * Não é uma ação sobre tarefa: é a exceção de `series_settings` que a Tree já
 * oferece a um humano ("encerrar a sequência"), com uma data de volta. O alvo é
 * a série resolvida pelo RÓTULO contra o catálogo fresco — a `key` nunca vem do
 * JSON, como todo id no §4.17.
 */
export interface ParsedTaskSnoozeSeries {
  acao: "adiar_sequencia";
  serie: { key: string; label: string };
  /** `YYYY-MM-DD` — a série volta a gerar a partir deste dia. */
  ate: string;
}

export type ParsedTaskAction =
  | ParsedTaskCreate
  | ParsedTaskEdit
  | ParsedTaskComplete
  | ParsedTaskDelete
  | ParsedTaskSnoozeSeries;

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
  /**
   * v1.2: séries do registro em contexto, para `adiar_sequencia`. Lista VAZIA
   * (ou ausente) = o verbo não tem alvo possível, e o validador o recusa mesmo
   * com `allowSeries` — é o que impede a IA de prometer um adiamento a quem não
   * tem permissão de gravar em `series_settings` (a Tree só publica a lista
   * quando `canConfigureSeries`).
   */
  series?: { key: string; label: string }[];
}

export type TasksEditValidation =
  | { ok: true; actions: ParsedTaskAction[]; warnings: string[] }
  | { ok: false; errors: string[] };
