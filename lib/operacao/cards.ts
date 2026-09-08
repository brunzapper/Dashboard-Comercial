// Versão: 1.2 | Data: 08/09/2026
// v1.2 (08/09/2026): o catálogo passa a ter DUAS fontes. Os cards de MÓDULO
//   seguem em código (Agenda, Tarefas, Remuneração, Mapeamentos, Workflow) —
//   indeletáveis por construção, como sempre foram. Os cards de FORMULÁRIO
//   vêm de `workflow_schemas` (0125/0126): o Workflow é a fábrica, e o que ele
//   produz aparece FORA dele — cada formulário ganha página própria
//   (/operacao/f/<chave>, URL copiável para mandar ao time) e um card aqui.
//   O espírito da regra antiga está preservado: nenhum card do hub tem menu
//   "⋮" nem UI de exclusão — criar e excluir formulário acontece só dentro do
//   Workflow, nunca no hub.
// v1.1 (08/09/2026): card `workflow` (0125).
// Cards de OPERAÇÃO (aba "Operação" do hub Workspace + sub-abas de /operacao).
// Card com `area` é org-específico: aparece só quando checkSettingsArea(area)
// passa (precedência feature-off > deny > allow > gate de papel —
// lib/auth/access.ts), ou seja, liga/desliga por org via org_features (escrita
// service-role-only, console /owner) — o org_admin não se auto-habilita. Card
// SEM `area` é PADRÃO de toda organização (Agenda, Tarefas). Card de MÓDULO
// novo org-específico = entrada aqui + chave em ORG_FEATURES +
// AREA_GATES/AREA_FEATURES (chave de área é histórica — nunca renomear).
// Ordem: módulos padrão, módulos org-específicos, formulários ao final.
import { checkSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import {
  loadFormSchemaCards,
  type WorkflowFormCard,
} from "@/lib/workflow/schemas";
// Rotas num módulo PURO: este arquivo é server-only (checkSettingsArea) e o
// manager da fábrica, que é client, precisa montar a mesma URL.
import {
  FORM_CARD_KEY_PREFIX,
  formSchemaHref,
} from "@/lib/operacao/form-routes";

export { FORM_CARD_PREFIX, formSchemaHref } from "@/lib/operacao/form-routes";

/** Origem do card — a UI usa para escolher o ícone; a key de formulário é
 *  dinâmica e não tem entrada no mapa de ícones do hub. */
export type OperacaoCardKind = "modulo" | "formulario";

export interface OperacaoCard {
  key: string;
  label: string;
  /** Texto do CardDescription no hub. */
  description: string;
  href: string;
  /** Chave de ÁREA histórica (AREA_GATES) que condiciona o card; ausente =
   * card padrão de toda org. */
  area?: string;
  /** Ausente = "modulo" (o catálogo em código). */
  kind?: OperacaoCardKind;
}

export const OPERACAO_CARDS: OperacaoCard[] = [
  {
    key: "agenda",
    label: "Agenda",
    description:
      "Calendário do workspace: as agendas dos seus dashboards, tarefas e anotações num só lugar.",
    href: "/operacao/agenda",
  },
  {
    key: "tarefas",
    label: "Tarefas",
    description:
      "Agende, atribua e conclua tarefas — soltas, vinculadas a registros ou em kanbans de tarefas.",
    href: "/operacao/tarefas",
  },
  {
    key: "remuneracao",
    label: "Remuneração",
    description:
      "Remuneração variável: planos, lançamentos, comissões e demonstrativos por colaborador.",
    href: "/operacao/remuneracao",
    area: "remuneracao",
  },
  {
    key: "mapeamentos",
    label: "Mapeamentos",
    description:
      "De-para de classificação: cargos → área/nível e segmentos → categoria, aplicados aos registros.",
    href: "/operacao/mapeamentos",
    area: "mapeamentos",
  },
  {
    key: "workflow",
    label: "Workflow",
    description:
      "A fábrica dos fluxos: formulários que lançam dados em sistemas externos e automações que rodam sozinhas.",
    href: "/operacao/workflow",
    area: "workflow",
  },
];

/** Esquema de formulário → card. PURO (testável sem servidor). */
export function formSchemaToCard(schema: WorkflowFormCard): OperacaoCard {
  return {
    key: `${FORM_CARD_KEY_PREFIX}${schema.key}`,
    label: schema.label,
    description:
      schema.description ?? "Formulário de lançamento criado no Workflow.",
    href: formSchemaHref(schema.key),
    // Herda o gate da fábrica que o criou: quem tem a área Workflow lança.
    area: "workflow",
    kind: "formulario",
  };
}

/** Recorte puro do catálogo: padrões sempre; org-específicos conforme o
 * veredito por área (injetado — testável sem servidor). */
export function filterOperacaoCards(
  cards: OperacaoCard[],
  isAreaAllowed: (area: string) => boolean
): OperacaoCard[] {
  return cards.filter((c) => !c.area || isAreaAllowed(c.area));
}

/**
 * Funde as duas fontes. PURO — a I/O fica em allowedOperacaoCards. Os
 * formulários vão ao FINAL: a ordem dos módulos é estável entre organizações,
 * e o que a org criou aparece depois do que o produto oferece.
 */
export function mergeOperacaoCards(
  modules: OperacaoCard[],
  formCards: OperacaoCard[],
  isAreaAllowed: (area: string) => boolean
): OperacaoCard[] {
  return [
    ...filterOperacaoCards(modules, isAreaAllowed),
    ...filterOperacaoCards(formCards, isAreaAllowed),
  ];
}

/** Cards visíveis ao usuário/org atuais. checkSettingsArea é cache()d por
 * request — layout de /operacao, index e hub chamam sem custo extra. */
export async function allowedOperacaoCards(): Promise<OperacaoCard[]> {
  const verdicts = new Map<string, boolean>();
  for (const card of OPERACAO_CARDS) {
    if (card.area && !verdicts.has(card.area)) {
      verdicts.set(card.area, await checkSettingsArea(card.area));
    }
  }
  const isAllowed = (a: string) => verdicts.get(a) === true;

  // Formulários só existem com a área Workflow liberada — poupa a consulta
  // inteira quando a feature está desligada para a org.
  let formCards: OperacaoCard[] = [];
  if (isAllowed("workflow")) {
    const orgId = await getActiveOrgId();
    const supabase = await createClient();
    const schemas = await loadFormSchemaCards(supabase, orgId);
    formCards = schemas.map(formSchemaToCard);
  }

  return mergeOperacaoCards(OPERACAO_CARDS, formCards, isAllowed);
}
