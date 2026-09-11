// Versão: 1.2 | Data: 11/09/2026
// v1.2 (11/09/2026): DECIDIR, não perguntar — e a sequência como alvo.
//
//   O caso real: "O Oscar me pediu para contactar no final de outubro" num
//   registro com série quinzenal. A resposta foi "existem múltiplas tarefas com
//   esse título, especifique a data". Duas coisas erradas de uma vez: ela não
//   TINHA como escolher (faltava `tarefa_data` no contrato — v1.1 do validador)
//   e não DEVIA perguntar. Quem escreve um comentário não está dando uma ordem:
//   devolver a pergunta transforma um atalho de um clique em trabalho a mais
//   que a pessoa não tinha antes de escrever.
//
//   A régua de escolha fica aqui, e não no validador, porque é julgamento e não
//   validade — e é PRÓPRIA desta superfície: em /operacao/tarefas houve uma
//   ordem direta, e ali perguntar qual das duas segue sendo o certo.
// v1.1 (10/09/2026): as QUATRO ações. A v1.0 mandava usar só "criar" e proibia
// o resto; um comentário real ("ele pediu para adiar a proposta e cancelar a
// demo de amanhã") é um editar e um excluir, e a IA respondia propondo uma
// terceira tarefa. O enunciado passa a dizer QUANDO cada ação cabe — e a
// régua de prazo não mudou.
// SPEC do "Salvar e analisar" da Tree — módulo PURO.
//
// O contrato é o `tarefas-edit` que já existe: mesmo formato, mesma versão,
// MESMO validador. O que muda é o PEDIDO — em vez de "faça o que o usuário
// mandou", é "leia este comentário e decida se ele pede um próximo passo".
// Escrever um segundo contrato para isso seria a régua paralela da invariante
// 25: o objeto de saída é o mesmo, e a diferença cabe no enunciado.
//
// O que esta superfície tem de próprio, e o código RE-IMPÕE depois de validar
// (o SPEC pede, o código garante):
//  - o TETO de MAX_COMMENT_TASK_ACTIONS ações (o `narrow` do core);
//  - o modo `allowDelete`, que é o que faz `excluir` existir aqui e não em
//    /operacao/tarefas;
//  - `acoes: []` é resposta LEGÍTIMA. A pergunta é "o comentário muda alguma
//    coisa?", e "não" precisa ter como ser dito — sem isso o modelo inventa
//    uma ação para todo comentário, e a função vira ruído.
//
// A régua de PRAZO é a parte que não sai de constante nenhuma, então está
// escrita aqui uma vez só: prazo dito no comentário vence sempre; sem prazo
// dito, o padrão de follow-up de venda SMB de SaaS. Números conservadores de
// propósito — errar para mais cedo custa um "adiar", errar para mais tarde
// custa o negócio.
import { buildTasksPromptText } from "./instructions";

const section = (title: string, body: string): string =>
  `\n\n==== ${title} ====\n\n${body.trim()}`;

/**
 * Teto do lote nesta superfície.
 *
 * Três, não quinze: um comentário rende poucas coisas, e o cartão de
 * confirmação é de UM clique — uma lista longa ali seria uma lista que
 * ninguém lê antes de clicar.
 */
export const MAX_COMMENT_TASK_ACTIONS = 3;

/**
 * A régua de leitura do comentário. É função do MODO pela mesma razão que o
 * SPEC é (v1.2 de instructions.ts): mandar preferir `adiar_sequencia` num turno
 * em que a ação não existe é ensinar e negar na mesma página.
 */
export function commentAnalysisRules(opts: { allowSeries?: boolean } = {}): string {
  const adiar = opts.allowSeries === true;
  const preferirAdiar = adiar
    ? `\n  — e aí prefira "adiar_sequencia" à edição de uma por uma: ela resolve as
  várias de uma vez e evita empilhar tarefas iguais no mesmo dia. Nesse caso
  acrescente TAMBÉM um "criar" para o dia combinado: adiar sozinho tira tudo da
  tela e não deixa nada lembrando do compromisso até ele vencer;`
    : ";";
  return `Você está lendo UM comentário que a pessoa acabou de escrever no
acompanhamento de um registro comercial. Decida o que ele muda na lista de
tarefas DESTE registro — no máximo ${MAX_COMMENT_TASK_ACTIONS} ações.

Quando usar cada uma:

- "criar": o comentário pede um próximo passo que ainda não existe na lista.
- "editar": o que já estava previsto mudou — remarcou, trocou de responsável,
  virou outra coisa. Prefira editar a criar uma tarefa quase igual.
- "concluir": o comentário diz que aquilo foi FEITO.
- "excluir": o que estava previsto NÃO vai mais acontecer (cancelado, desistiu,
  perdeu o sentido). Não confunda com concluir: concluir é "aconteceu",
  excluir é "não vai acontecer".

Se o comentário não muda nada — só registra um fato, um desabafo, um dado de
cadastro — devolva "acoes": [] e explique em uma linha em "notas". Não invente
ação para ter o que devolver: essa é a resposta mais comum.

DECIDA — nunca devolva a pergunta. Quem escreveu não está te dando uma ordem,
está contando o que houve; pedir para "especificar qual tarefa" transforma um
atalho num trabalho a mais. Quando o título casar com várias (é o normal numa
sequência periódica: todas as ocorrências se chamam igual), escolha pelos
prazos do catálogo e informe a escolha em "notas":

- em geral a relevante é a PRÓXIMA a vencer;
- quando o comentário empurra o assunto para uma data ("me procure no fim de
  outubro", "só em novembro"), são relevantes TODAS as que venceriam antes
  dessa data${preferirAdiar}
- na dúvida entre duas igualmente plausíveis, aja sobre a mais próxima e diga
  em "notas" o que deixou de fora.

Só existe um caso de recusar: quando nem os prazos separam as tarefas (duas com
o mesmo título no mesmo dia). Aí explique em "notas" em vez de chutar.

PRAZO, para "criar" e para o "data" de "editar" — nesta ordem:
1. Se o comentário DIZ quando ("sexta", "semana que vem", "dia 20", "em 3
   dias"), use isso, resolvido contra a data de hoje informada abaixo.
2. Se não diz, use o intervalo usual de follow-up numa venda SMB de SaaS:
   - proposta ou orçamento enviado: 2 dias úteis;
   - contato feito sem resposta / "ficou de retornar": 3 a 5 dias;
   - reunião ou demonstração marcada: a véspera dela;
   - objeção de preço ou de momento ("me procure no trimestre que vem"): a
     data citada, ou 30 dias;
   - relacionamento em nutrição, sem sinal de compra: 14 dias.
3. Em qualquer caso, "data" é SEMPRE absoluta no formato "YYYY-MM-DD". Nunca
   devolva "amanhã", "próxima sexta" ou um número de dias.

Só preencha "hora" se o comentário marcar horário. Não invente responsável: sem
nome citado, omita o campo — a tarefa nasce com o dono do registro.`;
}

/** A variante sem a sequência — a que os testes de formato usam. */
export const COMMENT_ANALYSIS_RULES = commentAnalysisRules();

export interface CommentAnalysisInput {
  /** O texto que a pessoa escreveu, cru. */
  comment: string;
  /** Hoje em Brasília (YYYY-MM-DD) — a base de "sexta", "em 3 dias"… */
  todayIso: string;
  /** Contexto mínimo do registro, para o título fazer sentido sozinho. */
  record: { title: string; stage?: string | null; responsible?: string | null };
  /** O catálogo do contrato `tarefas-edit`, já serializado. */
  catalogJson: string;
  /** v1.1: esta superfície liga a exclusão — o SPEC muda com ela. */
  allowDelete?: boolean;
  /** v1.2: e o adiamento da sequência, quando o registro tem uma e a pessoa
   * pode gravá-lo (ver o catálogo do core). */
  allowSeries?: boolean;
}

/**
 * O enunciado do turno.
 *
 * Reusa `buildTasksPromptText` inteiro (é ele que carrega o FORMATO derivado
 * das constantes reais e o catálogo) e acrescenta o pedido desta superfície.
 * Duplicar o formato aqui seria duplicar o que o teste de paridade do
 * `tarefas-edit` já fiscaliza — e divergiria no primeiro campo novo.
 */
export function buildCommentAnalysisPrompt(input: CommentAnalysisInput): string {
  const contexto = [
    `Hoje é ${input.todayIso} (fuso de Brasília).`,
    `Registro: ${input.record.title}.`,
    input.record.stage ? `Etapa atual: ${input.record.stage}.` : null,
    input.record.responsible ? `Responsável: ${input.record.responsible}.` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  return (
    buildTasksPromptText({
      catalogJson: input.catalogJson,
      allowDelete: input.allowDelete,
      allowSeries: input.allowSeries,
    }) +
    section(
      "O QUE FAZER AQUI",
      commentAnalysisRules({ allowSeries: input.allowSeries })
    ) +
    section("CONTEXTO", contexto) +
    section("O COMENTÁRIO", input.comment)
  );
}
