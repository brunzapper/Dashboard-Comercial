// Versão: 1.0 | Data: 17/09/2026
// SPEC do assistente da BASE MANUAL — módulo PURO e DERIVADO das constantes
// reais (formato/versão/tetos de ./types, os modos de contagem de
// lib/manual-base/types). Constante nova aparece aqui sozinha; o teste de
// paridade fiscaliza e roda o EXEMPLO pelo validador REAL.
//
// O MESMO texto serve o chat interno e o "Copiar prompt" para IA externa — um
// contrato, duas entradas. É o que faz a Base manual funcionar numa
// organização que não tem IA configurada.
import {
  MANUAL_SPREADS,
  MANUAL_SPREAD_HINTS,
  MANUAL_SPREAD_LABELS,
} from "@/lib/manual-base/types";

import {
  MANUAL_BASE_FORMAT,
  MANUAL_BASE_VERSION,
  MAX_AI_MANUAL_ENTRIES,
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

Regras:
1. Identifique dados, operações e responsáveis SEMPRE pelo NOME EXATO do
   catálogo — nunca invente ids. Nome que não existe no catálogo faz o
   lançamento ser RECUSADO; se a tabela citar um, diga isso em "notas".
2. Uma célula da tabela = UM lançamento. Se a mesma combinação de dado,
   período e atribuição aparecer duas vezes, some os valores num lançamento só.
3. NÃO existe exclusão neste formato. Reenviar um lançamento do mesmo dado,
   período e atribuição ATUALIZA o número que já está lá — é assim que se
   acompanha um mês em andamento. Apagar é pela tela.
4. Cabeçalho de tabela costuma trazer o período ("Dados mensais", "Agosto").
   Use-o. Quando a tabela não disser de que período é, pergunte em "notas" em
   vez de chutar um mês.
5. "notas" (opcional): o que você assumiu, em pt-BR, para a pessoa conferir
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
