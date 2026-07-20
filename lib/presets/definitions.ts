// Versão: 2.0 | Data: 20/07/2026
// Definições declarativas dos dashboards preset (Fase 6B) + campos de apoio.
// v2.0 (20/07/2026): preset engine v2 — shapes COMPLETOS e identidade estável:
//   - PresetDashboard ganha presetKey/version, settings (DashboardSettings:
//     abas, periodBar/fieldBySource, canvas, background) e dependências
//     declaráveis: fields (por preset) e subSources (sub-fontes, 0078/0082).
//   - PresetWidget ganha presetKey (OBRIGATÓRIO, prefixado com o presetKey do
//     dashboard + ".": ex. "inbound.geral.kpi_mql" — a identidade do update e
//     do garbage-collect), sources/split_by_source e settings completo
//     (WidgetSettings: tab, quickFilters, comparison, goalLine,
//     businessDayAlign, appearance…).
//   O aplicador (applyPreset em app/(app)/dashboards/actions.ts) CRIA e
//   ATUALIZA idempotentemente: dashboard identificado por
//   settings.preset.key, widgets por settings.presetKey (update in-place
//   preserva ids → conectores/links/células); widgets sem presetKey
//   (adicionados à mão) nunca são tocados. Metas/feriados NÃO são deps de
//   preset (dados operacionais); o aplicador apenas registra as chaves de
//   métrica de meta usadas no registry goal_metrics.
// v1.1 (18/07/2026): remove `implementacao` dos campos locais de apoio — passou a
//   ser campo sincronizado do Bitrix (UF_CRM_1778094396888; ver migração 0075).
// Observação: o motor de widgets AGREGA (group by) — não lista registros linha a
// linha. Por isso as "tabelas" dos presets são agregadas (por operação/vendedor),
// aproximando o print ("mais ou menos"). Filtros usam tokens de período
// (@month_start/@year_start...) resolvidos no engine.
import type {
  DashboardSettings,
  Dimension,
  GridPosition,
  Metric,
  VisualType,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";
import type { SourceKey } from "@/lib/sources";
import type { DataType } from "@/lib/records/types";
import type { Formula } from "@/lib/records/formulas";

export interface PresetField {
  field_key: string;
  label: string;
  data_type: DataType;
  options: string[];
  visible_to_roles: string[];
  editable_by_roles: string[];
  is_local: boolean;
  // Campos 'moeda': 'inherit' = moeda do registro (padrão do sistema).
  currency_mode?: string;
  // Campos 'calculado'/'calculado_agg' (20/07/2026): fórmula persistida
  // (tokens — mesmo shape de field_definitions.formula). Criar um campo
  // 'calculado' dispara o recálculo global (materialização em custom_fields).
  formula?: Formula;
  // record_types a que o campo se aplica (field_definitions.applies_to);
  // ausente = todas as fontes.
  applies_to?: string[];
}

// Correspondência (campo unificado) declarada como dependência do preset:
// criada se ausente (por key); existente NUNCA é sobrescrita. O record_type de
// cada membro é resolvido pelo catálogo a partir da source_key (sub-fonte →
// record_type da pai) — por isso as sub-fontes do preset são criadas ANTES.
export interface PresetCorrespondence {
  key: string;
  label: string;
  data_type: DataType;
  members: { source_key: string; field_ref: string }[];
}

// Sub-fonte declarada como dependência do preset (criada se ausente; uma
// sub-fonte já existente com a mesma key NUNCA é sobrescrita — o admin pode
// tê-la ajustado). default_period_field aceita coluna core ou 'custom:<key>'
// (0082 — ex.: Data Reunião).
export interface PresetSubSource {
  key: string;
  parent_key: string;
  label: string;
  short_label?: string;
  default_period_field: string;
  filter: WidgetFilter[];
}

export interface PresetWidget {
  // Identidade estável do widget dentro do preset (convenção:
  // "<presetKey do dashboard>.<aba>.<nome>"). Persistida em
  // widgets.settings.presetKey; é a chave do update/GC do aplicador.
  presetKey: string;
  title: string;
  visual_type: VisualType;
  sources?: SourceKey[];
  split_by_source?: boolean;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  settings?: WidgetSettings;
  grid_position: GridPosition;
}

export interface PresetDashboard {
  presetKey: string; // identidade estável (dashboards.settings.preset.key)
  version: number; // bump a cada mudança relevante (auditoria/futuro diff)
  name: string;
  visible_to_roles: string[];
  // Seções GERIDAS pelo preset (sobrescritas no update quando presentes):
  // periodBar, canvas, background, dateFormat; `tabs` faz merge por id
  // preservando abas criadas pelo usuário. Demais chaves (connectors…) são
  // preservadas.
  settings?: DashboardSettings;
  fields?: PresetField[]; // campos de apoio específicos deste preset
  subSources?: PresetSubSource[]; // sub-fontes de que os widgets dependem
  correspondences?: PresetCorrespondence[]; // campos unificados dependidos
  widgets: PresetWidget[];
}

// Campos locais de apoio criados junto dos presets ("Forecast/temperatura são
// criados por mim junto dos presets").
export const PRESET_FIELDS: PresetField[] = [
  {
    field_key: "forecast",
    label: "Forecast",
    data_type: "moeda",
    options: [],
    visible_to_roles: ["admin", "gestor", "vendedor"],
    editable_by_roles: ["admin", "gestor", "vendedor"],
    is_local: true,
    currency_mode: "inherit",
  },
  {
    field_key: "potencial",
    label: "Potencial",
    data_type: "texto",
    options: [],
    visible_to_roles: ["admin", "gestor", "vendedor"],
    editable_by_roles: ["admin", "gestor", "vendedor"],
    is_local: true,
  },
  {
    field_key: "desconto",
    label: "Desconto (%)",
    data_type: "numero",
    options: [],
    visible_to_roles: ["admin", "gestor", "vendedor"],
    editable_by_roles: ["admin", "gestor", "vendedor"],
    is_local: true,
  },
];

import { INBOUND_PRESET } from "./inbound";

// Filtros reutilizáveis
const closedThisMonth: WidgetFilter[] = [
  { field: "closed", op: "eq", value: true },
  { field: "closed_at", op: "gte", value: "@month_start" },
  { field: "closed_at", op: "lte", value: "@month_end" },
];
const closedThisYear: WidgetFilter[] = [
  { field: "closed", op: "eq", value: true },
  { field: "closed_at", op: "gte", value: "@year_start" },
];

export const PRESETS: PresetDashboard[] = [
  INBOUND_PRESET,
  {
    presetKey: "performance_mes",
    version: 1,
    name: "Performance comercial do mês",
    visible_to_roles: ["admin", "gestor"],
    widgets: [
      {
        presetKey: "performance_mes.kpi_mrr",
        title: "MRR do mês",
        visual_type: "kpi",
        dimensions: [],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisMonth,
        settings: { mode: "meta", metric: "mrr", scope: "global", period: "month", label: "MRR" },
        grid_position: { x: 0, y: 0, w: 3, h: 4 },
      },
      {
        presetKey: "performance_mes.kpi_clientes",
        title: "Clientes do mês",
        visual_type: "kpi",
        dimensions: [],
        metrics: [{ field: "*", agg: "count" }],
        filters: closedThisMonth,
        settings: { mode: "meta", metric: "clientes", scope: "global", period: "month", label: "Clientes" },
        grid_position: { x: 3, y: 0, w: 3, h: 4 },
      },
      {
        presetKey: "performance_mes.kpi_ticket",
        title: "Ticket médio",
        visual_type: "kpi",
        dimensions: [],
        metrics: [],
        filters: closedThisMonth,
        settings: {
          mode: "ratio",
          numerator: { field: "mrr", agg: "sum" },
          denominator: { field: "*", agg: "count" },
          label: "Ticket médio (R$)",
        },
        grid_position: { x: 6, y: 0, w: 3, h: 4 },
      },
      {
        presetKey: "performance_mes.kpi_mrr_ano",
        title: "Novo MRR no ano",
        visual_type: "kpi",
        dimensions: [],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisYear,
        grid_position: { x: 9, y: 0, w: 3, h: 4 },
      },
      {
        presetKey: "performance_mes.mrr_vendedor",
        title: "MRR por vendedor (mês)",
        visual_type: "barra",
        dimensions: [{ field: "responsible_id" }],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisMonth,
        grid_position: { x: 0, y: 4, w: 6, h: 8 },
      },
      {
        presetKey: "performance_mes.mrr_mes",
        title: "MRR por mês (ano)",
        visual_type: "linha",
        dimensions: [{ field: "closed_at", transform: "month" }],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisYear,
        grid_position: { x: 6, y: 4, w: 6, h: 8 },
      },
      {
        presetKey: "performance_mes.sql_operacao",
        title: "SQL por operação",
        visual_type: "funil",
        dimensions: [{ field: "operation_id" }],
        metrics: [{ field: "*", agg: "count" }],
        filters: [
          { field: "record_type", op: "eq", value: "lead" },
          { field: "custom:sales_qualified_lead", op: "eq", value: "true" },
        ],
        grid_position: { x: 0, y: 12, w: 6, h: 8 },
      },
      {
        presetKey: "performance_mes.fechamentos",
        title: "Fechamentos por operação e vendedor (mês)",
        visual_type: "tabela",
        dimensions: [{ field: "operation_id" }, { field: "responsible_id" }],
        metrics: [
          { field: "mrr", agg: "sum" },
          { field: "*", agg: "count" },
        ],
        filters: closedThisMonth,
        grid_position: { x: 6, y: 12, w: 6, h: 8 },
      },
    ],
  },
  {
    presetKey: "forecast_mes",
    version: 1,
    name: "Forecast do mês",
    visible_to_roles: ["admin", "gestor", "vendedor"],
    widgets: [
      {
        presetKey: "forecast_mes.kpi_total",
        title: "Forecast total (aberto)",
        visual_type: "kpi",
        dimensions: [],
        metrics: [{ field: "custom:forecast", agg: "sum" }],
        filters: [
          { field: "closed", op: "eq", value: false },
          { field: "custom:forecast", op: "not_null" },
        ],
        grid_position: { x: 0, y: 0, w: 4, h: 4 },
      },
      {
        presetKey: "forecast_mes.tabela",
        title: "Forecast por vendedor e etapa",
        visual_type: "tabela",
        dimensions: [{ field: "responsible_id" }, { field: "stage" }],
        metrics: [
          { field: "custom:forecast", agg: "sum" },
          { field: "*", agg: "count" },
        ],
        filters: [
          { field: "closed", op: "eq", value: false },
          { field: "custom:forecast", op: "not_null" },
        ],
        grid_position: { x: 0, y: 4, w: 12, h: 8 },
      },
    ],
  },
  {
    presetKey: "mrr_vendedor",
    version: 1,
    name: "MRR por vendedor",
    visible_to_roles: ["admin", "gestor"],
    widgets: [
      {
        presetKey: "mrr_vendedor.barra",
        title: "MRR por vendedor (ano)",
        visual_type: "barra",
        dimensions: [{ field: "responsible_id" }],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisYear,
        grid_position: { x: 0, y: 0, w: 12, h: 9 },
      },
    ],
  },
  {
    presetKey: "mrr_canal",
    version: 1,
    name: "MRR por canal",
    visible_to_roles: ["admin", "gestor"],
    widgets: [
      {
        presetKey: "mrr_canal.pizza",
        title: "MRR por canal (ano)",
        visual_type: "pizza",
        dimensions: [{ field: "channel" }],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisYear,
        grid_position: { x: 0, y: 0, w: 6, h: 8 },
      },
      {
        presetKey: "mrr_canal.tipo_venda",
        title: "MRR por tipo de venda (ano)",
        visual_type: "barra",
        dimensions: [{ field: "sale_type" }],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisYear,
        grid_position: { x: 6, y: 0, w: 6, h: 8 },
      },
    ],
  },
];
