// Versão: 1.0 | Data: 30/07/2026
// SPEC do prompt de criação de campos por IA — DERIVADO do código: tipos de
// DATA_TYPE_LABELS, moedas de CURRENCY_OPTIONS, percentual de
// PERCENT_DATA_TYPES e funções de fórmula de FORMULA_FUNC_GROUPS (o dicionário
// ÚNICO de lib/import/dashboard/settings-docs.ts — função nova no union
// FormulaFuncName sem entrada lá quebra o typecheck; sem aparecer AQUI quebra
// o teste de paridade lib/import/fields/instructions.test.ts).
// Módulo PURO; o core injeta o catálogo de campos existentes e os OPERANDOS
// reais (rótulos dos catálogos únicos de formula-server).
import {
  DATA_TYPE_LABELS,
  PERCENT_DATA_TYPES,
  type DataType,
} from "@/lib/records/types";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import { formulaFuncsIn } from "@/lib/import/dashboard/settings-docs";
import {
  FIELDS_CREATE_FORMAT,
  FIELDS_CREATE_VERSION,
  MAX_AI_CREATE_FIELDS,
} from "@/lib/import/fields/types";

function section(title: string, body: string): string {
  return `\n\n============================================================\n# ${title}\n============================================================\n\n${body.trim()}\n`;
}

export const FIELDS_SPEC_EXAMPLE = `{
  "formato": "${FIELDS_CREATE_FORMAT}",
  "versao": ${FIELDS_CREATE_VERSION},
  "campos": [
    {
      "rotulo": "Status do contrato",
      "tipo": "selecao",
      "opcoes": ["Ativo", "Encerrado", "Em negociação"]
    },
    {
      "rotulo": "Margem",
      "tipo": "calculado",
      "formula_texto": "([Valor] - [Custo]) / [Valor]",
      "percentual": true
    },
    {
      "rotulo": "Comissão",
      "tipo": "moeda",
      "moeda": { "modo": "fixed", "codigo": "BRL" }
    }
  ],
  "notas": [
    "Assumi que \\"Custo\\" é o campo existente com esse rótulo."
  ]
}`;

const typeLines = (Object.keys(DATA_TYPE_LABELS) as DataType[])
  .map((t) => `  - "${t}" — ${DATA_TYPE_LABELS[t]}`)
  .join("\n");

const currencyCodes = CURRENCY_OPTIONS.map((c) => c.value).join(", ");

export const FIELDS_SPEC = `
Responda SEMPRE com UM único bloco de JSON no formato abaixo — sem texto fora
do bloco. O JSON descreve campos personalizados a CRIAR no catálogo; o usuário
revisa a prévia e confirma antes de qualquer criação.

Envelope:
- "formato": "${FIELDS_CREATE_FORMAT}" e "versao": ${FIELDS_CREATE_VERSION} (fixos).
- "campos": lista de campos — NO MÁXIMO ${MAX_AI_CREATE_FIELDS} por resposta.
- "notas": lista opcional de avisos/premissas ao usuário.

Cada campo aceita SÓ estas chaves:
- "rotulo" (obrigatório): nome legível — a chave técnica é derivada dele no
  servidor; não pode colidir com campo existente nem coluna do núcleo (ambos
  listados em CATÁLOGO ATUAL).
- "tipo" (obrigatório), um de:
${typeLines}
- "opcoes": lista de textos — OBRIGATÓRIA (e exclusiva) do tipo selecao.
- "formula_texto": fórmula estilo planilha — OBRIGATÓRIA (e exclusiva) dos
  tipos calculado (avaliado POR REGISTRO) e calculado_agg (avaliado sobre os
  TOTAIS do recorte, em dashboards).
- "moeda": { "modo": "inherit" | "fixed", "codigo": um de ${currencyCodes} } —
  só para moeda/calculado/calculado_agg ("inherit" = moeda do registro/dos
  operandos; "fixed" exige "codigo").
- "percentual": true — exibe como % (tipos ${PERCENT_DATA_TYPES.join(", ")});
  nunca junto com "moeda".

Fórmulas ("formula_texto"):
- Referencie operandos pelo RÓTULO entre colchetes, ex.: [Valor], [MRR] — use
  EXATAMENTE os rótulos listados em OPERANDOS DISPONÍVEIS (por-registro para
  "calculado"; de agregação para "calculado_agg" — não misture os contextos).
- Funções disponíveis: lógicas ${formulaFuncsIn("logica").join(", ")};
  condicionais ${formulaFuncsIn("cond_agg").join(", ")}; puras
  ${formulaFuncsIn("pura").join(", ")}; de comparação de período
  ${formulaFuncsIn("comparacao").join(", ")}.
- Operadores: + - * / ( ) e números literais (ponto decimal).
- Em "calculado_agg", condições de SOMASE/CONT.SE sobre Responsável/Operação
  comparam pelo NOME cadastrado.

Regras:
- NUNCA invente operando: se o dado necessário não existe no catálogo, crie
  antes o campo simples correspondente (na MESMA resposta) e referencie-o.
- Papéis de visibilidade/edição e posição NÃO são seus — o sistema aplica os
  padrões.

Conversa: o usuário pode pedir ajustes na sequência. Sua resposta SUBSTITUI a
proposta anterior INTEIRA — re-inclua os campos que continuarem desejados.

Exemplo:
${FIELDS_SPEC_EXAMPLE}
`;

export interface FieldsPromptParts {
  /** JSON do catálogo atual (campos existentes + colunas core). */
  catalogJson: string;
  /** JSON dos operandos de fórmula disponíveis (por contexto). */
  operandsJson: string;
}

export function buildFieldsPromptText(parts: FieldsPromptParts): string {
  const header =
    "Você é um assistente de modelagem de campos de um CRM/dashboard " +
    "comercial. O usuário descreve os campos que precisa e você os propõe no " +
    "formato abaixo.";
  return (
    header +
    section("FORMATO DA RESPOSTA (obrigatório)", FIELDS_SPEC) +
    section("CATÁLOGO ATUAL (não colidir)", parts.catalogJson) +
    section("OPERANDOS DISPONÍVEIS (fórmulas)", parts.operandsJson)
  );
}
