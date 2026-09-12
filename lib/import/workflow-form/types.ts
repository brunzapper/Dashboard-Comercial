// Versão: 1.0 | Data: 12/09/2026
// Contrato "formulario-preencher" v1 — a IA lê o texto de quem descreve um lead
// e devolve as RESPOSTAS de um formulário do Workflow. Módulo PURO.
//
// A diferença em relação ao `registros-insert`: aqui a IA não propõe um
// registro, ela propõe o PREENCHIMENTO de um formulário que já existe na tela. O
// que ela devolve vai para as caixas, e quem cria é a pessoa clicando em Lançar
// (invariante 25 — a IA nunca escreve). Por isso o contrato é de UM conjunto de
// respostas, não de uma lista: o formulário da tela é um.
//
// As chaves aceitas são as do PRÓPRIO esquema (`WorkflowFormField.key`), e por
// isso o catálogo é montado em runtime — não há lista fixa a documentar.

export const FORM_FILL_FORMAT = "formulario-preencher";
export const FORM_FILL_VERSION = 1;

/** Um campo oferecido à IA, já com o que ela precisa para decidir o valor. */
export interface FormFillFieldSpec {
  key: string;
  label: string;
  /** Tipo do campo do esquema (WORKFLOW_FIELD_TYPES). */
  type: string;
  required: boolean;
  /**
   * Opções aceitas quando o campo é `selecao`. Vazio = o campo é de seleção mas
   * a lista não carregou (sync não rodou); aí o campo NÃO é oferecido, porque
   * qualquer valor seria inventado.
   */
  options?: string[];
  placeholder?: string;
  help?: string;
}

/** Contexto do turno: o formulário alvo, montado do esquema + options vivas. */
export interface FormFillContext {
  schemaKey: string;
  schemaLabel: string;
  fields: FormFillFieldSpec[];
}

/** Respostas propostas: chave do campo → valor em TEXTO (é o que o form leva). */
export type FormFillValues = Record<string, string>;
