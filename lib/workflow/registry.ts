// Versão: 1.2 | Data: 09/09/2026
// v1.2 (09/09/2026): `WORKFLOW_CTX_KEYS` — o que o SERVIDOR põe no contexto de
//   toda execução. Existe aqui (puro, client-safe) porque o construtor precisa
//   OFERECER essas refs: quem monta um passo não deveria ter que adivinhar que
//   existe `{{ctx.responsibleBitrixId}}`. Um teste pina esta lista contra o que
//   `buildWorkflowCtx` de fato produz — lista e realidade não podem divergir.
// v1.1 (09/09/2026): os passos que ALTERAM entram no catálogo. Um esquema é uma
//   sequência de alterações dentro e fora do sistema — criar é só uma delas.
// Catálogo em CÓDIGO dos TIPOS DE PASSO e dos PROVEDORES DE OPÇÕES do Workflow
// (0125). Metadata PURA e client-safe (precedente de lib/ai/operacao/scopes.ts):
// o manager do admin é um componente client e precisa dos rótulos; a execução
// e a carga de opções ficam nos módulos server-only (execute.ts / options.ts).
//
// Tipo de passo novo = entrada aqui + parse em types.ts + handler em
// steps/<...>.ts + ramo em execute.ts. Os quatro juntos, ou a UI oferece um
// passo que o executor não sabe rodar.
import type { WorkflowDefinition, WorkflowOptionsSource } from "./types";

export interface WorkflowStepTypeDef {
  type: string;
  label: string;
  description: string;
  /** Exige uma conexão do registry (lib/workflow/connections.ts). */
  needsConnection: boolean;
  /** O passo produz um id reaproveitável por {{steps.<id>.id}}. */
  producesId: boolean;
  /** O passo CRIA algo (não dá para desfazer). É esta chave — e só ela — que
   *  decide a trava do `run_schema` (ver `schemaIsIrreversible` abaixo). */
  creates: boolean;
}

export const WORKFLOW_STEP_TYPES_CATALOG: WorkflowStepTypeDef[] = [
  {
    type: "bitrix.entity.add",
    label: "Criar entidade no Bitrix24",
    description:
      "Chama crm.<entidade>.add com os campos montados a partir do formulário. O id devolvido fica disponível para os passos seguintes.",
    needsConnection: true,
    producesId: true,
    creates: true,
  },
  {
    type: "bitrix.entity.update",
    label: "Alterar entidade no Bitrix24",
    description:
      "Chama crm.<entidade>.update no id informado (normalmente o vínculo do registro com o CRM). Só os campos preenchidos vão — os demais ficam como estão.",
    needsConnection: true,
    producesId: true,
    creates: false,
  },
  {
    type: "record.update",
    label: "Alterar registro local",
    description:
      "Altera campos de um registro que já existe — o que disparou a automação ou o criado num passo anterior. Passa pelo mesmo executor das automações (carimbos, recálculo e auditoria).",
    needsConnection: false,
    producesId: true,
    creates: false,
  },
  {
    type: "record.create",
    label: "Gravar registro local",
    description:
      "Cria a linha em `records` na base escolhida. Vinculada ao id de um passo anterior, o próximo sync adota a linha em vez de duplicá-la.",
    needsConnection: false,
    producesId: false,
    creates: true,
  },
];

export function stepTypeDef(type: string): WorkflowStepTypeDef | null {
  return WORKFLOW_STEP_TYPES_CATALOG.find((t) => t.type === type) ?? null;
}

/**
 * O esquema cria alguma coisa? DERIVADO do `creates` dos passos habilitados —
 * não existe interruptor para desalinhar do que o esquema de fato faz, e é
 * daqui que sai a trava do `run_schema`:
 *   irreversível ⇒ a automação consome o registro UMA vez por regra, para
 *     sempre (não dá para desfazer uma entidade criada num sistema externo);
 *   repetível (só alterações) ⇒ reexecuta quando o payload resolvido MUDA — a
 *     mesma idempotência por comparação do `set_field`.
 * Tipo fora do catálogo conta como criador: na dúvida, a trava mais apertada.
 */
export function schemaIsIrreversible(def: WorkflowDefinition): boolean {
  return def.steps.some(
    (s) => s.enabled && (stepTypeDef(s.type)?.creates ?? true)
  );
}

export interface WorkflowOptionsSourceDef {
  key: WorkflowOptionsSource;
  label: string;
  /** De onde as opções saem — texto exibido ao admin, para ele saber por que
   *  a lista está vazia (quase sempre: o sync ainda não rodou). */
  origin: string;
}

export const WORKFLOW_OPTIONS_SOURCES_CATALOG: WorkflowOptionsSourceDef[] = [
  {
    key: "bitrix:sources",
    label: "Fontes do Bitrix",
    origin:
      "Origens do portal, materializadas nas opções do campo `fonte` pelo sync do catálogo.",
  },
  {
    key: "bitrix:lead_status",
    label: "Etapas de lead do Bitrix",
    origin:
      "Etapas do portal, materializadas nas opções da coluna `stage` pelo sync do catálogo.",
  },
  {
    key: "responsibles",
    label: "Responsáveis",
    origin: "Responsáveis ativos principais da organização.",
  },
  {
    key: "static",
    label: "Lista fixa",
    origin: "Opções digitadas aqui mesmo.",
  },
];

export function optionsSourceDef(
  key: string
): WorkflowOptionsSourceDef | null {
  return WORKFLOW_OPTIONS_SOURCES_CATALOG.find((o) => o.key === key) ?? null;
}

/** Uma ref de contexto oferecível no construtor. */
export interface WorkflowCtxKeyDef {
  key: string;
  label: string;
  /** Quando ela existe — nem toda execução tem registro que a disparou. */
  availability: string;
}

export const WORKFLOW_CTX_KEYS: WorkflowCtxKeyDef[] = [
  {
    key: "responsibleBitrixId",
    label: "Id do responsável no Bitrix",
    availability: "Do responsável resolvido para esta execução.",
  },
  {
    key: "contatoPrimeiroNome",
    label: "Primeiro nome do contato",
    availability: "Separado do campo `contato_nome` do formulário.",
  },
  {
    key: "contatoSobrenome",
    label: "Sobrenome do contato",
    availability: "Separado do campo `contato_nome` do formulário.",
  },
  {
    key: "usuarioEmail",
    label: "E-mail de quem executou",
    availability: "Vazio quando quem disparou foi uma automação.",
  },
  {
    key: "triggerRecordId",
    label: "Registro que disparou",
    availability: "Só em execução disparada por uma automação.",
  },
];
