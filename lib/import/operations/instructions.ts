// Versão: 1.0 | Data: 31/07/2026
// SPEC do assistente de IA de OPERAÇÕES — módulo PURO, DERIVADO das
// constantes reais (PROFILE_OPS/NO_VALUE_OPS do módulo compartilhado com o
// choke point; formato/versão/teto de ./types): chave nova nesses conjuntos
// aparece aqui sozinha; o teste de paridade (instructions.test.ts) fiscaliza
// e roda o EXEMPLO pelo validador real. O MESMO texto serve o chat interno
// (system do runJsonGenerationLoop) e o "Copiar prompt" para IA externa —
// um contrato, duas entradas.
import { NO_VALUE_OPS, PROFILE_OPS } from "@/lib/config/operation-profile";

import {
  MAX_AI_OPERATION_ACTIONS,
  OPERATIONS_EDIT_FORMAT,
  OPERATIONS_EDIT_VERSION,
} from "./types";

const section = (title: string, body: string): string =>
  `\n\n==== ${title} ====\n\n${body.trim()}`;

export const OPERATIONS_SPEC_EXAMPLE = `{
  "formato": "${OPERATIONS_EDIT_FORMAT}",
  "versao": ${OPERATIONS_EDIT_VERSION},
  "acoes": [
    { "acao": "criar", "nome": "Expansão Sul", "pai": "Comercial" },
    { "acao": "criar", "nome": "Expansão Sul — Litoral", "pai": "Expansão Sul",
      "perfil": [ { "field": "channel", "op": "eq_ci", "value": "Litoral" } ] },
    { "acao": "editar", "operacao": "Parcerias antigas", "ativa": false },
    { "acao": "vincular", "responsavel": "Maria Silva", "operacao": "Expansão Sul", "prioridade": 1 },
    { "acao": "desvincular", "responsavel": "João Souza", "operacao": "Comercial" }
  ],
  "notas": ["Assumi que \\"Comercial\\" é a operação raiz existente."]
}`;

export const OPERATIONS_SPEC = `Responda com UM único objeto JSON (sem texto fora dele):

${OPERATIONS_SPEC_EXAMPLE}

Semântica das ações (NO MÁXIMO ${MAX_AI_OPERATION_ACTIONS} por resposta — se precisar de mais, mantenha as ${MAX_AI_OPERATION_ACTIONS} primeiras e explique em "notas"):

- "criar": { "acao", "nome", "pai"?, "perfil"? } — cria uma operação. "pai" é o
  NOME de outra operação (existente OU criada acima na mesma resposta); omitido
  ou null = raiz. "nome" não pode colidir com operação existente.
- "editar": { "acao", "operacao", "novo_nome"?, "novo_pai"?, "ativa"?, "perfil"? }
  — altera uma operação EXISTENTE (referenciada pelo NOME atual). "novo_pai":
  null = vira raiz; omitido = não mexe. "perfil": null = limpar; lista =
  substitui o perfil INTEIRO; omitido = não mexe. Inclua ao menos uma mudança.
- "vincular": { "acao", "responsavel", "operacao", "prioridade" } — vincula um
  responsável (NOME exato do cadastro) à operação. "prioridade" é inteiro >= 1
  (1 = operação primária); cada responsável tem UMA operação por prioridade.
- "desvincular": { "acao", "responsavel", "operacao" } — desfaz um vínculo
  existente.

Regras:
1. Identifique operações e responsáveis SEMPRE pelo NOME EXATO do catálogo
   (nunca invente ids; nome ambíguo é erro).
2. NÃO existe ação de exclusão — desative com "ativa": false e deixe a
   exclusão para a tela de Operações.
3. Operações com "automatica": true no catálogo são geridas por rotina de
   parceria — NUNCA as edite, vincule, desvincule ou crie filhas sob elas.
4. "perfil" é uma lista de condições { "field", "op", "value"?, "sources"? }.
   Ops aceitos: ${[...PROFILE_OPS].join(", ")}. Os ops ${[...NO_VALUE_OPS].join(
  " e "
)} dispensam "value"; "in" exige lista não-vazia. "field" deve ser uma ref de
   campos_para_perfil e "sources" ⊆ fontes do catálogo.
5. Sua resposta SUBSTITUI a proposta pendente INTEIRA (se houver) — repita as
   ações que quer manter.
6. "notas" (opcional): avisos/suposições em pt-BR para o usuário.`;

export function buildOperationsPromptText(input: { catalogJson: string }): string {
  return (
    `Você gerencia o cadastro de OPERAÇÕES (áreas/times comerciais em árvore, ` +
    `com perfil de dados e responsáveis vinculados) de um dashboard comercial. ` +
    `O usuário descreve o que quer em linguagem natural; você devolve um lote ` +
    `de ações no formato abaixo.` +
    section("FORMATO DA RESPOSTA", OPERATIONS_SPEC) +
    section("CATÁLOGO ATUAL (JSON)", input.catalogJson)
  );
}
