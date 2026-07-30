// Versão: 1.0 | Data: 30/07/2026
// SPEC do prompt de sugestão de mapeamento de CSV por IA — DERIVADO do código:
// alvos core de CORE_IMPORT_TARGETS e tipos de campo novo de
// IMPORT_NEW_FIELD_TYPES (lib/import/csv.ts). Alvo novo sem cobertura aqui
// quebra o teste de paridade (lib/import/csv-mapping/instructions.test.ts).
// Módulo PURO; o core (lib/ai/csv-mapping.ts) injeta colunas/amostras/campos.
import {
  CORE_IMPORT_TARGETS,
  IMPORT_NEW_FIELD_TYPES,
} from "@/lib/import/csv";
import { DATA_TYPE_LABELS, type DataType } from "@/lib/records/types";
import {
  CSV_MAPPING_FORMAT,
  CSV_MAPPING_VERSION,
} from "@/lib/import/csv-mapping/validate";

function section(title: string, body: string): string {
  return `\n\n============================================================\n# ${title}\n============================================================\n\n${body.trim()}\n`;
}

export const CSV_MAPPING_SPEC_EXAMPLE = `{
  "formato": "${CSV_MAPPING_FORMAT}",
  "versao": ${CSV_MAPPING_VERSION},
  "colunas": [
    { "coluna": "Nome do Cliente", "alvo": "core:title" },
    { "coluna": "Vlr Contrato", "alvo": "core:value" },
    { "coluna": "Vendedor", "alvo": "responsible" },
    { "coluna": "Observações", "alvo": "new", "novo_rotulo": "Observações", "novo_tipo": "texto" },
    { "coluna": "Coluna interna X", "alvo": "ignore" }
  ],
  "notas": [
    "\\"Coluna interna X\\" parece ser um controle interno sem campo correspondente — marquei ignore."
  ]
}`;

const coreTargetLines = CORE_IMPORT_TARGETS.map(
  (t) => `  - "${t.value}" — ${t.label} (${DATA_TYPE_LABELS[t.kind as DataType]})`
).join("\n");

const newTypeList = IMPORT_NEW_FIELD_TYPES.join(", ");

export const CSV_MAPPING_SPEC = `
Responda SEMPRE com UM único bloco de JSON no formato abaixo — sem texto fora
do bloco. Sua tarefa é propor o DESTINO de cada coluna do CSV na base indicada;
o usuário revisa a proposta na tabela do assistente de importação antes de
importar (nada é gravado agora).

Envelope:
- "formato": "${CSV_MAPPING_FORMAT}" e "versao": ${CSV_MAPPING_VERSION} (fixos).
- "colunas": UM item por coluna do CSV (todas — nenhuma pode faltar), com:
  - "coluna": o nome EXATO da coluna no CSV (como listado em COLUNAS DO CSV).
  - "alvo": um dos destinos aceitos (abaixo).
  - "novo_rotulo"/"novo_tipo": só quando "alvo" = "new".
- "notas": lista opcional de avisos ao usuário (coluna ambígua, palpite…).

Destinos aceitos ("alvo"):
- Colunas do sistema (nomes DIFERENTES no CSV são normais — case o SIGNIFICADO,
  ex.: "Cliente"/"Empresa" → core:title, "Data venda" → core:closed_at):
${coreTargetLines}
- "custom:<field_key>" — campo personalizado EXISTENTE da base (listados em
  CAMPOS EXISTENTES; case por rótulo/semântica, não pelo nome literal).
- "responsible" — coluna com o NOME do responsável/vendedor.
- "new" — não há campo correspondente: propor campo novo com "novo_rotulo"
  (nome legível) e "novo_tipo" (${newTypeList}), inferindo o tipo pelas
  amostras.
- "ignore" — coluna sem valor de negócio (ids internos, duplicadas…). Prefira
  "new" a "ignore" quando o dado parecer útil; explique ignores em "notas".

Regras:
- Cada destino (fora ignore/responsible) aceita UMA coluna só.
- NUNCA invente coluna que não está no CSV nem campo que não está listado.

Exemplo:
${CSV_MAPPING_SPEC_EXAMPLE}
`;

export interface CsvMappingPromptParts {
  /** Rótulo + key da base alvo. */
  baseLabel: string;
  /** JSON das colunas do CSV com amostras de valores. */
  columnsJson: string;
  /** JSON dos campos personalizados existentes da base. */
  customFieldsJson: string;
}

export function buildCsvMappingPromptText(parts: CsvMappingPromptParts): string {
  const header =
    `Você é um assistente de importação de CSV. Proponha o mapeamento ` +
    `coluna→campo para a base ${parts.baseLabel}.`;
  return (
    header +
    section("FORMATO DA RESPOSTA (obrigatório)", CSV_MAPPING_SPEC) +
    section("COLUNAS DO CSV (com amostras)", parts.columnsJson) +
    section("CAMPOS EXISTENTES da base (destinos custom:)", parts.customFieldsJson)
  );
}
