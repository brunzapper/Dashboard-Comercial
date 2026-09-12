// Versão: 1.0 | Data: 12/09/2026
// SPEC do "Preencher com IA" de um formulário do Workflow — DERIVADO do código
// (mesma regra dos outros SPECs): os tipos de campo saem de
// WORKFLOW_FIELD_TYPES, e o catálogo de campos é interpolado em runtime a partir
// do próprio esquema. Tipo de campo novo sem cobertura aqui QUEBRA o teste de
// paridade (instructions.test.ts) — nunca documente em prosa paralela.
// Módulo PURO; o core (lib/ai/fill-workflow-form.ts) monta o system final.
import { WORKFLOW_FIELD_TYPES } from "@/lib/workflow/types";

import { FORM_FILL_FORMAT, FORM_FILL_VERSION } from "./types";

// Mesmo separador de seção dos outros prompts.
function section(title: string, body: string): string {
  return `\n\n============================================================\n# ${title}\n============================================================\n\n${body.trim()}\n`;
}

/**
 * Como tratar cada tipo de campo. `satisfies` fecha a porta: tipo novo em
 * WORKFLOW_FIELD_TYPES sem entrada aqui não compila.
 */
const TYPE_RULES = {
  texto: "texto curto, uma linha.",
  texto_longo: "texto livre; pode ter várias frases.",
  email: 'um endereço de e-mail. Se o usuário não informar, OMITA a chave — o formulário tem um valor padrão para esse caso.',
  telefone:
    "telefone como o usuário escreveu (com DDD quando houver); não invente dígitos.",
  numero: "número JSON puro ou texto numérico — nunca com símbolo de moeda.",
  data: 'data no formato "AAAA-MM-DD". Resolva "hoje"/"amanhã" pela data informada no cabeçalho.',
  selecao:
    "APENAS uma das opções listadas para aquele campo, copiada exatamente como aparece na lista. Nada parecido, nada novo.",
} satisfies Record<(typeof WORKFLOW_FIELD_TYPES)[number], string>;

const typeLines = WORKFLOW_FIELD_TYPES.map(
  (t) => `  - ${t}: ${TYPE_RULES[t]}`
).join("\n");

export const FORM_FILL_SPEC_EXAMPLE = `{
  "formato": "${FORM_FILL_FORMAT}",
  "versao": ${FORM_FILL_VERSION},
  "respostas": {
    "empresa": "ACME Indústria",
    "contato_nome": "Maria Silva",
    "telefone": "(11) 98888-7777",
    "email": "maria@acme.com.br",
    "fonte": "Indicação",
    "comentarios": "Procurou por indicação do time de RH; quer proposta até o fim do mês."
  },
  "notas": [
    "O cargo da Maria não tem campo neste formulário e ficou de fora."
  ]
}`;

export const FORM_FILL_SPEC = `
Responda SEMPRE com UM único bloco de JSON no formato abaixo — sem nenhum texto
fora do bloco. O JSON são as RESPOSTAS do formulário; NADA é lançado por você:
os valores entram nas caixas da tela e a pessoa revisa e clica em Lançar.

Envelope:
- "formato": "${FORM_FILL_FORMAT}" e "versao": ${FORM_FILL_VERSION} (fixos).
- "respostas": objeto { chave_do_campo: valor } — só as chaves listadas em
  CAMPOS DO FORMULÁRIO. Qualquer outra chave é erro.
- "notas": lista opcional de avisos ao usuário (dado que não tem campo, valor
  ambíguo, suposição que você fez). Use sempre que descartar ou adaptar algo.

Por tipo de campo:
${typeLines}

Regras gerais:
1. NUNCA invente dados. Use só o que o usuário escreveu, apenas normalizando o
   formato. Dado que não couber em nenhum campo vai para "notas", não para um
   campo parecido.
2. Campo que o usuário não mencionou: OMITA a chave (não envie "" nem null).
   Isso vale também para campo obrigatório — a pessoa completa na tela.
3. Nome de pessoa e nome de empresa são coisas diferentes. "Maria da ACME" tem
   contato "Maria" e empresa "ACME"; não repita o mesmo texto nos dois.
4. Em campo de seleção, se nada na lista corresponder ao que o usuário disse,
   OMITA a chave e diga em "notas" o que ele pediu e o que existe.

Conversa: o usuário pode pedir ajustes na sequência. Sua resposta SUBSTITUI a
proposta anterior INTEIRA — re-inclua as respostas que continuarem valendo.

Exemplo:
${FORM_FILL_SPEC_EXAMPLE}
`;

export interface FormFillPromptParts {
  /** Rótulo do formulário alvo. */
  schemaLabel: string;
  /** Data de HOJE em Brasília (AAAA-MM-DD) — âncora de "hoje/amanhã". */
  todayIso: string;
  /** JSON dos campos do formulário (chave, rótulo, tipo, opções). */
  catalogJson: string;
}

export function buildFormFillPromptText(parts: FormFillPromptParts): string {
  const header =
    `Você ajuda a lançar registros a partir de texto livre. O usuário descreve ` +
    `em uma ou duas frases o que quer lançar, e você aloca cada informação nos ` +
    `campos do formulário "${parts.schemaLabel}". ` +
    `Data de HOJE (Brasília): ${parts.todayIso}.`;
  return (
    header +
    section("FORMATO DA RESPOSTA (obrigatório)", FORM_FILL_SPEC) +
    section("CAMPOS DO FORMULÁRIO (JSON)", parts.catalogJson)
  );
}
