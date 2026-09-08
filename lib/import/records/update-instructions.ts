// Versão: 1.1 | Data: 07/08/2026
// v1.1 (07/08/2026): SPEC do MODO SELEÇÃO — variante do contrato para "Editar
//   com IA" sobre registros SELECIONADOS na tabela: sem "filtros" (o alvo já
//   é a seleção; o validador roda com { selection: true }), amostras = os
//   próprios selecionados. buildRecordsUpdatePromptText ganha o parâmetro
//   `mode` ("filters" default | "selection").
// SPEC do prompt de "Atualizar registros com IA" — DERIVADO do código (mesma
// regra dos SPECs de dashboards/inserção): operadores de filtro saem de
// FILTER_OPS (lib/widgets/filter-ops — op novo sem cobertura quebra o teste de
// paridade), colunas core de EDITABLE_CORE_COLUMNS, rótulos de tipo de
// DATA_TYPE_LABELS, moedas de CURRENCY_OPTIONS e o teto de
// MAX_AI_UPDATE_RECORDS. Fiscalizado por update-instructions.test.ts — nunca
// documente em prosa paralela. Módulo PURO; o core (lib/ai/update-records.ts)
// monta o system final com o catálogo/amostras da base.
import { EDITABLE_CORE_COLUMNS } from "@/lib/config/core-writeback";
import { DATA_TYPE_LABELS, type DataType } from "@/lib/records/types";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";
import {
  MAX_AI_UPDATE_RECORDS,
  RECORDS_UPDATE_FORMAT,
  RECORDS_UPDATE_VERSION,
} from "@/lib/import/records/update-types";

// Mesmo separador de seção do prompt de dashboards (generate-dashboard.ts).
function section(title: string, body: string): string {
  return `\n\n============================================================\n# ${title}\n============================================================\n\n${body.trim()}\n`;
}

export const RECORDS_UPDATE_SPEC_EXAMPLE = `{
  "formato": "${RECORDS_UPDATE_FORMAT}",
  "versao": ${RECORDS_UPDATE_VERSION},
  "filtros": [
    { "field": "custom:fonte", "op": "eq", "value": "Formulário de CRM" }
  ],
  "alteracoes": {
    "custom:sdr_reuniao": "Paulo Vitor Santos"
  },
  "notas": [
    "Registros de demonstração são pulados automaticamente."
  ]
}`;

const opLines = FILTER_OPS.map((o) => `  - "${o.op}" (${o.label})`).join("\n");

const coreLines = Object.entries(EDITABLE_CORE_COLUMNS)
  .map(([col, dt]) => `  - "${col}" (${DATA_TYPE_LABELS[dt as DataType]})`)
  .join("\n");

const currencyCodes = CURRENCY_OPTIONS.map((c) => c.value).join(", ");

export const RECORDS_UPDATE_SPEC = `
Responda SEMPRE com UM único bloco de JSON no formato abaixo — sem nenhum texto
fora do bloco. O JSON descreve UMA atualização em massa na base indicada: os
registros que casam os FILTROS recebem as ALTERAÇÕES. NADA é gravado sem o
usuário revisar a prévia (contagem + amostra dos registros afetados) e
confirmar. Você NUNCA emite ids de registro — o servidor resolve quem casa.

Envelope:
- "formato": "${RECORDS_UPDATE_FORMAT}" e "versao": ${RECORDS_UPDATE_VERSION} (fixos).
- "filtros": lista de condições em E (todas precisam valer) — OBRIGATÓRIA, com
  ao menos 1 condição. Atualizar a base inteira não é permitido: se o usuário
  pedir "todos", peça um recorte. NUNCA invente filtro mais largo nem mais
  estreito que o pedido do usuário.
- "alteracoes": objeto { chave: valor } com os campos a gravar em TODOS os
  registros do recorte — ao menos 1 chave.
- "notas": lista opcional de avisos ao usuário.
- No MÁXIMO ${MAX_AI_UPDATE_RECORDS} registros podem ser alterados por operação — recorte maior é
  recusado na prévia; sugira filtros mais específicos em "notas" se suspeitar
  de recorte grande.

Cada filtro é { "field", "op", "value" }:
- "field": um dos campos listados em CAMPOS DE FILTRO (colunas core cruas,
  "custom:<field_key>", "responsible_id"/"operation_id").
- "op": um destes operadores (QUALQUER outro é erro):
${opLines}
- "value": texto/número. Para "in", SEMPRE uma lista JSON (["A", "B"]). Para
  "is_null"/"not_null", omita "value". Datas em "YYYY-MM-DD".
- "responsible_id"/"operation_id" em filtro: use o NOME cadastrado (nunca id) e
  apenas os operadores eq/neq/in/is_null/not_null.

Chaves aceitas em "alteracoes" (QUALQUER outra é erro):
- Colunas do núcleo (nome cru):
${coreLines}
- Campos personalizados da base: "custom:<field_key>" — só os listados em
  CAMPOS DA BASE. Campo de Seleção aceita APENAS uma das opções listadas.
- "responsible_id" e "operation_id": o NOME cadastrado exatamente como listado.

Formato dos valores de alteração:
- Número/Moeda: número JSON puro (1250.5) — nunca "R$ 1.250,50".
- "currency": um dos códigos ${currencyCodes}.
- Booleano: true/false.
- Datas: "YYYY-MM-DD" (sem hora). Resolva expressões relativas ("hoje",
  "ontem") pela data de HOJE informada no cabeçalho.
- null LIMPA o campo em todos os registros do recorte ("title" nunca pode ser
  limpo). Campo que o usuário não mandou alterar: OMITA a chave.
- NUNCA invente valores: use somente o que o usuário pediu, apenas
  normalizando o formato às convenções das AMOSTRAS.

Uma resposta = UMA operação (um par filtros+alterações). Pedidos com recortes
diferentes viajam em turnos separados — diga em "notas" o que ficou para o
próximo passo. O usuário pode pedir ajustes na sequência: sua resposta
SUBSTITUI a proposta anterior INTEIRA.

Exemplo:
${RECORDS_UPDATE_SPEC_EXAMPLE}
`;

// ---------------------------------------------------------------------------
// MODO SELEÇÃO: os alvos JÁ estão selecionados na tela — só "alteracoes".
// ---------------------------------------------------------------------------

export const RECORDS_UPDATE_SELECTION_SPEC_EXAMPLE = `{
  "formato": "${RECORDS_UPDATE_FORMAT}",
  "versao": ${RECORDS_UPDATE_VERSION},
  "alteracoes": {
    "custom:sdr_reuniao": "Paulo Vitor Santos"
  },
  "notas": [
    "Registros de demonstração são pulados automaticamente."
  ]
}`;

export const RECORDS_UPDATE_SELECTION_SPEC = `
Responda SEMPRE com UM único bloco de JSON no formato abaixo — sem nenhum texto
fora do bloco. Os registros-alvo JÁ ESTÃO SELECIONADOS na tela pelo usuário (o
cabeçalho informa a contagem; a seção REGISTROS SELECIONADOS traz uma amostra
deles) — o JSON descreve APENAS as ALTERAÇÕES aplicadas a TODOS os
selecionados. NADA é gravado sem o usuário revisar a prévia (antes → depois) e
confirmar. Você NUNCA emite ids de registro e NUNCA emite "filtros": omita a
chave "filtros" (ou envie []) — emiti-la com condições é erro.

Envelope:
- "formato": "${RECORDS_UPDATE_FORMAT}" e "versao": ${RECORDS_UPDATE_VERSION} (fixos).
- "alteracoes": objeto { chave: valor } com os campos a gravar em TODOS os
  registros selecionados — ao menos 1 chave.
- "notas": lista opcional de avisos ao usuário.
- No MÁXIMO ${MAX_AI_UPDATE_RECORDS} registros por operação (a seleção da tela já respeita
  esse teto).

Chaves aceitas em "alteracoes" (QUALQUER outra é erro):
- Colunas do núcleo (nome cru):
${coreLines}
- Campos personalizados da base: "custom:<field_key>" — só os listados em
  CAMPOS DA BASE. Campo de Seleção aceita APENAS uma das opções listadas.
- "responsible_id" e "operation_id": o NOME cadastrado exatamente como listado.

Formato dos valores de alteração:
- Número/Moeda: número JSON puro (1250.5) — nunca "R$ 1.250,50".
- "currency": um dos códigos ${currencyCodes}.
- Booleano: true/false.
- Datas: "YYYY-MM-DD" (sem hora). Resolva expressões relativas ("hoje",
  "ontem") pela data de HOJE informada no cabeçalho.
- null LIMPA o campo em todos os selecionados ("title" nunca pode ser limpo).
  Campo que o usuário não mandou alterar: OMITA a chave.
- NUNCA invente valores: use somente o que o usuário pediu, apenas
  normalizando o formato às convenções dos REGISTROS SELECIONADOS.

Uma resposta = UMA operação. O usuário pode pedir ajustes na sequência: sua
resposta SUBSTITUI a proposta anterior INTEIRA.

Exemplo:
${RECORDS_UPDATE_SELECTION_SPEC_EXAMPLE}
`;

export interface RecordsUpdatePromptParts {
  /** Rótulo + key da base alvo (ex.: Reunião ("reunioes_qualificadas")). */
  baseLabel: string;
  /** Data de HOJE em Brasília (YYYY-MM-DD) — âncora de "hoje/ontem". */
  todayIso: string;
  /** JSON do catálogo (alvos, campos de filtro, responsáveis, operações). */
  catalogJson: string;
  /** JSON das amostras (registros reais, só chaves preenchidas). */
  samplesJson: string;
  /** Observação sobre a amostra (vazia/colunas descobertas). */
  samplesNote: string;
  /** Modo seleção: contagem de registros selecionados (cabeçalho). */
  selectionCount?: number;
}

export function buildRecordsUpdatePromptText(
  parts: RecordsUpdatePromptParts,
  mode: "filters" | "selection" = "filters"
): string {
  if (mode === "selection") {
    const header =
      `Você é um assistente de manutenção de registros comerciais. O usuário ` +
      `SELECIONOU ${parts.selectionCount ?? 0} registro(s) da base ${parts.baseLabel} e descreve ` +
      `uma correção em massa sobre ELES (e somente eles). ` +
      `Data de HOJE (Brasília): ${parts.todayIso}.`;
    return (
      header +
      section(
        "FORMATO DA RESPOSTA (obrigatório)",
        RECORDS_UPDATE_SELECTION_SPEC
      ) +
      section("CAMPOS DA BASE (JSON)", parts.catalogJson) +
      section(
        "REGISTROS SELECIONADOS (amostra e convenções de valor)",
        `${parts.samplesNote}\n\n${parts.samplesJson}`
      )
    );
  }
  const header =
    `Você é um assistente de manutenção de registros comerciais. O usuário ` +
    `descreve uma correção em massa e você a traduz em filtros + alterações ` +
    `sobre a base ${parts.baseLabel}. Data de HOJE (Brasília): ${parts.todayIso}.`;
  return (
    header +
    section("FORMATO DA RESPOSTA (obrigatório)", RECORDS_UPDATE_SPEC) +
    section("CAMPOS DA BASE (JSON)", parts.catalogJson) +
    section(
      "AMOSTRAS DE DADOS (convenções de valor)",
      `${parts.samplesNote}\n\n${parts.samplesJson}`
    )
  );
}
