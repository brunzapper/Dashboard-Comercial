// Versão: 1.2 | Data: 11/09/2026
// v1.2 (11/09/2026): `tarefa_data` (nas duas superfícies) e `adiar_sequencia`
// (só com `allowSeries`). O SPEC precisava ensinar a segunda coordenada do
// alvo: sem ela o modelo não tinha COMO escolher entre ocorrências homônimas de
// uma série, e devolvia a pergunta para a pessoa.
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
    { "acao": "editar", "tarefa": "Enviar contrato", "tarefa_data": null,
      "data": "2026-09-12", "responsavel": null },
    { "acao": "concluir", "tarefa": "Ligar para a Acme" }
  ],
  "notas": ["Desatribuí \\"Enviar contrato\\" porque você não disse de quem é."]
}`;

/** As linhas que só existem quando a superfície liga a exclusão. */
const DELETE_ACTION_LINE = `- "excluir": { "acao", "tarefa" } — APAGA a tarefa. Não é o mesmo que
  concluir: use quando o que estava previsto não vai mais acontecer, e
  "concluir" quando ele aconteceu.`;

/** v1.2: só onde existe um REGISTRO em contexto (a Tree). */
const SERIES_ACTION_LINE = `- "adiar_sequencia": { "acao", "sequencia", "ate" } — empurra a SEQUÊNCIA
  periódica inteira deste registro para a frente: o que venceria antes de "ate"
  some, e ela volta a gerar nesse dia. Use quando o combinado
  for sobre QUANDO voltar ao assunto ("me procure em novembro"), em vez de
  remarcar uma por uma — remarcar três ocorrências para o mesmo dia empilha
  três tarefas iguais, e a seguinte abre assim mesmo.`;

export function tasksSpec(opts: TasksEditModes = {}): string {
  const allowDelete = opts.allowDelete === true;
  const allowSeries = opts.allowSeries === true;
  const nomes = ["criar", "editar", "concluir"];
  if (allowDelete) nomes.push("excluir");
  if (allowSeries) nomes.push("adiar_sequencia");
  const acoesLista = `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}`;
  // As ações que referenciam uma tarefa existente. A frase lista SÓ as que
  // esta superfície aceita — citar "excluir" onde ela não existe seria ensinar
  // uma ação e negá-la duas linhas abaixo.
  const alvoAcoes = allowDelete
    ? '"editar", "concluir" e "excluir"'
    : '"editar" e "concluir"';
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
${allowDelete ? `${DELETE_ACTION_LINE}\n` : ""}${allowSeries ? `${SERIES_ACTION_LINE}\n` : ""}

Identificar a tarefa em ${alvoAcoes}:

- "tarefa": o TÍTULO atual, exato.
- "tarefa_data": o PRAZO dela ("YYYY-MM-DD", ou null para a que está sem
  prazo). É opcional, mas obrigatório na prática sempre que o catálogo tiver
  mais de uma tarefa com o mesmo título — o caso normal de uma sequência
  periódica, em que todas as ocorrências se chamam igual. Sem ele o título
  precisa ser único, e não sendo, a ação é recusada.

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
   do catálogo — nunca invente ids nem nomes. Título repetido se resolve com
   "tarefa_data"; só é ERRO quando duas tarefas de mesmo título vencem no MESMO
   dia. As ações disponíveis são: ${acoesLista}.
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
  /** v1.2: idem para o adiamento da sequência. */
  allowSeries?: boolean;
}): string {
  return (
    `Você organiza as TAREFAS de um time comercial: cria, reagenda, atribui e ` +
    `conclui. O usuário descreve o que quer em linguagem natural; você devolve ` +
    `as ações no formato abaixo, usando só os nomes do catálogo.` +
    section(
      "FORMATO DA RESPOSTA",
      tasksSpec({
        allowDelete: input.allowDelete,
        allowSeries: input.allowSeries,
      })
    ) +
    section("CATÁLOGO (JSON)", input.catalogJson)
  );
}
