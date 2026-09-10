// Versão: 1.1 | Data: 10/09/2026
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

export const COMMENT_ANALYSIS_RULES = `Você está lendo UM comentário que a pessoa acabou de escrever no
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
    }) +
    section("O QUE FAZER AQUI", COMMENT_ANALYSIS_RULES) +
    section("CONTEXTO", contexto) +
    section("O COMENTÁRIO", input.comment)
  );
}
