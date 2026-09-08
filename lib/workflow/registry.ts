// Versão: 1.0 | Data: 08/09/2026
// Catálogo em CÓDIGO dos TIPOS DE PASSO e dos PROVEDORES DE OPÇÕES do Workflow
// (0125). Metadata PURA e client-safe (precedente de lib/ai/operacao/scopes.ts):
// o manager do admin é um componente client e precisa dos rótulos; a execução
// e a carga de opções ficam nos módulos server-only (execute.ts / options.ts).
//
// Tipo de passo novo = entrada aqui + parse em types.ts + handler em
// steps/<...>.ts + ramo em execute.ts. Os quatro juntos, ou a UI oferece um
// passo que o executor não sabe rodar.
import type { WorkflowOptionsSource } from "./types";

export interface WorkflowStepTypeDef {
  type: string;
  label: string;
  description: string;
  /** Exige uma conexão do registry (lib/workflow/connections.ts). */
  needsConnection: boolean;
  /** O passo produz um id reaproveitável por {{steps.<id>.id}}. */
  producesId: boolean;
}

export const WORKFLOW_STEP_TYPES_CATALOG: WorkflowStepTypeDef[] = [
  {
    type: "bitrix.entity.add",
    label: "Criar entidade no Bitrix24",
    description:
      "Chama crm.<entidade>.add com os campos montados a partir do formulário. O id devolvido fica disponível para os passos seguintes.",
    needsConnection: true,
    producesId: true,
  },
  {
    type: "record.create",
    label: "Gravar registro local",
    description:
      "Cria a linha em `records` na base escolhida. Vinculada ao id de um passo anterior, o próximo sync adota a linha em vez de duplicá-la.",
    needsConnection: false,
    producesId: false,
  },
];

export function stepTypeDef(type: string): WorkflowStepTypeDef | null {
  return WORKFLOW_STEP_TYPES_CATALOG.find((t) => t.type === type) ?? null;
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
