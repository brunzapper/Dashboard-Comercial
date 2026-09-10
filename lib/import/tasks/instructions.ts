// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): o SPEC é função do MODO da superfície. A regra 2 dizia
// "NÃO existe ação de exclusão"; com `allowDelete` ela precisa ensinar o
// oposto, e um prompt com as duas frases ao mesmo tempo é um prompt que se
// contradiz. `TASKS_SPEC` segue byte-idêntico (é `tasksSpec({})`), então
// /operacao/tarefas não muda uma vírgula — quem liga a exclusão é a Tree.
// SPEC do assistente de IA de TAREFAS — módulo PURO, DERIVADO das constantes
// reais (formato/versão/teto de ./types; as fases padrão de
// lib/kanban/types.ts, que são as MESMAS que a tela usa). Constante nova
// aparece aqui sozinha; o teste de paridade fiscaliza e roda o EXEMPLO pelo
// validador REAL. O MESMO texto serve o chat interno e o "Copiar prompt" para
// IA externa — um contrato, duas entradas.
import { DEFAULT_TASK_PHASES } from "@/lib/kanban/types";

import {
  MAX_AI_TASK_ACTIONS,
  TASKS_EDIT_FORMAT,
  TASKS_EDIT_VERSION,
  type TasksEditModes,
} from "./types";

const section = (title: string, body: string): string =>
  `\n\n==== ${title} ====\n\n${body.trim()}`;

const fasesPadrao = DEFAULT_TASK_PHASES.map((p) => `"${p.label}"`).join(", ");

export const TASKS_SPEC_EXAMPLE = `{
  "formato": "${TASKS_EDIT_FORMAT}",
  "versao": ${TASKS_EDIT_VERSION},
  "acoes": [
    { "acao": "criar", "titulo": "Ligar para a Acme",
      "responsavel": "Maria Silva", "data": "2026-09-10",
      "hora": "14:00", "hora_fim": "14:30" },
    { "acao": "criar", "titulo": "Preparar proposta",
      "quadro": "Onboarding", "fase": "Em andamento",
      "descricao": "Levantar escopo com o time técnico." },
    { "acao": "editar", "tarefa": "Enviar contrato", "data": "2026-09-12",
      "responsavel": null },
    { "acao": "concluir", "tarefa": "Ligar para a Acme" }
  ],
  "notas": ["Desatribuí \\"Enviar contrato\\" porque você não disse de quem é."]
}`;

/** As linhas que só existem quando a superfície liga a exclusão. */
const DELETE_ACTION_LINE = `- "excluir": { "acao", "tarefa" } — APAGA a tarefa. Não é o mesmo que
  concluir: use quando o que estava previsto não vai mais acontecer, e
  "concluir" quando ele aconteceu.`;

export function tasksSpec(opts: TasksEditModes = {}): string {
  const allowDelete = opts.allowDelete === true;
  const acoesLista = allowDelete
    ? "criar, editar, concluir ou excluir"
    : "criar, editar ou concluir";
  const regraExclusao = allowDelete
    ? `2. "excluir" some com a tarefa e não tem desfazer — use só quando o
   texto disser que aquilo foi cancelado ou não vai mais acontecer.`
    : `2. NÃO existe ação de exclusão — conclua a tarefa, ou exclua pela tela.`;
  return `Responda com UM único objeto JSON (sem texto fora dele):

${TASKS_SPEC_EXAMPLE}

Semântica das ações (NO MÁXIMO ${MAX_AI_TASK_ACTIONS} por resposta — se precisar de
mais, mantenha as ${MAX_AI_TASK_ACTIONS} primeiras e explique em "notas"):

- "criar": { "acao", "titulo", "quadro"?, "fase"?, + campos } — cria uma tarefa.
  Sem "quadro" ela nasce solta, na tela "Minhas tarefas".
- "editar": { "acao", "tarefa", "novo_titulo"?, + campos } — altera uma tarefa
  EXISTENTE, referenciada pelo TÍTULO atual. Informe ao menos uma mudança.
- "concluir": { "acao", "tarefa" } — marca como concluída.
${allowDelete ? `${DELETE_ACTION_LINE}\n` : ""}

Campos comuns a criar e editar:

- "descricao": texto; null limpa.
- "responsavel": NOME exato do cadastro; null desatribui.
- "data": "YYYY-MM-DD"; null tira o prazo.
- "hora" e "hora_fim": "HH:MM". "hora_fim" EXIGE "hora" e precisa ser depois
  dela.
- "fase": RÓTULO da coluna. Numa tarefa solta as fases são ${fasesPadrao};
  num quadro, as colunas daquele quadro.

Regras:
1. Identifique tarefas, responsáveis e quadros SEMPRE pelo NOME/TÍTULO EXATO
   do catálogo — nunca invente ids nem nomes. Título que casa com mais de uma
   tarefa é ERRO: peça ao usuário para desambiguar. As ações disponíveis são:
   ${acoesLista}.
${regraExclusao}
3. Você só enxerga (e só pode mexer em) as tarefas do catálogo abaixo. Se o
   usuário citar uma que não está lá, diga isso em "notas" em vez de criar
   uma parecida.
4. Vínculo com REGISTRO não faz parte deste formato: uma tarefa já ligada a um
   registro CONTINUA ligada depois da edição, e para criar um vínculo novo use
   a tela do registro.
5. "notas" (opcional): avisos e suposições em pt-BR para o usuário.`;
}

/** O SPEC sem exclusão — o de /operacao/tarefas, byte-idêntico ao da v1.0. */
export const TASKS_SPEC = tasksSpec();

export function buildTasksPromptText(input: {
  catalogJson: string;
  /** v1.1: a superfície decide se a exclusão existe (ver tasksSpec). */
  allowDelete?: boolean;
}): string {
  return (
    `Você organiza as TAREFAS de um time comercial: cria, reagenda, atribui e ` +
    `conclui. O usuário descreve o que quer em linguagem natural; você devolve ` +
    `as ações no formato abaixo, usando só os nomes do catálogo.` +
    section("FORMATO DA RESPOSTA", tasksSpec({ allowDelete: input.allowDelete })) +
    section("CATÁLOGO (JSON)", input.catalogJson)
  );
}
