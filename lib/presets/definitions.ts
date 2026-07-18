// Versão: 1.1 | Data: 18/07/2026
// Definições declarativas dos dashboards preset (Fase 6B) + campos de apoio.
// v1.1 (18/07/2026): remove `implementacao` dos campos locais de apoio — passou a
//   ser campo sincronizado do Bitrix (UF_CRM_1778094396888; ver migração 0075).
// Observação: o motor de widgets AGREGA (group by) — não lista registros linha a
// linha. Por isso as "tabelas" dos presets são agregadas (por operação/vendedor),
// aproximando o print ("mais ou menos"). Filtros usam tokens de período
// (@month_start/@year_start...) resolvidos no engine.
import type {
  Dimension,
  GridPosition,
  KpiSettings,
  Metric,
  VisualType,
  WidgetFilter,
} from "@/lib/widgets/types";
import type { DataType } from "@/lib/records/types";

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
}

export interface PresetWidget {
  title: string;
  visual_type: VisualType;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  settings?: KpiSettings;
  grid_position: GridPosition;
}

export interface PresetDashboard {
  name: string;
  visible_to_roles: string[];
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
  {
    name: "Performance comercial do mês",
    visible_to_roles: ["admin", "gestor"],
    widgets: [
      {
        title: "MRR do mês",
        visual_type: "kpi",
        dimensions: [],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisMonth,
        settings: { mode: "meta", metric: "mrr", scope: "global", period: "month", label: "MRR" },
        grid_position: { x: 0, y: 0, w: 3, h: 4 },
      },
      {
        title: "Clientes do mês",
        visual_type: "kpi",
        dimensions: [],
        metrics: [{ field: "*", agg: "count" }],
        filters: closedThisMonth,
        settings: { mode: "meta", metric: "clientes", scope: "global", period: "month", label: "Clientes" },
        grid_position: { x: 3, y: 0, w: 3, h: 4 },
      },
      {
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
        title: "Novo MRR no ano",
        visual_type: "kpi",
        dimensions: [],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisYear,
        grid_position: { x: 9, y: 0, w: 3, h: 4 },
      },
      {
        title: "MRR por vendedor (mês)",
        visual_type: "barra",
        dimensions: [{ field: "responsible_id" }],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisMonth,
        grid_position: { x: 0, y: 4, w: 6, h: 8 },
      },
      {
        title: "MRR por mês (ano)",
        visual_type: "linha",
        dimensions: [{ field: "closed_at", transform: "month" }],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisYear,
        grid_position: { x: 6, y: 4, w: 6, h: 8 },
      },
      {
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
    name: "Forecast do mês",
    visible_to_roles: ["admin", "gestor", "vendedor"],
    widgets: [
      {
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
    name: "MRR por vendedor",
    visible_to_roles: ["admin", "gestor"],
    widgets: [
      {
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
    name: "MRR por canal",
    visible_to_roles: ["admin", "gestor"],
    widgets: [
      {
        title: "MRR por canal (ano)",
        visual_type: "pizza",
        dimensions: [{ field: "channel" }],
        metrics: [{ field: "mrr", agg: "sum" }],
        filters: closedThisYear,
        grid_position: { x: 0, y: 0, w: 6, h: 8 },
      },
      {
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
