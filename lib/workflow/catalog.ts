// Versão: 1.0 | Data: 09/09/2026
// A LISTA ÚNICA do Workflow: um fluxo é um fluxo, e o que muda entre eles é
// quem dispara e quem pode editar — não em que aba mora.
//
// Antes eram três listas em três abas (Esquemas, Automações, Fluxos do
// sistema) para a mesma pergunta: "o que este sistema faz sozinho, e onde eu
// mexo nisso?". Aqui elas viram UM catálogo com a origem como PROPRIEDADE da
// linha. A unificação é de TELA: a automação continua sendo linha de
// `automation_rules` (editável dentro do quadro também) e o fluxo do sistema
// continua sendo código — nada foi convertido em `workflow_schemas`.
//
// Módulo PURO e client-safe (a lista é um componente client): sem I/O, sem
// server-only. Quem carrega cada fonte é a page.
import type { OrgAutomationRow } from "./automations-overview";
import type { WorkflowSchemaRow } from "./schemas";
import type { SystemFlow } from "./system-schemas";

/** Filtro da lista — "todos" é o padrão. */
export const WORKFLOW_CATALOG_FILTERS = [
  "todos",
  "formulario",
  "automacao",
  "sistema",
] as const;
export type WorkflowCatalogFilter = (typeof WORKFLOW_CATALOG_FILTERS)[number];

export const WORKFLOW_CATALOG_FILTER_LABELS: Record<
  WorkflowCatalogFilter,
  string
> = {
  todos: "Todos",
  formulario: "Formulário",
  automacao: "Automação",
  sistema: "Do sistema",
};

/**
 * Uma linha da lista. União DISCRIMINADA porque cada tipo se edita num lugar
 * diferente — achatar tudo num shape só faria a tela adivinhar o que pode
 * oferecer em cada linha.
 */
export type WorkflowCatalogItem =
  | { kind: "schema"; id: string; schema: WorkflowSchemaRow; broken: boolean }
  | { kind: "rule"; id: string; rule: OrgAutomationRow; broken: boolean }
  | { kind: "system"; id: string; flow: SystemFlow; broken: false };

/** A que filtro a linha responde. */
export function catalogItemFilter(
  item: WorkflowCatalogItem
): Exclude<WorkflowCatalogFilter, "todos"> {
  if (item.kind === "system") return "sistema";
  if (item.kind === "rule") return "automacao";
  return item.schema.triggerKind === "form" ? "formulario" : "automacao";
}

/**
 * Monta o catálogo. Ordem FIXA e com propósito:
 *   1. o que está QUEBRADO (regra cujo jsonb não passou no parse ou que falhou
 *      na última rodada; esquema com definição inválida) — é o que exige ação;
 *   2. os esquemas do usuário (o que ele criou e edita aqui);
 *   3. as regras de automação;
 *   4. os fluxos do sistema, que são leitura.
 * Dentro de cada faixa, ordem alfabética estável.
 */
export function buildWorkflowCatalog(
  schemas: WorkflowSchemaRow[],
  rules: OrgAutomationRow[],
  flows: SystemFlow[]
): WorkflowCatalogItem[] {
  const items: WorkflowCatalogItem[] = [
    ...schemas.map(
      (s): WorkflowCatalogItem => ({
        kind: "schema",
        id: `schema:${s.id}`,
        schema: s,
        // Definição que o parse fail-closed recusou: a linha PRECISA aparecer
        // (some da tela seria o pior dos mundos — o esquema existe e não roda).
        broken: s.definition == null,
      })
    ),
    ...rules.map(
      (r): WorkflowCatalogItem => ({
        kind: "rule",
        id: `rule:${r.id}`,
        rule: r,
        broken: r.rule == null || r.lastError != null,
      })
    ),
    ...flows.map(
      (f): WorkflowCatalogItem => ({
        kind: "system",
        id: `system:${f.key}`,
        flow: f,
        broken: false,
      })
    ),
  ];

  const rank = (i: WorkflowCatalogItem): number => {
    if (i.broken) return 0;
    if (i.kind === "schema") return 1;
    if (i.kind === "rule") return 2;
    return 3;
  };
  const label = (i: WorkflowCatalogItem): string =>
    i.kind === "schema"
      ? i.schema.label
      : i.kind === "rule"
        ? i.rule.name
        : i.flow.label;

  return items.sort(
    (a, b) => rank(a) - rank(b) || label(a).localeCompare(label(b), "pt-BR")
  );
}

export function filterWorkflowCatalog(
  items: WorkflowCatalogItem[],
  filter: WorkflowCatalogFilter
): WorkflowCatalogItem[] {
  if (filter === "todos") return items;
  return items.filter((i) => catalogItemFilter(i) === filter);
}

/** Contagem por filtro, para os chips não mentirem sobre o que há. */
export function countByFilter(
  items: WorkflowCatalogItem[]
): Record<WorkflowCatalogFilter, number> {
  const out: Record<WorkflowCatalogFilter, number> = {
    todos: items.length,
    formulario: 0,
    automacao: 0,
    sistema: 0,
  };
  for (const i of items) out[catalogItemFilter(i)] += 1;
  return out;
}
