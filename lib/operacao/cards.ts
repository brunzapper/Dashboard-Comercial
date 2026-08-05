// Versão: 1.0 | Data: 05/08/2026
// Cards de OPERAÇÃO (aba "Operação" do hub Workspace + sub-abas de /operacao):
// catálogo definido em CÓDIGO — nunca linhas de `dashboards` e sem UI de
// exclusão (indeletáveis por construção; o pedido de produto exige que só o
// banco os remova). Card com `area` é org-específico: aparece só quando
// checkSettingsArea(area) passa (precedência feature-off > deny > allow >
// gate de papel — lib/auth/access.ts), ou seja, liga/desliga por org via
// org_features (escrita service-role-only, console /owner) — o org_admin não
// se auto-habilita. Card SEM `area` é PADRÃO de toda organização (Agenda,
// Tarefas). Card novo org-específico = entrada aqui + chave em ORG_FEATURES +
// AREA_GATES/AREA_FEATURES (chave de área é histórica — nunca renomear).
// Ordem do catálogo = ordem das sub-abas e dos cards: padrões primeiro,
// org-específicos ao final (ordem estável entre orgs com features distintas).
import { checkSettingsArea } from "@/lib/auth/access";

export interface OperacaoCard {
  key: string;
  label: string;
  /** Texto do CardDescription no hub. */
  description: string;
  href: string;
  /** Chave de ÁREA histórica (AREA_GATES) que condiciona o card; ausente =
   * card padrão de toda org. */
  area?: string;
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
];

/** Recorte puro do catálogo: padrões sempre; org-específicos conforme o
 * veredito por área (injetado — testável sem servidor). */
export function filterOperacaoCards(
  cards: OperacaoCard[],
  isAreaAllowed: (area: string) => boolean
): OperacaoCard[] {
  return cards.filter((c) => !c.area || isAreaAllowed(c.area));
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
  return filterOperacaoCards(OPERACAO_CARDS, (a) => verdicts.get(a) === true);
}
