// Versão: 1.0 | Data: 20/07/2026
// Preset "Inbound": reprodução das abas inbound do dashboard antigo de
// pré-vendas (Geral, Marketing/Fonte SQL e Vendas) como DADOS de configuração
// — nada aqui toca engine/RPC. Regras portadas do dashboard legado:
//   MQL  = leads inbound (Fonte ∈ FONTE_INBOUND) fora das etapas excluídas,
//          por data de criação;
//   SAL  = MQL sem os motivos de desqualificação neutros e fora das etapas
//          iniciais;
//   SQL  = leads "Lead Qualificado" inbound POR DATA REUNIÃO (mocks 0052
//          cobrem o histórico) + "Clientes Lite" por data de mudança de etapa;
//   Venda = deals "Contrato assinado" por DATA DA ASSINATURA (MRR = valor por
//          licença × nº de licenças — campo calculado mrr_contrato) + vendas
//          do site (Estudo, MRR > 0 e etapa ≠ DSQ) por data de criação.
// Cada conceito vira uma SUB-FONTE com campo de data próprio (o gate de fonte
// vive no predicado — uma fonte de verdade; operandos escopados @sub aceitam
// `in`/`neq_ci` desde 20/07/2026). As datas se unificam em `unified:data_ref`
// p/ os gráficos multi-fonte. Pré-requisitos de DADO (metas 'sql', feriados,
// operações BR/INTL, match rules p/ a coorte por lead): ver
// docs/manual-de-manutencao.md §4.7.
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import type { Metric, WidgetFilter } from "@/lib/widgets/types";
import type {
  PresetCorrespondence,
  PresetDashboard,
  PresetField,
  PresetSubSource,
  PresetWidget,
} from "./definitions";

// Valores de `custom:fonte` (rótulos do Bitrix) que contam como INBOUND.
// Se os rótulos do seu portal divergirem, ajuste as sub-fontes geradas em
// Configurações → Fontes (o preset nunca sobrescreve subs existentes).
const FONTE_INBOUND = ["Formulário de CRM", "Site"];

// Chaves de campo do Bitrix (ver docs/arquitetura.md §4.7 / bitrix-field-map).
const F_DATA_REUNIAO = "custom:bitrix_uf_crm_1743441331"; // lead · Data Reunião
const F_MOVED_TIME = "custom:bitrix_moved_time"; // lead · mudança de etapa
const F_DATA_ASSINATURA = "custom:data_assinatura"; // deal · Data da assinatura
const F_VALOR_LICENCA = "custom:bitrix_uf_crm_1715111926953"; // deal · valor/licença
const F_NUM_LICENCAS = "custom:bitrix_uf_crm_1715258133683"; // deal · nº licenças
const F_MOTIVO_DESQ = "custom:motivo_desqualificacao";
const F_INFO_FONTE = "custom:bitrix_source_description";

// ---- helpers de fórmula (tokens) -------------------------------------------
const fld = (ref: string): FormulaToken => ({ kind: "field", ref });
const op = (o: "+" | "-" | "*" | "/"): FormulaToken => ({ kind: "op", op: o });
const num = (value: number): FormulaToken => ({ kind: "const", value });
const LP: FormulaToken = { kind: "lparen" };
const RP: FormulaToken = { kind: "rparen" };

// Operandos escopados por sub-fonte (contagem de registros da sub, com
// período/predicado da própria sub — peça de engine de 20/07/2026).
const AT_MQLS = fld("agg:count:*@mqls");
const AT_SALS = fld("agg:count:*@sals");
const AT_SQLS = fld("agg:count:*@sqls");
const AT_LITE = fld("agg:count:*@clientes_lite");
const AT_VENDAS_AE = fld("agg:count:*@vendas_assinadas");
const AT_VENDAS_SITE = fld("agg:count:*@vendas_site");

const SQL_TOTAL: Formula = { tokens: [AT_SQLS, op("+"), AT_LITE] };
const CONV_MQL_SAL: Formula = {
  tokens: [LP, AT_SALS, op("/"), AT_MQLS, RP, op("*"), num(100)],
};
const CONV_MQL_SQL: Formula = {
  tokens: [LP, LP, AT_SQLS, op("+"), AT_LITE, RP, op("/"), AT_MQLS, RP, op("*"), num(100)],
};
const CONV_SQL_VENDA: Formula = {
  tokens: [
    LP,
    LP, AT_VENDAS_AE, op("+"), AT_VENDAS_SITE, RP,
    op("/"),
    LP, AT_SQLS, op("+"), AT_LITE, RP,
    RP,
    op("*"),
    num(100),
  ],
};

// SQL como métrica de gráfico (Mês x Mês / semanal): calculada ad-hoc com os
// mesmos operandos escopados — cada bucket soma SQLs (por Data Reunião) e
// Lites (por mudança de etapa) do próprio mês/semana.
const METRIC_SQL_CALC: Metric = {
  field: "calc:formula",
  agg: "sum",
  calc: true,
  label: "SQL",
  formula: SQL_TOTAL,
};

// ---- dependências -----------------------------------------------------------

const FIELDS: PresetField[] = [
  {
    field_key: "mrr_contrato",
    label: "MRR do contrato",
    data_type: "calculado",
    options: [],
    visible_to_roles: ["admin", "gestor", "vendedor"],
    editable_by_roles: [],
    is_local: true,
    currency_mode: "inherit", // moeda do registro (core `currency` do deal)
    applies_to: ["negocio"],
    formula: {
      tokens: [fld(F_VALOR_LICENCA), op("*"), fld(F_NUM_LICENCAS)],
      source: "[Valor por licença do contrato (R$)] * [Número de licenças contratadas]",
    },
  },
];

const MQL_FILTER: WidgetFilter[] = [
  { field: "custom:fonte", op: "in", value: FONTE_INBOUND },
  { field: "stage", op: "neq_ci", value: "Inacessível" },
  { field: "stage", op: "neq_ci", value: "Desqualificado Marketing" },
  { field: "stage", op: "neq_ci", value: "Novos Leads" },
];

const SUB_SOURCES: PresetSubSource[] = [
  {
    key: "mqls",
    parent_key: "leads",
    label: "MQLs (Inbound)",
    short_label: "MQLs",
    default_period_field: "source_created_at",
    filter: MQL_FILTER,
  },
  {
    key: "sals",
    parent_key: "leads",
    label: "SALs (Inbound)",
    short_label: "SALs",
    default_period_field: "source_created_at",
    // MQL + fora das etapas iniciais + motivos de desqualificação neutros não
    // contam (neq_ci: motivo NULO segue contando — regra do dashboard antigo).
    filter: [
      ...MQL_FILTER,
      { field: "stage", op: "neq_ci", value: "1º contato" },
      { field: "stage", op: "neq_ci", value: "Em qualificação" },
      { field: F_MOTIVO_DESQ, op: "neq_ci", value: "Monitoramento pessoal" },
      { field: F_MOTIVO_DESQ, op: "neq_ci", value: "Sem resposta" },
      { field: F_MOTIVO_DESQ, op: "neq_ci", value: "Outros" },
    ],
  },
  {
    key: "sqls",
    parent_key: "leads",
    label: "SQLs AE (Inbound)",
    short_label: "SQLs",
    // Data Reunião: o período referencia a chave-gatilho dos mocks (0052).
    default_period_field: F_DATA_REUNIAO,
    filter: [
      { field: "stage", op: "eq", value: "Lead Qualificado" },
      { field: "custom:fonte", op: "in", value: FONTE_INBOUND },
    ],
  },
  {
    key: "clientes_lite",
    parent_key: "leads",
    label: "Clientes Lite",
    short_label: "Lite",
    default_period_field: F_MOVED_TIME,
    // Sem gate de fonte — regra do dashboard antigo (Lite conta de qualquer
    // origem, pela data de mudança de etapa).
    filter: [{ field: "stage", op: "eq", value: "Clientes Lite" }],
  },
  {
    key: "desq_inbound",
    parent_key: "leads",
    label: "Desqualificações (Inbound)",
    short_label: "Desq.",
    default_period_field: F_MOVED_TIME,
    filter: [
      { field: "custom:fonte", op: "in", value: FONTE_INBOUND },
      { field: F_MOTIVO_DESQ, op: "not_null" },
    ],
  },
  {
    key: "vendas_assinadas",
    parent_key: "deals",
    label: "Vendas assinadas",
    short_label: "Vendas AE",
    default_period_field: F_DATA_ASSINATURA,
    filter: [{ field: "stage", op: "eq", value: "Contrato assinado" }],
  },
  {
    key: "vendas_site",
    parent_key: "estudo",
    label: "Vendas do site",
    short_label: "Vendas Site",
    default_period_field: "source_created_at",
    filter: [
      { field: "mrr", op: "gt", value: 0 },
      { field: "stage", op: "neq_ci", value: "DSQ" },
    ],
  },
];

const CORRESPONDENCES: PresetCorrespondence[] = [
  {
    key: "data_ref",
    label: "Data de referência",
    data_type: "data",
    members: [
      { source_key: "leads", field_ref: "source_created_at" },
      { source_key: "mqls", field_ref: "source_created_at" },
      { source_key: "sals", field_ref: "source_created_at" },
      { source_key: "sqls", field_ref: F_DATA_REUNIAO },
      { source_key: "clientes_lite", field_ref: F_MOVED_TIME },
      { source_key: "desq_inbound", field_ref: F_MOVED_TIME },
      { source_key: "deals", field_ref: "closed_at" },
      { source_key: "vendas_assinadas", field_ref: F_DATA_ASSINATURA },
      { source_key: "estudo", field_ref: "source_created_at" },
      { source_key: "vendas_site", field_ref: "source_created_at" },
    ],
  },
  {
    key: "fonte_venda",
    label: "Fonte da venda",
    data_type: "texto",
    members: [
      { source_key: "deals", field_ref: "custom:fonte" },
      { source_key: "vendas_assinadas", field_ref: "custom:fonte" },
      { source_key: "estudo", field_ref: "channel" },
      { source_key: "vendas_site", field_ref: "channel" },
    ],
  },
  {
    key: "mrr_venda",
    label: "MRR da venda",
    data_type: "moeda",
    members: [
      { source_key: "deals", field_ref: "custom:mrr_contrato" },
      { source_key: "vendas_assinadas", field_ref: "custom:mrr_contrato" },
      { source_key: "estudo", field_ref: "mrr" },
      { source_key: "vendas_site", field_ref: "mrr" },
    ],
  },
];

// ---- widgets ----------------------------------------------------------------

// Badge "vs. mês anterior no mesmo dia útil" dos KPIs (dashboard antigo).
const CMP_BD = {
  comparison: {
    enabled: true,
    base: "previous_period_bd" as const,
    format: "pct" as const,
    style: "both" as const,
  },
};

const GERAL: PresetWidget[] = [
  {
    presetKey: "inbound.geral.kpi_mql",
    title: "MQL",
    visual_type: "kpi",
    sources: ["mqls"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "geral", ...CMP_BD },
    grid_position: { x: 0, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "inbound.geral.kpi_sal",
    title: "SAL",
    visual_type: "kpi",
    sources: ["sals"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "geral", ...CMP_BD },
    grid_position: { x: 3, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "inbound.geral.kpi_sql",
    title: "SQL (total)",
    visual_type: "kpi",
    sources: [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "geral",
      card: {
        mode: "formula",
        formula: SQL_TOTAL,
        secondaryText: "AE (Data Reunião) + Clientes Lite",
      },
    },
    grid_position: { x: 6, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "inbound.geral.kpi_vendas",
    title: "Vendas",
    visual_type: "kpi",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "geral", ...CMP_BD },
    grid_position: { x: 9, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "inbound.geral.filtro_operacao",
    title: "Operação (todas as abas)",
    visual_type: "filtro_campo",
    sources: [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "geral",
      fields: [{ field: "operation_id", label: "Operação" }],
    },
    grid_position: { x: 0, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "inbound.geral.conv_mql_sal",
    title: "Conv. MQL → SAL",
    visual_type: "kpi",
    sources: [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "geral",
      card: { mode: "formula", formula: CONV_MQL_SAL, suffix: "%" },
      appearance: { decimals: 1 },
    },
    grid_position: { x: 3, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "inbound.geral.conv_mql_sql",
    title: "Conv. MQL → SQL",
    visual_type: "kpi",
    sources: [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "geral",
      card: { mode: "formula", formula: CONV_MQL_SQL, suffix: "%" },
      appearance: { decimals: 1 },
    },
    grid_position: { x: 6, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "inbound.geral.conv_sql_venda",
    title: "Conv. SQL → Venda",
    visual_type: "kpi",
    sources: [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "geral",
      card: { mode: "formula", formula: CONV_SQL_VENDA, suffix: "%" },
      appearance: { decimals: 1 },
    },
    grid_position: { x: 9, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "inbound.geral.mes_x_mes",
    title: "Mês x Mês (mesmo dia útil)",
    visual_type: "barra",
    // As fontes definem o UNIVERSO de meses (linhas); as métricas de MQL e
    // Vendas rodam como pernas com fontes próprias e o SQL como calculada de
    // operandos escopados.
    sources: ["leads", "vendas_assinadas", "vendas_site"],
    dimensions: [
      { field: "unified:data_ref", transform: "month_year", label: "Mês" },
    ],
    metrics: [
      { field: "*", agg: "count", label: "MQL", sources: ["mqls"] },
      METRIC_SQL_CALC,
      {
        field: "*",
        agg: "count",
        label: "Vendas",
        sources: ["vendas_assinadas", "vendas_site"],
      },
    ],
    filters: [],
    settings: {
      tab: "geral",
      // Janela de períodos equivalentes: dropdown no card com todas as
      // opções, padrão 6 meses, toggle dia útil × dia cheio exposto.
      periodWindow: {
        options: ["3m", "trimestre", "6m", "semestre", "12m", "ano"],
        default: "6m",
        showAlignToggle: true,
      },
      businessDayAlign: { enabled: true },
      goalLine: {
        enabled: true,
        metric: "sql",
        mode: "pace",
        scope: "global",
        label: "Meta SQL",
      },
      appearance: { legend: { show: true } },
    },
    grid_position: { x: 0, y: 8, w: 8, h: 9 },
  },
  {
    presetKey: "inbound.geral.analise_semanal",
    title: "Análise Semanal (MQL × SQL)",
    visual_type: "barra",
    sources: ["leads"],
    dimensions: [
      { field: "unified:data_ref", transform: "week_month", label: "Semana" },
    ],
    metrics: [
      { field: "*", agg: "count", label: "MQL", sources: ["mqls"] },
      METRIC_SQL_CALC,
    ],
    filters: [],
    settings: { tab: "geral", appearance: { legend: { show: true } } },
    grid_position: { x: 8, y: 8, w: 4, h: 9 },
  },
  {
    presetKey: "inbound.geral.desqualificacao",
    title: "Detalhes da Desqualificação",
    visual_type: "barra_horizontal",
    sources: ["desq_inbound"],
    dimensions: [{ field: F_MOTIVO_DESQ, label: "Motivo" }],
    metrics: [{ field: "*", agg: "count", label: "Leads" }],
    filters: [],
    settings: {
      tab: "geral",
      appearance: { categoryLimit: { n: 5, others: false } },
    },
    grid_position: { x: 0, y: 17, w: 4, h: 9 },
  },
  {
    presetKey: "inbound.geral.mes_sql",
    title: "Mês SQL (por criação do lead)",
    visual_type: "barra",
    sources: ["sqls"],
    dimensions: [
      {
        field: "source_created_at",
        transform: "month_year",
        label: "Mês de criação",
      },
    ],
    metrics: [{ field: "*", agg: "count", label: "SQLs" }],
    filters: [],
    settings: { tab: "geral" },
    grid_position: { x: 4, y: 17, w: 4, h: 9 },
  },
  {
    presetKey: "inbound.geral.sql_ae",
    title: "SQL · AE",
    visual_type: "kpi",
    sources: ["sqls"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "geral" },
    grid_position: { x: 8, y: 17, w: 2, h: 4 },
  },
  {
    presetKey: "inbound.geral.sql_lite",
    title: "SQL · Lite",
    visual_type: "kpi",
    sources: ["clientes_lite"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "geral" },
    grid_position: { x: 10, y: 17, w: 2, h: 4 },
  },
];

const MARKETING: PresetWidget[] = [
  {
    presetKey: "inbound.marketing.fonte_sql",
    title: "Fonte SQL",
    visual_type: "barra_horizontal",
    sources: ["sqls"],
    dimensions: [{ field: F_INFO_FONTE, label: "Fonte" }],
    metrics: [{ field: "*", agg: "count", label: "SQLs" }],
    filters: [],
    settings: {
      tab: "marketing",
      appearance: { categoryLimit: { n: 8, others: true } },
    },
    grid_position: { x: 0, y: 0, w: 8, h: 10 },
  },
];

const VENDAS: PresetWidget[] = [
  {
    presetKey: "inbound.vendas.kpi_vendas",
    title: "Vendas",
    visual_type: "kpi",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "vendas", ...CMP_BD },
    grid_position: { x: 0, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "inbound.vendas.kpi_mrr",
    title: "MRR",
    visual_type: "kpi",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [],
    metrics: [{ field: "unified:mrr_venda", agg: "sum" }],
    filters: [],
    settings: { tab: "vendas" },
    grid_position: { x: 4, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "inbound.vendas.kpi_ticket",
    title: "Ticket médio",
    visual_type: "kpi",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "vendas",
      mode: "ratio",
      numerator: { field: "unified:mrr_venda", agg: "sum" },
      denominator: { field: "*", agg: "count" },
      label: "Ticket médio",
    },
    grid_position: { x: 8, y: 0, w: 4, h: 4 },
  },
  {
    presetKey: "inbound.vendas.vendas_por_fonte",
    title: "Vendas por Fonte",
    visual_type: "pizza",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [{ field: "unified:fonte_venda", label: "Fonte" }],
    metrics: [{ field: "*", agg: "count", label: "Vendas" }],
    filters: [],
    settings: { tab: "vendas" },
    grid_position: { x: 0, y: 4, w: 4, h: 9 },
  },
  {
    presetKey: "inbound.vendas.mrr_por_fonte",
    title: "MRR por Fonte",
    visual_type: "barra_horizontal",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [{ field: "unified:fonte_venda", label: "Fonte" }],
    metrics: [{ field: "unified:mrr_venda", agg: "sum", label: "MRR" }],
    filters: [],
    settings: { tab: "vendas" },
    grid_position: { x: 4, y: 4, w: 4, h: 9 },
  },
  {
    presetKey: "inbound.vendas.evolucao_venda",
    title: "Evolução por Data da Venda",
    visual_type: "barra",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [
      { field: "unified:data_ref", transform: "month_year", label: "Mês" },
    ],
    metrics: [
      { field: "*", agg: "count", label: "Vendas" },
      { field: "unified:mrr_venda", agg: "sum", label: "MRR" },
    ],
    filters: [],
    settings: {
      tab: "vendas",
      appearance: {
        legend: { show: true },
        seriesAxis: { metric_2: "right" },
      },
    },
    grid_position: { x: 8, y: 4, w: 4, h: 9 },
  },
  {
    presetKey: "inbound.vendas.evolucao_lead",
    title: "Evolução por Criação do Lead",
    visual_type: "linha",
    sources: ["vendas_assinadas", "vendas_site"],
    dimensions: [
      {
        field: "match:leads:source_created_at",
        transform: "month_year",
        label: "Mês de criação do lead",
      },
    ],
    metrics: [{ field: "*", agg: "count", label: "Vendas" }],
    filters: [],
    settings: { tab: "vendas" },
    grid_position: { x: 0, y: 13, w: 12, h: 9 },
  },
];

export const INBOUND_PRESET: PresetDashboard = {
  presetKey: "inbound",
  version: 3, // v3 (20/07/2026): periodWindow (dropdown de janela) no Mês x Mês
  name: "Inbound",
  visible_to_roles: ["admin", "gestor"],
  settings: {
    tabs: [
      { id: "geral", name: "Geral" },
      { id: "marketing", name: "Marketing" },
      { id: "vendas", name: "Vendas" },
    ],
    periodBar: { enabled: true, defaultPreset: "este_mes", scope: "global" },
    canvas: { cols: 12, rowHeight: 30 },
  },
  fields: FIELDS,
  subSources: SUB_SOURCES,
  correspondences: CORRESPONDENCES,
  widgets: [...GERAL, ...MARKETING, ...VENDAS],
};
