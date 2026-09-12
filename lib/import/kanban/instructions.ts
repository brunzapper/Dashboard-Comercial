// Versão: 1.1 | Data: 12/09/2026
// v1.1 (12/09/2026): diz à IA como uma condição de DATA compara (por DIA de
//   Brasília, valor em "AAAA-MM-DD"). Sem isso ela emitiria o valor em formato
//   BR e explicaria "lte" como se excluísse o dia.
// Versão: 1.0 | Data: 07/09/2026
// SPEC do assistente de IA do QUADRO KANBAN — módulo PURO, DERIVADO das
// constantes reais (mapas de rótulo de lib/kanban/types.ts, tetos do lote e do
// parse das regras). Constante nova aparece aqui sozinha; o teste de paridade
// (instructions.test.ts) fiscaliza e roda o EXEMPLO pelo validador real. O
// MESMO texto serve o chat interno (system do runJsonGenerationLoop) e o
// "Copiar prompt" para IA externa — um contrato, duas entradas.
import { MAX_RULE_CONDITIONS } from "@/lib/kanban/automations/types";
import {
  KANBAN_AGG_LABELS,
  KANBAN_DATE_BUCKET_LABELS,
  KANBAN_MAX_BADGES,
  KANBAN_MAX_COLUMNS,
  KANBAN_METRIC_KIND_LABELS,
  KANBAN_MODE_LABELS,
} from "@/lib/kanban/types";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";

import {
  KANBAN_CONFIG_FORMAT,
  KANBAN_CONFIG_VERSION,
  MAX_AI_AUTOMATION_RULES,
} from "./types";

const section = (title: string, body: string): string =>
  `\n\n==== ${title} ====\n\n${body.trim()}`;

const enumKeys = (labels: Record<string, unknown>): string =>
  Object.keys(labels).join(" | ");

const enumKeysLabeled = (labels: Record<string, string>): string =>
  Object.entries(labels)
    .map(([k, l]) => `${k} (${l})`)
    .join(", ");

export const KANBAN_SPEC_EXAMPLE = `{
  "formato": "${KANBAN_CONFIG_FORMAT}",
  "versao": ${KANBAN_CONFIG_VERSION},
  "quadro": {
    "columnMetric": { "spec": { "kind": "field", "ref": "value" }, "agg": "sum" },
    "card": { "titleField": "title", "extraFields": ["value"], "badges": [ { "kind": "tasks", "metric": "overdue" } ] },
    "columns": [
      { "key": "novo", "label": "Entrada", "color": "#eef2ff" },
      { "key": "andamento", "label": "Em negociação", "wipLimit": 10 },
      { "key": "feito", "label": "Ganho" }
    ]
  },
  "automacoes": [
    {
      "nome": "Parado há 7 dias volta para Entrada",
      "ativa": true,
      "condicoes": [
        { "kind": "time", "basis": { "type": "in_column" }, "op": "gte", "days": 7 },
        { "kind": "tasks", "metric": "open", "op": "eq", "value": 0 }
      ],
      "acao": { "type": "move_to_column", "targetKey": "novo" }
    }
  ],
  "notas": ["Mantive as três colunas existentes e só troquei os rótulos."]
}`;

export const KANBAN_SPEC = `Responda com UM único objeto JSON (sem texto fora dele):

${KANBAN_SPEC_EXAMPLE}

As duas seções são OPCIONAIS, mas ao menos uma precisa vir. O quadro alvo é o
que o usuário tem aberto — ele NUNCA é escolhido no JSON.

## "quadro" — configuração do quadro (DELTA)

Mande só o que MUDA: o servidor mescla sobre a configuração atual (objetos
recursam, listas e valores simples substituem por inteiro). Para trocar a cor
de uma coluna, mande só "columns" com a lista completa de colunas.

- "mode": ${enumKeysLabeled(KANBAN_MODE_LABELS)}.
- "source": key de uma Base do catálogo (modo registros).
- COLUNAS, três formas mutuamente exclusivas:
  (a) "groupField": ref de um campo categórico — uma coluna por valor
      (teto ${String(KANBAN_MAX_COLUMNS)} + a coluna "Outros", que não recebe cards);
  (b) "dateField" + "dateBucket" (${enumKeys(KANBAN_DATE_BUCKET_LABELS)}) — uma
      coluna por período; mover o card REESCREVE a data do registro;
  (c) "columnSource": "custom" — fases livres, definidas em "columns"; a coluna
      do card é dado da VISÃO e não altera o registro.
- "columns": [ { "key", "label"?, "color"?, "wipLimit"?, "hidden"?, "completesTask"? } ].
  A ORDEM do array é a ordem das colunas. A "key" é a IDENTIDADE da coluna:
  renomear o "label" preserva os cards; trocar a "key" os perde. Em (a)/(b) a
  key é o valor/bucket derivado; em (c) e no modo tarefas você a define.
- "columnMetric": { "spec", "agg"? } — total no cabeçalho da coluna.
  spec: ${enumKeysLabeled(KANBAN_METRIC_KIND_LABELS)} —
  { "kind": "field", "ref": "<campo numérico>" } | { "kind": "linked", "source": "<Base RAIZ>" } |
  { "kind": "tasks", "metric": "open" | "overdue" } | { "kind": "age" }.
  agg: ${enumKeys(KANBAN_AGG_LABELS)} (ausente = padrão do indicador).
- "card": { "titleField"?, "extraFields"? (até 4), "colorField"?, "badges"? } —
  "badges" usa as mesmas specs de "columnMetric", até ${String(KANBAN_MAX_BADGES)}.
- "writeBack": true grava a mudança de coluna de volta no Bitrix (só modo
  registros com colunas por VALOR); false/ausente = a edição fica local.
- "tasks": { "lockByDefault"?, "dueSoonDays"? } — só no modo tarefas.

## "automacoes" — regras que movem cards e gravam campos

A lista é a LISTA COMPLETA desejada: regra que você omitir é DESATIVADA (nunca
excluída — excluir é da tela). A ordem do array é a ordem de avaliação, e por
card vence a PRIMEIRA regra cujas condições TODAS casem. No máximo
${String(MAX_AI_AUTOMATION_RULES)} regras por resposta e ${String(MAX_RULE_CONDITIONS)} condições por regra.

Cada regra: { "nome", "ativa"?, "condicoes": [...], "acao": {...} }. O "nome" é
a IDENTIDADE — repetir o nome de uma regra existente a ATUALIZA; nome novo cria.

Condições (todas em E; misture as famílias à vontade):
- { "kind": "field", "filter": { "field": "<ref>", "op": "<op>", "value": ... } }
  — condição sobre um campo do registro. Ops: ${FILTER_OPS.map((o) => o.op).join(", ")}.
  Em campo de DATA, escreva o valor como "AAAA-MM-DD" e a comparação é por DIA
  (de Brasília): "lte" inclui o próprio dia, "lt" exclui o dia inteiro e "eq"
  significa "no mesmo dia", independentemente da hora gravada.
- { "kind": "related_count", "source": "<Base RAIZ>", "filters": [...], "op": "gte|lte|eq", "value": 3 }
  — quantos registros CONECTADOS daquela Base o card tem.
- { "kind": "tasks", "metric": "open" | "overdue", "op": "gte|lte|eq", "value": 0 }
- { "kind": "time", "basis": {...}, "op": "gte|lte", "days": 7 } — dias corridos.
  basis: { "type": "created" } (criação na origem) |
         { "type": "in_column" } (entrada na coluna atual — só colunas "Personalizar") |
         { "type": "field_changed", "field": "<ref>" } (última alteração do campo).

Ações (uma por regra):
- { "type": "move_to_column", "targetKey": "<key de coluna>" } — a coluna
  precisa existir no quadro; a coluna "Outros" não recebe cards.
- { "type": "set_field", "field": "<ref>", "value": "<texto>" } — grava um valor
  FIXO. Campos de data, calculados, de relação, casados/unificados, colunas do
  núcleo não editáveis e o campo-espelho da fase deste quadro NÃO são alvos
  válidos; use a lista "campos_graváveis" do catálogo.

Regras gerais:
1. Use SEMPRE refs e keys EXATAS do catálogo — nunca invente campo, Base ou
   coluna, e nunca invente ids (a regra é reconhecida pelo NOME).
2. Mocks nunca são movidos, e uma regra cujo alvo sumiu fica inerte com erro
   visível — prefira condições que você consegue explicar em "notas".
3. Sua resposta SUBSTITUI a proposta pendente INTEIRA (se houver) — repita o
   que quiser manter.
4. "notas" (opcional): avisos e suposições em pt-BR para o usuário.`;

export function buildKanbanPromptText(input: { catalogJson: string }): string {
  return (
    `Você configura um QUADRO KANBAN de um dashboard comercial: as colunas, o ` +
    `que aparece nos cards, o indicador do cabeçalho e as automações que movem ` +
    `cards ou gravam campos sozinhas. O usuário descreve o que quer em ` +
    `linguagem natural; você devolve a configuração no formato abaixo.` +
    section("FORMATO DA RESPOSTA", KANBAN_SPEC) +
    section("QUADRO ATUAL E CATÁLOGO (JSON)", input.catalogJson)
  );
}
