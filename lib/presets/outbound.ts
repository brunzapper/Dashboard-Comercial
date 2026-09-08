// Versão: 1.0 | Data: 07/08/2026
// Preset "Outbound — Pré-Vendas": reprodução da análise Outbound do dashboard
// antigo em Apps Script ("Análise Pré-Vendas" · abas Outbound/OB Análise + o
// web app "Análise de pré vendas - Outbound"), com as REGRAS DE JUL/2026 EM
// DIANTE adaptadas ao sistema, e as análises de ESFORÇO dos dashboards
// construídos à mão ("Outbound — Conversão e Esforço" etc.). Tudo DADOS de
// configuração — nada aqui toca engine/RPC.
//
// Regras portadas (GS antigo, _outboundFromLeads v4.14+):
//   RR (Reuniões Realizadas) = lead Bitrix com Etapa ∈ {Lead Qualificado,
//        Lead Desqualificado} e Fonte = "Outro", alocado pela DATA REUNIÃO
//        (custom:bitrix_uf_crm_1743441331) ≥ 01/jul/2026. Sem Data Reunião
//        não conta (fiel ao antigo — a data de alocação é a DR).
//   RQ  = idem com Etapa = "Lead Qualificado".
//   No Show = etapa "No Show" + Fonte "Outro" (adaptação: alocado pela data
//        de mudança de etapa — o Bitrix não preenche DR no no-show).
//   Funil/perfil/esforço = base Meetime (`meetime_outbound`, import CSV):
//        status Ganho/Perdido/Ativo, motivo de perda, cadência, atividades…
//   Tier = bucket de "Quantidade de contas": vazio/0 = Sem tier, 1-9 =
//        Pequeno, 10-99 = Médio, 100+ = Grande (campo calculado tier_contas).
//   Perfil (Área/Nível do cargo + Segmento classificado) usa os campos
//        DERIVADOS do de-para de valores (0117 — /operacao/mapeamentos):
//        custom:cargo_area, custom:cargo_nivel, custom:segmento_classificado.
//   Origem das reuniões: campo de origem do registro Meetime CASADO ao lead
//        (regra de match "Meets Outbound" leads↔meetime_outbound por e-mail).
//
// Pré-requisitos de DADO: base `meetime_outbound` criada e importada; match
// rule leads↔meetime_outbound; mapeamentos aplicados (0117); meta mensal na
// chave `rq_outbound` (área Metas). Ver docs/manual-de-manutencao.md §4.7.
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import type { Metric, WidgetFilter } from "@/lib/widgets/types";
import type {
  PresetDashboard,
  PresetField,
  PresetSubSource,
  PresetWidget,
} from "./definitions";

// Chaves de campo do Bitrix (lead) — mesmas do preset Inbound.
const F_DATA_REUNIAO = "custom:bitrix_uf_crm_1743441331"; // lead · Data Reunião
const F_MOVED_TIME = "custom:bitrix_moved_time"; // lead · mudança de etapa

// Corte da regra nova (01/jul/2026): antes disso o outbound vivia na planilha
// Zapper legada — o histórico pré-jul/26 fica fora deste dashboard.
const OB_CUTOFF = "2026-07-01";

// ---- helpers de fórmula (tokens) -------------------------------------------
const fld = (ref: string): FormulaToken => ({ kind: "field", ref });
const op = (o: "+" | "-" | "*" | "/"): FormulaToken => ({ kind: "op", op: o });
const str = (value: string): FormulaToken => ({ kind: "str", value });
const num = (value: number): FormulaToken => ({ kind: "const", value });
const cmp = (o: "=" | "<>" | "<" | ">" | "<=" | ">="): FormulaToken => ({
  kind: "cmp",
  op: o,
});
const fn = (name: "SE" | "CONT.SE"): FormulaToken => ({ kind: "func", name });
const SEP: FormulaToken = { kind: "argsep" };
const LP: FormulaToken = { kind: "lparen" };
const RP: FormulaToken = { kind: "rparen" };

// Operandos escopados por fonte/sub-fonte (engine, 20/07/2026).
const AT_MEET = fld("agg:count:*@meetime_outbound");
const AT_GANHOS = fld("agg:count:*@ganhos_meetime");
const AT_RR = fld("agg:count:*@ob_rr");
const AT_RQ = fld("agg:count:*@ob_rq");

// CONT.SE([custom:status] = "<valor>") — recorte por status da base Meetime.
const contSeStatus = (value: string): FormulaToken[] => [
  fn("CONT.SE"),
  LP,
  fld("custom:status"),
  cmp("="),
  str(value),
  RP,
];

// Métricas compartilhadas das tabelas de conversão da base Meetime.
const METRIC_GANHOS: Metric = {
  field: "calc:formula",
  agg: "sum",
  calc: true,
  label: "Ganhos",
  formula: {
    source: 'CONT.SE([custom:status] = "Ganho")',
    tokens: contSeStatus("Ganho"),
  },
};
const METRIC_CONVERSAO: Metric = {
  field: "calc:formula",
  agg: "sum",
  calc: true,
  label: "Conversão %",
  resultPercent: true,
  formula: {
    source: 'CONT.SE([custom:status] = "Ganho") / [agg:count:*]',
    tokens: [...contSeStatus("Ganho"), op("/"), fld("agg:count:*")],
  },
};

const CONV_GANHO: Formula = {
  tokens: [AT_GANHOS, op("/"), AT_MEET],
};
const CONV_LEADS_RR: Formula = {
  tokens: [LP, AT_RR, op("/"), AT_MEET, RP, op("*"), num(100)],
};
const CONV_RR_RQ: Formula = {
  tokens: [LP, AT_RQ, op("/"), AT_RR, RP, op("*"), num(100)],
};

// ---- dependências -----------------------------------------------------------

// Tier por "Quantidade de contas" — buckets do dashboard antigo
// (_obTierByCount): vazio/0 Sem tier · 1-9 Pequeno · 10-99 Médio · 100+ Grande.
const TIER_FIELD: PresetField = {
  field_key: "tier_contas",
  label: "Tier (contas)",
  data_type: "calculado",
  options: [],
  visible_to_roles: [],
  editable_by_roles: [],
  is_local: true,
  applies_to: ["meetime_outbound"],
  formula: {
    source:
      'SE([custom:quantidade_de_contas] >= 100; "Grande"; ' +
      'SE([custom:quantidade_de_contas] >= 10; "Médio"; ' +
      'SE([custom:quantidade_de_contas] >= 1; "Pequeno"; "Sem tier")))',
    tokens: [
      fn("SE"), LP, fld("custom:quantidade_de_contas"), cmp(">="), num(100),
      SEP, str("Grande"), SEP,
      fn("SE"), LP, fld("custom:quantidade_de_contas"), cmp(">="), num(10),
      SEP, str("Médio"), SEP,
      fn("SE"), LP, fld("custom:quantidade_de_contas"), cmp(">="), num(1),
      SEP, str("Pequeno"), SEP, str("Sem tier"), RP, RP, RP,
    ],
  },
};

const FIELDS: PresetField[] = [TIER_FIELD];

// Gate comum das reuniões outbound (leads Bitrix, regra jul/2026+).
const OB_LEAD_GATE: WidgetFilter[] = [
  { field: "custom:fonte", op: "eq", value: "Outro" },
  { field: F_DATA_REUNIAO, op: "not_null" },
  { field: F_DATA_REUNIAO, op: "gte", value: OB_CUTOFF },
];

const SUB_SOURCES: PresetSubSource[] = [
  {
    key: "ob_rr",
    parent_key: "leads",
    label: "Reuniões Realizadas (Outbound)",
    short_label: "RR OB",
    default_period_field: F_DATA_REUNIAO,
    filter: [
      { field: "stage", op: "in", value: ["Lead Qualificado", "Lead Desqualificado"] },
      ...OB_LEAD_GATE,
    ],
  },
  {
    key: "ob_rq",
    parent_key: "leads",
    label: "Reuniões Qualificadas (Outbound)",
    short_label: "RQ OB",
    default_period_field: F_DATA_REUNIAO,
    filter: [{ field: "stage", op: "eq", value: "Lead Qualificado" }, ...OB_LEAD_GATE],
  },
  {
    key: "ob_noshow",
    parent_key: "leads",
    label: "No Show (Outbound)",
    short_label: "No Show OB",
    default_period_field: F_MOVED_TIME,
    // Sem Data Reunião no no-show — a alocação é pela mudança de etapa
    // (adaptação documentada; o corte jul/2026 vale igual).
    filter: [
      { field: "stage", op: "eq", value: "No Show" },
      { field: "custom:fonte", op: "eq", value: "Outro" },
      { field: F_MOVED_TIME, op: "gte", value: OB_CUTOFF },
    ],
  },
  // Compartilhada com os dashboards de esforço construídos à mão (ensure por
  // key nunca sobrescreve a existente).
  {
    key: "ganhos_meetime",
    parent_key: "meetime_outbound",
    label: "Ganhos - Meetime",
    short_label: "Ganhos",
    default_period_field: "closed_at",
    filter: [{ field: "custom:status", op: "eq", value: "Ganho" }],
  },
];

// ---- aparência --------------------------------------------------------------
// Mesma identidade do preset Inbound (paleta "inbound" + roxo/verde/âmbar).
const BRAND_ACCENT = "#A98AC0";
const BRAND_CANVAS = "#E9ECEF";
const S_ROXO = "#8E5DB8";
const S_VERDE = "#0E9A78";
const S_AMBAR = "#B8791F";
const S_ROXO_ESCURO = "#6B4E8E";
const KPI_AP = { kpi: { accent: BRAND_ACCENT } };

const CMP = {
  comparison: {
    enabled: true,
    base: "previous_period" as const,
    format: "pct" as const,
    style: "both" as const,
  },
};

const QF_RESP = { quickFilters: [{ id: "qf_resp", field: "responsible_id" }] };

// ---- widgets · aba FUNIL ----------------------------------------------------
const FUNIL: PresetWidget[] = [
  {
    presetKey: "outbound.funil.kpi_abordados",
    title: "Leads abordados",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "funil", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 0, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.kpi_ganhos",
    title: "Ganhos (prospecção)",
    visual_type: "kpi",
    sources: ["ganhos_meetime"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "funil", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 3, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.kpi_taxa_ganho",
    title: "Taxa de conversão para ganho",
    visual_type: "calculado",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [
      {
        field: "calc:formula",
        agg: "sum",
        calc: true,
        label: "Taxa de conversão",
        resultPercent: true,
        formula: {
          source: "[agg:count:*@ganhos_meetime] / [agg:count:*@meetime_outbound]",
          tokens: CONV_GANHO.tokens,
        },
      },
    ],
    filters: [],
    settings: {
      tab: "funil",
      // Widget `calculado` consulta por settings.formula (CalcSettings) — a
      // métrica espelha p/ rótulo/percentual, como o builder salva.
      formula: {
        source: "[agg:count:*@ganhos_meetime] / [agg:count:*@meetime_outbound]",
        tokens: CONV_GANHO.tokens,
      },
      ...CMP,
      appearance: { decimals: 1 },
    },
    grid_position: { x: 6, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.kpi_dias_prospeccao",
    title: "Dias médios em prospecção",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "custom:dias_em_prospeccao", agg: "avg" }],
    filters: [],
    settings: {
      tab: "funil",
      ...CMP,
      appearance: { decimals: 1, ...KPI_AP },
    },
    grid_position: { x: 9, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.kpi_rr",
    title: "Reuniões Realizadas",
    visual_type: "kpi",
    sources: ["ob_rr"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "funil", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 0, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.kpi_noshow",
    title: "No Show",
    visual_type: "kpi",
    sources: ["ob_noshow"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "funil", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 3, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.kpi_rq",
    title: "Reuniões Qualificadas",
    visual_type: "kpi",
    sources: ["ob_rq"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "funil", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 6, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.kpi_meta_rq",
    title: "Meta de RQ",
    visual_type: "kpi",
    sources: ["ob_rq"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: {
      tab: "funil",
      mode: "meta",
      metric: "rq_outbound",
      scope: "global",
      period: "month",
      label: "Meta de RQ",
      appearance: { ...KPI_AP },
    },
    grid_position: { x: 9, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.conv_leads_rr",
    title: "Conversão Leads → RR",
    visual_type: "kpi",
    sources: [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "funil",
      ...CMP,
      card: {
        mode: "formula",
        formula: CONV_LEADS_RR,
        suffix: "%",
        secondaryText: "Reuniões realizadas / leads abordados no período",
      },
      appearance: { decimals: 1, ...KPI_AP },
    },
    grid_position: { x: 0, y: 8, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.conv_rr_rq",
    title: "Conversão RR → RQ",
    visual_type: "kpi",
    sources: [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "funil",
      ...CMP,
      card: {
        mode: "formula",
        formula: CONV_RR_RQ,
        suffix: "%",
        secondaryText: "Qualificadas / realizadas no período",
      },
      appearance: { decimals: 1, ...KPI_AP },
    },
    grid_position: { x: 3, y: 8, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.filtro_sdr",
    title: "SDR (todas as abas)",
    visual_type: "filtro_campo",
    sources: [],
    dimensions: [],
    metrics: [],
    filters: [],
    settings: {
      tab: "funil",
      fields: [{ field: "responsible_id", label: "SDR" }],
    },
    grid_position: { x: 6, y: 8, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.funil.evolucao_mensal",
    title: "Evolução Histórica (RR · RQ · Meta)",
    visual_type: "barra",
    sources: ["ob_rr"],
    dimensions: [
      { field: F_DATA_REUNIAO, transform: "month_year", label: "Mês" },
    ],
    metrics: [
      { field: "*", agg: "count", label: "RR" },
      { field: "*", agg: "count", label: "RQ", sources: ["ob_rq"] },
    ],
    filters: [],
    settings: {
      tab: "funil",
      periodWindow: {
        options: ["3m", "trimestre", "6m", "semestre", "12m"],
        default: "3m",
        showAlignToggle: false,
      },
      goalLine: {
        enabled: true,
        metric: "rq_outbound",
        mode: "monthly",
        scope: "global",
        label: "Meta RQ",
        color: S_AMBAR,
      },
      appearance: {
        legend: { show: true },
        seriesColors: { metric_1: S_ROXO, metric_2: S_VERDE },
      },
    },
    grid_position: { x: 0, y: 12, w: 8, h: 9 },
  },
  {
    presetKey: "outbound.funil.evolucao_semanal",
    title: "Evolução Semanal (RR · RQ)",
    visual_type: "barra",
    sources: ["ob_rr"],
    dimensions: [
      { field: F_DATA_REUNIAO, transform: "week_month", label: "Semana" },
    ],
    metrics: [
      { field: "*", agg: "count", label: "RR" },
      { field: "*", agg: "count", label: "RQ", sources: ["ob_rq"] },
    ],
    filters: [],
    settings: {
      tab: "funil",
      appearance: {
        legend: { show: true },
        seriesColors: { metric_1: S_ROXO, metric_2: S_VERDE },
      },
    },
    grid_position: { x: 8, y: 12, w: 4, h: 9 },
  },
  {
    presetKey: "outbound.funil.sdrs",
    title: "Performance dos SDRs (RR · RQ)",
    visual_type: "tabela",
    sources: ["ob_rr"],
    dimensions: [{ field: "responsible_id", label: "SDR" }],
    metrics: [
      { field: "*", agg: "count", label: "RR" },
      { field: "*", agg: "count", label: "RQ", sources: ["ob_rq"] },
      {
        field: "calc:formula",
        agg: "sum",
        calc: true,
        label: "Conversão %",
        resultPercent: true,
        formula: {
          source: "[agg:count:*@ob_rq] / [agg:count:*@ob_rr]",
          tokens: [AT_RQ, op("/"), AT_RR],
        },
      },
    ],
    filters: [],
    settings: { tab: "funil", appearance: { decimals: 1 } },
    grid_position: { x: 0, y: 21, w: 6, h: 9 },
  },
  {
    presetKey: "outbound.funil.origem_reunioes",
    title: "Origem das Reuniões",
    visual_type: "barra_horizontal",
    sources: ["ob_rr"],
    // Campo do registro Meetime CASADO ao lead (match "Meets Outbound").
    dimensions: [
      {
        field: "match:meetime_outbound:custom:origem_canal",
        label: "Canal de origem",
      },
    ],
    metrics: [{ field: "*", agg: "count", label: "Reuniões" }],
    filters: [],
    settings: {
      tab: "funil",
      appearance: {
        categoryLimit: { n: 8, others: true },
        colorByCategory: true,
        palette: "inbound",
      },
    },
    grid_position: { x: 6, y: 21, w: 6, h: 9 },
  },
  {
    presetKey: "outbound.funil.motivos_perda",
    title: "Motivos de Perda (prospecção)",
    visual_type: "barra_horizontal",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:motivo_de_perda", label: "Motivo" }],
    metrics: [{ field: "*", agg: "count", label: "Leads" }],
    filters: [{ field: "custom:motivo_de_perda", op: "not_null" }],
    settings: {
      tab: "funil",
      appearance: {
        categoryLimit: { n: 6, others: true },
        colorByCategory: true,
        palette: "inbound",
      },
    },
    grid_position: { x: 0, y: 30, w: 6, h: 9 },
  },
  {
    presetKey: "outbound.funil.status_pizza",
    title: "Distribuição por status (prospecção)",
    visual_type: "pizza",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:status", label: "Status" }],
    metrics: [{ field: "*", agg: "count", label: "Leads" }],
    filters: [],
    settings: { tab: "funil", appearance: { palette: "inbound" } },
    grid_position: { x: 6, y: 30, w: 6, h: 9 },
  },
];

// ---- widgets · aba PERFIL ---------------------------------------------------
const PERFIL: PresetWidget[] = [
  {
    presetKey: "outbound.perfil.areas_cargos",
    title: "Áreas (cargos) — abordagem e conversão",
    visual_type: "tabela",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:cargo_area", label: "Área" }],
    metrics: [
      { field: "*", agg: "count", label: "Leads" },
      METRIC_GANHOS,
      {
        field: "calc:formula",
        agg: "sum",
        calc: true,
        label: "Perdidos",
        formula: {
          source: 'CONT.SE([custom:status] = "Perdido")',
          tokens: contSeStatus("Perdido"),
        },
      },
      METRIC_CONVERSAO,
    ],
    filters: [],
    settings: { tab: "perfil", ...QF_RESP, appearance: { decimals: 1 } },
    grid_position: { x: 0, y: 0, w: 6, h: 10 },
  },
  {
    presetKey: "outbound.perfil.niveis_pizza",
    title: "Nível Hierárquico",
    visual_type: "pizza",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:cargo_nivel", label: "Nível" }],
    metrics: [{ field: "*", agg: "count", label: "Leads" }],
    filters: [],
    settings: {
      tab: "perfil",
      appearance: { palette: "inbound", categoryLimit: { n: 6, others: true } },
    },
    grid_position: { x: 6, y: 0, w: 3, h: 10 },
  },
  {
    presetKey: "outbound.perfil.niveis_conv",
    title: "Conversão por Nível",
    visual_type: "tabela",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:cargo_nivel", label: "Nível" }],
    metrics: [
      { field: "*", agg: "count", label: "Leads" },
      METRIC_GANHOS,
      METRIC_CONVERSAO,
    ],
    filters: [],
    settings: { tab: "perfil", appearance: { decimals: 1 } },
    grid_position: { x: 9, y: 0, w: 3, h: 10 },
  },
  {
    presetKey: "outbound.perfil.segmentos_top",
    title: "Top Segmentos",
    visual_type: "barra_horizontal",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:segmento_classificado", label: "Segmento" }],
    metrics: [{ field: "*", agg: "count", label: "Leads" }],
    filters: [],
    settings: {
      tab: "perfil",
      appearance: {
        categoryLimit: { n: 10, others: false },
        colorByCategory: true,
        palette: "inbound",
      },
    },
    grid_position: { x: 0, y: 10, w: 6, h: 10 },
  },
  {
    presetKey: "outbound.perfil.segmentos_conv",
    title: "Segmentos — abordagem e conversão",
    visual_type: "tabela",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:segmento_classificado", label: "Segmento" }],
    metrics: [
      { field: "*", agg: "count", label: "Leads" },
      METRIC_GANHOS,
      METRIC_CONVERSAO,
    ],
    filters: [],
    settings: {
      tab: "perfil",
      ...QF_RESP,
      appearance: {
        decimals: 1,
        conditional: {
          rules: [
            {
              id: "cr_conv20",
              target: "metric_3",
              op: "gte",
              value: 20,
              scope: "cell",
              style: { text: "#16a34a", bold: true },
            },
          ],
        },
      },
    },
    grid_position: { x: 6, y: 10, w: 6, h: 10 },
  },
  {
    presetKey: "outbound.perfil.tier_conv",
    title: "Tier (contas) — abordagem e conversão",
    visual_type: "tabela",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:tier_contas", label: "Tier" }],
    metrics: [
      { field: "*", agg: "count", label: "Leads" },
      METRIC_GANHOS,
      METRIC_CONVERSAO,
    ],
    filters: [],
    settings: { tab: "perfil", appearance: { decimals: 1 } },
    grid_position: { x: 0, y: 20, w: 6, h: 9 },
  },
  {
    presetKey: "outbound.perfil.tier_ganhos",
    title: "Ganhos por Tier",
    visual_type: "pizza",
    sources: ["ganhos_meetime"],
    dimensions: [{ field: "custom:tier_contas", label: "Tier" }],
    metrics: [{ field: "*", agg: "count", label: "Ganhos" }],
    filters: [],
    settings: { tab: "perfil", appearance: { palette: "inbound" } },
    grid_position: { x: 6, y: 20, w: 6, h: 9 },
  },
];

// ---- widgets · aba ESFORÇO --------------------------------------------------
const ESFORCO: PresetWidget[] = [
  {
    presetKey: "outbound.esforco.kpi_atividades",
    title: "Atividades realizadas",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "custom:atividades", agg: "sum" }],
    filters: [],
    settings: { tab: "esforco", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 0, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.esforco.kpi_ligacoes",
    title: "Ligações",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "custom:ligacoes", agg: "sum" }],
    filters: [],
    settings: { tab: "esforco", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 3, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.esforco.kpi_emails",
    title: "E-mails",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "custom:e_mails", agg: "sum" }],
    filters: [],
    settings: { tab: "esforco", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 6, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.esforco.kpi_trabalhados",
    title: "Leads trabalhados",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "*", agg: "count" }],
    filters: [],
    settings: { tab: "esforco", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 9, y: 0, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.esforco.kpi_atividades_por_lead",
    title: "Atividades por lead",
    visual_type: "calculado",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [
      {
        field: "calc:formula",
        agg: "sum",
        calc: true,
        label: "Média",
        formula: {
          source: "[agg:sum:custom:atividades] / [agg:count:*]",
          tokens: [fld("agg:sum:custom:atividades"), op("/"), fld("agg:count:*")],
        },
      },
    ],
    filters: [],
    settings: {
      tab: "esforco",
      formula: {
        source: "[agg:sum:custom:atividades] / [agg:count:*]",
        tokens: [fld("agg:sum:custom:atividades"), op("/"), fld("agg:count:*")],
      },
      ...CMP,
      appearance: { decimals: 2 },
    },
    grid_position: { x: 0, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.esforco.kpi_ignoradas",
    title: "Atividades ignoradas",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "custom:atividades_ignoradas", agg: "sum" }],
    filters: [],
    settings: { tab: "esforco", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 3, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.esforco.kpi_tempo_resposta",
    title: "Tempo médio de resposta (min)",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "custom:tempo_de_resposta_em_minutos", agg: "avg" }],
    filters: [],
    settings: {
      tab: "esforco",
      ...CMP,
      appearance: { decimals: 0, ...KPI_AP },
    },
    grid_position: { x: 6, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.esforco.kpi_pesquisas",
    title: "Pesquisas",
    visual_type: "kpi",
    sources: ["meetime_outbound"],
    dimensions: [],
    metrics: [{ field: "custom:pesquisas", agg: "sum" }],
    filters: [],
    settings: { tab: "esforco", ...CMP, appearance: { ...KPI_AP } },
    grid_position: { x: 9, y: 4, w: 3, h: 4 },
  },
  {
    presetKey: "outbound.esforco.composicao_semana",
    title: "Composição do esforço por dia da semana",
    visual_type: "barra",
    sources: ["meetime_outbound"],
    dimensions: [
      { field: "source_created_at", transform: "weekday", label: "Dia" },
    ],
    metrics: [
      { field: "custom:ligacoes", agg: "sum", label: "Ligações" },
      { field: "custom:e_mails", agg: "sum", label: "E-mails" },
      { field: "custom:social_points", agg: "sum", label: "Social points" },
      { field: "custom:pesquisas", agg: "sum", label: "Pesquisas" },
    ],
    filters: [],
    settings: {
      tab: "esforco",
      appearance: { legend: { show: true }, stacked: true, palette: "inbound" },
    },
    grid_position: { x: 0, y: 8, w: 6, h: 9 },
  },
  {
    presetKey: "outbound.esforco.esforco_canal",
    title: "Esforço por canal de contato",
    visual_type: "barra",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "responsible_id", label: "SDR" }],
    metrics: [
      { field: "custom:ligacoes", agg: "sum", label: "Ligações" },
      { field: "custom:e_mails", agg: "sum", label: "E-mails" },
      { field: "custom:social_points", agg: "sum", label: "Social points" },
    ],
    filters: [],
    settings: {
      tab: "esforco",
      appearance: { legend: { show: true }, stacked: true, palette: "inbound" },
    },
    grid_position: { x: 6, y: 8, w: 6, h: 9 },
  },
  {
    presetKey: "outbound.esforco.esforco_por_sdr",
    title: "Detalhamento de esforço por SDR",
    visual_type: "tabela",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "responsible_id", label: "SDR" }],
    metrics: [
      { field: "*", agg: "count", label: "Leads" },
      { field: "custom:atividades", agg: "sum", label: "Atividades" },
      { field: "custom:ligacoes", agg: "sum", label: "Ligações" },
      { field: "custom:e_mails", agg: "sum", label: "E-mails" },
      { field: "custom:social_points", agg: "sum", label: "Social points" },
      { field: "custom:pesquisas", agg: "sum", label: "Pesquisas" },
      {
        field: "calc:formula",
        agg: "sum",
        calc: true,
        label: "Atividades/lead",
        formula: {
          source: "[agg:sum:custom:atividades] / [agg:count:*]",
          tokens: [fld("agg:sum:custom:atividades"), op("/"), fld("agg:count:*")],
        },
      },
    ],
    filters: [],
    settings: { tab: "esforco", appearance: { decimals: 1 } },
    grid_position: { x: 0, y: 17, w: 12, h: 9 },
  },
  {
    presetKey: "outbound.esforco.conv_cadencia",
    title: "Conversão por cadência",
    visual_type: "tabela",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:cadencia", label: "Cadência" }],
    metrics: [
      { field: "*", agg: "count", label: "Leads" },
      METRIC_GANHOS,
      METRIC_CONVERSAO,
    ],
    filters: [],
    settings: { tab: "esforco", ...QF_RESP, appearance: { decimals: 1 } },
    grid_position: { x: 0, y: 26, w: 6, h: 9 },
  },
  {
    presetKey: "outbound.esforco.ate_o_ganho",
    title: "Esforço até o desfecho (por status)",
    visual_type: "tabela",
    sources: ["meetime_outbound"],
    dimensions: [{ field: "custom:status", label: "Status" }],
    metrics: [
      { field: "*", agg: "count", label: "Leads" },
      { field: "custom:atividades", agg: "avg", label: "Média de atividades" },
      { field: "custom:dias_em_prospeccao", agg: "avg", label: "Média de dias" },
    ],
    filters: [],
    settings: { tab: "esforco", ...QF_RESP, appearance: { decimals: 1 } },
    grid_position: { x: 6, y: 26, w: 6, h: 9 },
  },
  {
    presetKey: "outbound.esforco.abordados_mes",
    title: "Leads abordados por mês",
    visual_type: "barra",
    sources: ["meetime_outbound"],
    dimensions: [
      { field: "source_created_at", transform: "month_year", label: "Mês" },
    ],
    metrics: [{ field: "*", agg: "count", label: "Leads" }],
    filters: [],
    settings: {
      tab: "esforco",
      periodWindow: {
        options: ["3m", "6m", "12m"],
        default: "6m",
        showAlignToggle: false,
      },
      appearance: { seriesColors: { metric_1: S_ROXO_ESCURO } },
    },
    grid_position: { x: 0, y: 35, w: 12, h: 9 },
  },
];

export const OUTBOUND_PRESET: PresetDashboard = {
  presetKey: "outbound",
  version: 1,
  name: "Outbound — Pré-Vendas",
  visible_to_roles: ["admin", "gestor"],
  settings: {
    tabs: [
      { id: "funil", name: "Funil" },
      { id: "perfil", name: "Perfil" },
      { id: "esforco", name: "Esforço" },
    ],
    periodBar: { enabled: true, defaultPreset: "este_mes", scope: "global" },
    canvas: { cols: 12, rowHeight: 30 },
    background: { mode: "solid", color: BRAND_CANVAS },
  },
  fields: FIELDS,
  subSources: SUB_SOURCES,
  widgets: [...FUNIL, ...PERFIL, ...ESFORCO],
};
