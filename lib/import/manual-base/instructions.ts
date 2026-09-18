// Versão: 1.1 | Data: 18/09/2026
// SPEC do assistente da BASE MANUAL — módulo PURO e DERIVADO das constantes
// reais (formato/versão/tetos de ./types, os modos de contagem de
// lib/manual-base/types). Constante nova aparece aqui sozinha; o teste de
// paridade fiscaliza e roda o EXEMPLO pelo validador REAL.
//
// O MESMO texto serve o chat interno e o "Copiar prompt" para IA externa — um
// contrato, duas entradas. É o que faz a Base manual funcionar numa
// organização que não tem IA configurada.
//
// v1.1 (18/09/2026): FAMÍLIAS e a ATUALIZAÇÃO de célula (0143). A frase que o
//   modelo mais erra sem ajuda explícita é a da REPARTIÇÃO: "uma linha com
//   coordenadas é a SUBDIVISÃO, não um lançamento extra" — sem dizer isso, ele
//   lança o total E as partes, e a soma ingênua dobra. E `modo`, porque sem
//   declarar que relançar ATUALIZA, o modelo propõe a linha nova "por
//   segurança".
import {
  MANUAL_SPREADS,
  MANUAL_SPREAD_HINTS,
  MANUAL_SPREAD_LABELS,
} from "@/lib/manual-base/types";

import {
  MANUAL_BASE_FORMAT,
  MANUAL_BASE_VERSION,
  MANUAL_ENTRY_MODES,
  MAX_AI_MANUAL_ENTRIES,
  MAX_AI_MANUAL_FAMILIES,
  MAX_AI_MANUAL_FAMILY_MEMBERS,
  MAX_AI_MANUAL_SERIES,
} from "./types";

const section = (title: string, body: string): string =>
  `\n\n==== ${title} ====\n\n${body.trim()}`;

export const MANUAL_BASE_SPEC_EXAMPLE = `{
  "formato": "${MANUAL_BASE_FORMAT}",
  "versao": ${MANUAL_BASE_VERSION},
  "dados": [
    { "chave": "emails_replied", "rotulo": "# Emails replied" },
    { "chave": "emails_delivered", "rotulo": "# Emails delivered" }
  ],
  "lancamentos": [
    { "dado": "# Emails replied", "valor": 35,
      "inicio": "2026-08-01", "fim": "2026-08-31",
      "operacao": "Outbound", "distribuicao": "ancora" },
    { "dado": "# Emails delivered", "valor": 11564,
      "inicio": "2026-08-01", "fim": "2026-08-31",
      "operacao": "Outbound" }
  ],
  "notas": ["Li a tabela como dados de agosto/2026, da operação Outbound."]
}`;

/** Exemplo da REPARTIÇÃO — o total e as partes dele, que não somam entre si. */
export const MANUAL_BASE_FAMILY_EXAMPLE = `{
  "formato": "${MANUAL_BASE_FORMAT}",
  "versao": ${MANUAL_BASE_VERSION},
  "familias": [
    { "chave": "canal", "rotulo": "Canal",
      "membros": [{ "rotulo": "Ligação" }, { "rotulo": "E-mail" }] }
  ],
  "lancamentos": [
    { "dado": "Total de interações", "valor": 1000,
      "inicio": "2026-08-01", "fim": "2026-08-31" },
    { "dado": "Total de interações", "valor": 500,
      "inicio": "2026-08-01", "fim": "2026-08-31",
      "coordenadas": { "canal": "Ligação" } },
    { "dado": "Total de interações", "valor": 500,
      "inicio": "2026-08-01", "fim": "2026-08-31",
      "coordenadas": { "canal": "E-mail" } }
  ],
  "notas": ["O total e a divisão por canal são a MESMA mil interações."]
}`;

const modosLista = MANUAL_SPREADS.map(
  (s) => `  - "${s}" (${MANUAL_SPREAD_LABELS[s]}): ${MANUAL_SPREAD_HINTS[s]}`
).join("\n");

export function manualBaseSpec(): string {
  return `Responda com UM único objeto JSON (sem texto fora dele):

${MANUAL_BASE_SPEC_EXAMPLE}

"dados" (opcional, no máximo ${MAX_AI_MANUAL_SERIES}): declare AQUI só os dados que ainda
NÃO existem no catálogo. Dado que já existe não precisa ser declarado — e não
pode ser renomeado por este formato.

- "rotulo": o nome como ele vai aparecer (o cabeçalho da coluna que você leu).
- "chave" (opcional): letras minúsculas, números e "_", começando por letra.
  Sem ela, eu derivo do rótulo.

"lancamentos" (obrigatório, no máximo ${MAX_AI_MANUAL_ENTRIES}): um por número da tabela.

- "dado": o RÓTULO exato do dado (do catálogo ou de "dados").
- "valor": número puro — sem "R$", sem separador de milhar, ponto decimal.
- "inicio" e "fim": o período a que o número se refere, em AAAA-MM-DD. Para um
  número mensal, o primeiro e o último dia do mês. SEMPRE datas absolutas:
  nada de "mês passado" ou "últimos 30 dias".
- "operacao" e "responsavel" (opcionais): o NOME exato do cadastro. Omita
  quando o número for do time inteiro.
- "distribuicao" (opcional): como o número conta quando o período consultado
  não é o mesmo do lançamento. Omitida, vale o padrão do dado.
${modosLista}
- "coordenadas" (opcional): a REPARTIÇÃO deste lançamento. Ver abaixo.
- "modo" (opcional): ${MANUAL_ENTRY_MODES.map((m) => `"${m}"`).join(" ou ")}.
  Omitido, vale "substituir".

REPARTIR O MESMO NÚMERO (famílias)

Uma "família" é uma maneira de dividir o MESMO número. "Total de interações:
1000", "dessas, 500 por ligação e 500 por e-mail" e "200 do Paulo, 400 da
Gabriella, 350 da Daniela e 50 sem responsável direto" são TRÊS LEITURAS DAS
MESMAS mil interações — não são 2550 interações.

${MANUAL_BASE_FAMILY_EXAMPLE}

- "familias" (opcional, no máximo ${MAX_AI_MANUAL_FAMILIES}, até ${MAX_AI_MANUAL_FAMILY_MEMBERS} membros cada):
  declare aqui só as famílias e os membros que ainda NÃO existem. Família
  existente não é renomeada por este formato.
- "coordenadas": um objeto { "família": "membro" } com o NOME (ou a chave) de
  cada um. Use null (o literal JSON) no lugar do membro para o RESIDUAL — "sem responsável
  direto" é um grupo de verdade, com número próprio, e não a ausência de
  informação.
- Sem "coordenadas", o lançamento é o TOTAL do dado.
- Duas famílias no mesmo lançamento são o CRUZAMENTO ("100 ligações do Paulo").

Regras:
1. Identifique dados, operações e responsáveis SEMPRE pelo NOME EXATO do
   catálogo — nunca invente ids. Nome que não existe no catálogo faz o
   lançamento ser RECUSADO; se a tabela citar um, diga isso em "notas".
2. Uma célula da tabela = UM lançamento. Se a mesma combinação de dado,
   período, atribuição e coordenadas aparecer duas vezes, some os valores num
   lançamento só.
3. NÃO existe exclusão neste formato. Reenviar um lançamento do mesmo dado,
   período, atribuição e coordenadas ATUALIZA o número que já está lá — é
   assim que se acompanha um mês em andamento. Apagar é pela tela. Quando o
   pedido for um INCREMENTO ("entraram mais 20"), use "modo": "somar" e ponha em
   "valor" só o que ENTROU — a soma sobre o número atual é feita no servidor,
   nunca por você.
4. Uma linha com "coordenadas" é a SUBDIVISÃO de um número, NÃO um lançamento
   extra. Se a tabela trouxer só a repartição, NÃO invente o total; se trouxer
   só o total, NÃO invente a repartição; e nunca invente o cruzamento de duas
   famílias. As leituras não se somam entre si.
5. Cabeçalho de tabela costuma trazer o período ("Dados mensais", "Agosto").
   Use-o. Quando a tabela não disser de que período é, pergunte em "notas" em
   vez de chutar um mês.
6. "notas" (opcional): o que você assumiu, em pt-BR, para a pessoa conferir
   antes de aplicar.`;
}

export const MANUAL_BASE_SPEC = manualBaseSpec();

export function buildManualBasePromptText(input: {
  catalogJson: string;
}): string {
  return (
    `Você transforma tabelas de números em lançamentos de uma "Base manual": ` +
    `métricas que a equipe acompanha sem cadastrar registro a registro ` +
    `(mensagens enviadas, contas alcançadas, investimento de mídia). O usuário ` +
    `cola a tabela ou descreve os números; você devolve os lançamentos no ` +
    `formato abaixo, usando só os nomes do catálogo.` +
    section("FORMATO DA RESPOSTA", manualBaseSpec()) +
    section("CATÁLOGO (JSON)", input.catalogJson)
  );
}
