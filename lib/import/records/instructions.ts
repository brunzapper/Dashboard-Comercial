// Versão: 1.0 | Data: 30/07/2026
// SPEC do prompt de "Inserir registros com IA" — DERIVADO do código (mesma
// regra do SPEC de dashboards): as colunas core saem de EDITABLE_CORE_COLUMNS,
// os rótulos de tipo de DATA_TYPE_LABELS e as moedas de CURRENCY_OPTIONS.
// Coluna core nova sem cobertura aqui QUEBRA o teste de paridade
// (lib/import/records/instructions.test.ts) — nunca documente em prosa paralela.
// Módulo PURO (testável no Vitest); o core (lib/ai/insert-records.ts) monta o
// system prompt final com o catálogo/amostras da base.
import {
  EDITABLE_CORE_COLUMNS,
} from "@/lib/config/core-writeback";
import { DATA_TYPE_LABELS, type DataType } from "@/lib/records/types";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import {
  MAX_AI_INSERT_RECORDS,
  RECORDS_INSERT_FORMAT,
  RECORDS_INSERT_VERSION,
} from "@/lib/import/records/types";

// Mesmo separador de seção do prompt de dashboards (generate-dashboard.ts).
function section(title: string, body: string): string {
  return `\n\n============================================================\n# ${title}\n============================================================\n\n${body.trim()}\n`;
}

export const RECORDS_SPEC_EXAMPLE = `{
  "formato": "${RECORDS_INSERT_FORMAT}",
  "versao": ${RECORDS_INSERT_VERSION},
  "registros": [
    {
      "title": "Proposta ACME",
      "value": 1250.5,
      "currency": "BRL",
      "closed": false,
      "closed_at": "2026-07-28",
      "responsible_id": "Maria Silva",
      "custom:origem_lead": "Indicação"
    },
    {
      "title": "Consultoria Beta",
      "value": 900,
      "responsible_id": "Maria Silva"
    }
  ],
  "notas": [
    "O telefone informado para a ACME não tem campo correspondente na base e ficou de fora."
  ]
}`;

const coreLines = Object.entries(EDITABLE_CORE_COLUMNS)
  .map(
    ([col, dt]) =>
      `  - "${col}" (${DATA_TYPE_LABELS[dt as DataType]}${col === "title" ? "; OBRIGATÓRIO em todo registro" : ""})`
  )
  .join("\n");

const currencyCodes = CURRENCY_OPTIONS.map((c) => c.value).join(", ");

export const RECORDS_SPEC = `
Responda SEMPRE com UM único bloco de JSON no formato abaixo — sem nenhum texto
fora do bloco. O JSON descreve os registros a inserir na base indicada; NADA é
gravado sem o usuário revisar a prévia e confirmar.

Envelope:
- "formato": "${RECORDS_INSERT_FORMAT}" e "versao": ${RECORDS_INSERT_VERSION} (fixos).
- "registros": lista de objetos { chave: valor } — NO MÁXIMO ${MAX_AI_INSERT_RECORDS} registros por
  resposta. Se o usuário fornecer mais de ${MAX_AI_INSERT_RECORDS}, inclua APENAS os ${MAX_AI_INSERT_RECORDS} primeiros
  e explique em "notas" quais ficaram de fora.
- "notas": lista opcional de avisos ao usuário (dado sem campo correspondente,
  valor normalizado, ambiguidade…). Use sempre que descartar ou adaptar algo.

Chaves aceitas em cada registro (QUALQUER outra chave é erro):
- Colunas do núcleo (nome cru):
${coreLines}
- Campos personalizados da base: "custom:<field_key>" — só os listados em
  CAMPOS DA BASE. Campo de Seleção aceita APENAS uma das opções listadas.
- "responsible_id" e "operation_id": o NOME cadastrado (exatamente como listado
  em CAMPOS DA BASE). Só os inclua quando o usuário citar o responsável/a
  operação; nunca invente.

Formato dos valores:
- Número/Moeda: número JSON puro (1250.5) — nunca "R$ 1.250,50".
- "currency": um dos códigos ${currencyCodes}.
- Booleano: true/false.
- Datas (core "closed_at"/"opened_at" e campos personalizados de Data):
  "YYYY-MM-DD" (sem hora), mesmo que as amostras mostrem hora/offset. Resolva
  expressões relativas ("hoje", "ontem", "sexta passada") pela data de HOJE
  informada no cabeçalho.
- Campo vazio/não informado: OMITA a chave (não envie "" nem null).
- NUNCA invente dados: use somente o que o usuário forneceu, apenas
  normalizando o formato. Copie as convenções dos dados existentes mostrados em
  AMOSTRAS (capitalização, nomes de etapas, grafia de valores de texto).

Conversa: o usuário pode pedir ajustes na sequência. Sua resposta SUBSTITUI a
proposta anterior INTEIRA — re-inclua os registros que continuarem desejados.

Exemplo:
${RECORDS_SPEC_EXAMPLE}
`;

export interface RecordsPromptParts {
  /** Rótulo + key da base alvo (ex.: Parceiros ("parceiros")). */
  baseLabel: string;
  /** Data de HOJE em Brasília (YYYY-MM-DD) — âncora de "hoje/ontem". */
  todayIso: string;
  /** JSON do catálogo (campos aceitos, opções, responsáveis, operações). */
  catalogJson: string;
  /** JSON das amostras (registros reais, só chaves preenchidas). */
  samplesJson: string;
  /** Observação sobre a amostra (vazia/colunas descobertas). */
  samplesNote: string;
}

export function buildRecordsPromptText(parts: RecordsPromptParts): string {
  const header =
    `Você é um assistente de digitação de registros comerciais. O usuário ` +
    `descreve ou cola dados em texto livre e você os aloca nos campos da base ` +
    `${parts.baseLabel}. Data de HOJE (Brasília): ${parts.todayIso}.`;
  return (
    header +
    section("FORMATO DA RESPOSTA (obrigatório)", RECORDS_SPEC) +
    section("CAMPOS DA BASE (JSON)", parts.catalogJson) +
    section(
      "AMOSTRAS DE DADOS (formato a copiar)",
      `${parts.samplesNote}\n\n${parts.samplesJson}`
    )
  );
}
