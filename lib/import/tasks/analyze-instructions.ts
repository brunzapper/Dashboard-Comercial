// Versão: 1.0 | Data: 10/09/2026
// SPEC do "Salvar e analisar" da Tree — módulo PURO.
//
// O contrato é o `tarefas-edit` que já existe: mesmo formato, mesma versão,
// MESMO validador. O que muda é o PEDIDO — em vez de "faça o que o usuário
// mandou", é "leia este comentário e decida se ele pede um próximo passo".
// Escrever um segundo contrato para isso seria a régua paralela da invariante
// 25: o objeto de saída é o mesmo, e a diferença cabe no enunciado.
//
// Duas restrições que o enunciado carrega e o core RE-IMPÕE depois de validar
// (o SPEC pede, o código garante):
//  - no máximo UMA ação, e sempre "criar". "editar"/"concluir" mexeriam em
//    tarefa que ninguém pediu para mexer, a partir de um texto que o vendedor
//    escreveu para si mesmo.
//  - `acoes: []` é resposta LEGÍTIMA. A pergunta é "vale agendar?", e "não"
//    precisa ter como ser dito — sem isso o modelo inventa uma tarefa para
//    todo comentário, e a função vira ruído.
//
// A régua de PRAZO é a parte que não sai de constante nenhuma, então está
// escrita aqui uma vez só: prazo dito no comentário vence sempre; sem prazo
// dito, o padrão de follow-up de venda SMB de SaaS. Números conservadores de
// propósito — errar para mais cedo custa um "adiar", errar para mais tarde
// custa o negócio.
import { buildTasksPromptText } from "./instructions";

const section = (title: string, body: string): string =>
  `\n\n==== ${title} ====\n\n${body.trim()}`;

/** Teto do lote nesta superfície: o comentário pede UM próximo passo, ou nenhum. */
export const MAX_COMMENT_TASK_ACTIONS = 1;

export const COMMENT_ANALYSIS_RULES = `Você está lendo UM comentário que a pessoa acabou de escrever no
acompanhamento de um registro comercial. Decida uma coisa só: esse comentário
pede um próximo passo com data?

- Se PEDE, devolva EXATAMENTE UMA ação "criar", com título curto no imperativo
  (o que fazer, não o que aconteceu) e "data" preenchida.
- Se NÃO pede — o comentário só registra um fato, um desabafo, um dado de
  cadastro, ou já descreve algo concluído — devolva "acoes": [] e explique em
  uma linha em "notas". Não invente tarefa para ter o que devolver.

NUNCA use "editar" nem "concluir" aqui: o comentário fala do que vem, não do
que já está na lista de outra pessoa.

PRAZO — nesta ordem:
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
    buildTasksPromptText({ catalogJson: input.catalogJson }) +
    section("O QUE FAZER AQUI", COMMENT_ANALYSIS_RULES) +
    section("CONTEXTO", contexto) +
    section("O COMENTÁRIO", input.comment)
  );
}
