// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): o CATÁLOGO DE TÓPICOS do assistente de dashboards — a
// partição do prompt (SPEC + dicionários + dados) que o roteador lê
// (lib/ai/topics/). O texto continua UM só (instructions.ts); aqui só se diz a
// que tópico cada pedaço pertence.
//
// Exaustividade por construção, como os dicionários de settings-docs.ts:
// `WIDGET_SETTINGS_TOPIC`/`DASHBOARD_SETTINGS_TOPIC` são
// `satisfies Record<keyof …, DashboardTopicKey | "core">` — chave nova nos
// tipos sem tópico QUEBRA o typecheck. Um assistente que recebe só parte do
// prompt não pode ficar sem saber de uma chave porque ninguém a classificou.
import type { TopicCatalog, TopicMeta } from "@/lib/ai/topics/split";
import type {
  DashboardSettings,
  VisualType,
  WidgetSettings,
} from "@/lib/widgets/types";

export const DASHBOARD_TOPICS = [
  {
    key: "nucleo",
    title: "Núcleo",
    summary: "Contrato, envelope, refs, settings comuns e regras gerais.",
    always: true,
    headings: ["Settings do widget", "Settings do dashboard", "REGRAS SEMANTICAS"],
  },
  {
    key: "dashboard_geral",
    title: "Barra de período e configurações gerais do dashboard",
    summary:
      "periodBar (preset padrão, campo de data por Base, período por aba), formato de data, escala de fonte, grade do canvas, selos ocultos.",
    keywords: ["barra de periodo", "periodo padrao", "formato de data", "fieldbysource", "escala"],
  },
  {
    key: "abas_slides",
    title: "Abas, estilo, slides e modo Apresentar",
    summary:
      "dashboard.settings.tabs (abas, fundo e título-conclusão por aba), style, background/outerBackground, slide (esqueleto de slide), presentation.",
    keywords: ["aba", "abas", "slide", "apresenta", "estilo", "fundo", "capa", "tema", "headline"],
  },
  {
    key: "formulas",
    title: "Campos e fórmulas",
    summary:
      "\"fields\" (campos personalizados, calculado por registro e calculado_agg), sintaxe de fórmula, funções (SOMASE/CONT.SE/VARPCT…), operandos [agg:…], [meta:…], [manual:…].",
    keywords: ["formula", "calculad", "campo novo", "criar campo", "conversao", "taxa", "somase", "cont se", "varpct", "razao", "ticket medio"],
    headings: ['"fields"'],
  },
  {
    key: "subbases",
    title: "Sub-bases, campos unificados e várias Bases",
    summary:
      "\"subSources\" (recorte fixo com data própria), \"correspondences\" (campo unificado entre Bases), conviver/exibir sub-bases, regras de dashboard multi-Base.",
    keywords: ["sub-base", "subbase", "sub base", "unificad", "recorte", "multi-base", "duas bases"],
    headings: ['"subSources"', '"correspondences"'],
  },
  {
    key: "dimensoes",
    title: "Dimensões",
    summary:
      "Agrupamento (eixo): formatos de data (mês, semana, trimestre…), Semana Fechada, dimensão condicional (case_formula_text).",
    keywords: ["dimens", "agrup", "por mes", "por semana", "trimestre", "eixo", "semana fechada", "reclassific"],
    headings: ["Dimensoes"],
  },
  {
    key: "metricas",
    title: "Métricas",
    summary:
      "Agregações (soma, média, contagem…), métrica de fórmula, fontes por métrica, percentual, moeda do resultado.",
    keywords: ["metrica", "soma", "media", "contagem", "moeda", "percentual"],
    headings: ["Metricas"],
  },
  {
    key: "base_manual",
    title: "Base manual (números digitados)",
    summary:
      "manual:<chave> como métrica/operando, famílias (manualdim:), período da Base manual, widget \"Base do Dashboard\", os lançamentos existentes.",
    keywords: ["base manual", "manual", "lancament", "digitad", "familia", "manualdim"],
    headings: ["Familias da Base manual", "Base manual e PERIODO", "BASE MANUAL"],
  },
  {
    key: "filtros",
    title: "Filtros",
    summary:
      "Filtros fixos do widget (operadores, por nome de responsável/operação), filtros rápidos (quickFilters) e os widgets \"filtro\"/\"filtro_campo\".",
    keywords: ["filtr", "responsavel", "operacao", "busca", "somente", "apenas"],
    headings: ["Filtros"],
  },
  {
    key: "comparacao_metas",
    title: "Comparação, dia útil e linha de meta",
    summary:
      "comparison (vs. período anterior), businessDayAlign (mesmo dia útil), periodWindow (janela de meses) e goalLine (linha de meta) — e as regras entre eles.",
    keywords: ["compar", "periodo anterior", "dia util", "linha de meta", "goalline", "janela"],
  },
  {
    key: "cards",
    title: "Cards e KPIs",
    summary:
      "Card de meta, card de razão, data atual, aparência do card (KPI) e as chaves de escopo deles.",
    keywords: ["card", "kpi", "numero grande", "data atual"],
  },
  {
    key: "tabelas",
    title: "Tabelas",
    summary:
      "Tabela agregada, lista de registros (rowMode/columns/limit), Tabela Livre e o atalho de Tabela de metas (goalTable).",
    keywords: ["tabela", "coluna", "lista de registros", "tabela livre", "tabela de metas"],
  },
  {
    key: "nota_forma",
    title: "Notas, formas e imagens",
    summary: "Widgets de texto (nota), forma, imagem e calculadora.",
    keywords: ["nota", "texto", "forma", "imagem", "calculadora", "post-it", "postit"],
  },
  {
    key: "kanban_agenda",
    title: "Kanban e Agenda",
    summary: "settings.kanban (modos, colunas/fases, card, badges, write-back) e settings.agenda.",
    keywords: ["kanban", "quadro", "agenda", "calendario", "fase"],
  },
  {
    key: "tree",
    title: "Tree (árvore) e nós do mapa",
    summary:
      "settings.tree do widget e a seção \"mapas\": nós de indicador (linhas do cartão Meta/Realizado/Projetado…, fonte do realizado), Multi-fatores, rituais e anotações — editar e criar.",
    keywords: ["tree", "arvore", "cartao", "cartoes", "galho", "branch", "ritual", "multi-fatores", "multi fatores", "plano de acao", "realizado", "projetado", "atingimento", "linhas do cartao", "desdobramento", "mapa"],
    headings: ['"mapas"'],
  },
  {
    key: "aparencia",
    title: "Aparência",
    summary:
      "appearance do widget: cores/paletas, rótulos de dados, legenda, eixos, fontes, tabela (cabeçalho, bordas, cores por linha/coluna), formatação condicional.",
    keywords: ["cor", "cores", "aparencia", "rotulo", "legenda", "fonte", "borda", "paleta", "destaque", "negrito", "alinh", "eixo"],
  },
  {
    key: "amostras",
    title: "Amostras de dados",
    summary:
      "~20 registros reais por Base — valores de verdade (estágios, fontes, nomes) para filtros e condições por valor.",
    keywords: ["valor", "exemplo", "estagio", "etapa", "igual a", "ganhou", "perdeu"],
    headings: ["AMOSTRAS DE DADOS"],
  },
] as const satisfies readonly TopicMeta[];

export type DashboardTopicKey = (typeof DASHBOARD_TOPICS)[number]["key"];

export const DASHBOARD_TOPIC_CATALOG: TopicCatalog = {
  domain: "Dashboards",
  topics: DASHBOARD_TOPICS,
};

type SettingsTopic = DashboardTopicKey | "core";

/** Tópico de CADA chave de `WidgetSettings` (exaustivo). */
export const WIDGET_SETTINGS_TOPIC = {
  tab: "core",
  quickFilters: "filtros",
  comparison: "comparacao_metas",
  businessDayAlign: "comparacao_metas",
  periodWindow: "comparacao_metas",
  goalLine: "comparacao_metas",
  mode: "cards",
  metric: "cards",
  scope: "cards",
  period: "cards",
  operationId: "cards",
  responsibleId: "cards",
  numerator: "cards",
  denominator: "cards",
  label: "cards",
  percent: "cards",
  conversionBasis: "cards",
  currencyDisplay: "cards",
  currencyMultiMode: "cards",
  grandTotalMode: "cards",
  kind: "filtros",
  targets: "filtros",
  field: "filtros",
  fieldBySource: "filtros",
  defaultPreset: "filtros",
  defaultDe: "filtros",
  defaultAte: "filtros",
  fields: "filtros",
  searchFields: "filtros",
  excludedTargets: "filtros",
  valueScope: "filtros",
  rowMode: "tabelas",
  rowSource: "tabelas",
  columns: "tabelas",
  limit: "tabelas",
  showFilterBar: "tabelas",
  showAddRecord: "tabelas",
  card: "cards",
  note: "nota_forma",
  shape: "nota_forma",
  image: "nota_forma",
  coexistSubSources: "subbases",
  subSeriesMode: "subbases",
  autoSize: "core",
  formula: "formulas",
  calcField: "formulas",
  calculator: "nota_forma",
  quickTable: "tabelas",
  presetKey: "core",
  pages: "core",
  kanban: "kanban_agenda",
  agenda: "kanban_agenda",
  rowAction: "tabelas",
  tree: "tree",
  baseManual: "base_manual",
  goalTable: "tabelas",
  hideInPresentation: "core",
  appearance: "aparencia",
} as const satisfies Record<keyof WidgetSettings, SettingsTopic>;

/** Tópico de CADA chave de `DashboardSettings` (exaustivo). */
export const DASHBOARD_SETTINGS_TOPIC = {
  tabs: "abas_slides",
  periodBar: "dashboard_geral",
  canvas: "dashboard_geral",
  dateFormat: "dashboard_geral",
  background: "abas_slides",
  outerBackground: "abas_slides",
  fontScale: "dashboard_geral",
  hideComparisonLabels: "dashboard_geral",
  hideBusinessDayBadges: "dashboard_geral",
  kanban: "kanban_agenda",
  connectors: "core",
  preset: "core",
  sourceScope: "core",
  presentation: "abas_slides",
  slide: "abas_slides",
  style: "abas_slides",
} as const satisfies Record<keyof DashboardSettings, SettingsTopic>;

/**
 * Tópicos que um WIDGET puxa quando o roteador o escolhe como item (editar um
 * kanban exige o tópico do kanban, mesmo que o pedido não diga "kanban").
 * Exaustivo por tipo — tipo novo sem entrada quebra o typecheck.
 */
export const VISUAL_TYPE_TOPICS = {
  tabela: ["tabelas", "dimensoes", "metricas"],
  barra: ["dimensoes", "metricas", "aparencia"],
  barra_horizontal: ["dimensoes", "metricas", "aparencia"],
  linha: ["dimensoes", "metricas", "aparencia"],
  pizza: ["dimensoes", "metricas", "aparencia"],
  funil: ["dimensoes", "metricas", "aparencia"],
  kpi: ["cards", "metricas"],
  calculado: ["cards", "metricas", "formulas"],
  filtro: ["filtros"],
  filtro_campo: ["filtros"],
  nota: ["nota_forma"],
  forma: ["nota_forma"],
  linha_divisoria: ["nota_forma"],
  imagem: ["nota_forma"],
  calculadora: ["nota_forma"],
  tabela_editavel: ["tabelas"],
  kanban: ["kanban_agenda"],
  agenda: ["kanban_agenda"],
  tree: ["tree"],
  base_manual: ["base_manual"],
  metas: ["tabelas"],
} as const satisfies Record<VisualType, readonly DashboardTopicKey[]>;
