// Versão: 1.0 | Data: 05/07/2026
// Tipos do construtor de dashboards (Fase 6A).

export type VisualType = "tabela" | "barra" | "linha" | "pizza" | "kpi" | "funil";

export const VISUAL_TYPE_LABELS: Record<VisualType, string> = {
  kpi: "KPI (número)",
  tabela: "Tabela",
  barra: "Barra",
  linha: "Linha",
  pizza: "Pizza",
  funil: "Funil",
};

export type Aggregation = "sum" | "count" | "avg";
export const AGG_LABELS: Record<Aggregation, string> = {
  sum: "Soma",
  count: "Contagem",
  avg: "Média",
};

export type Transform = "none" | "day" | "week" | "month" | "quarter" | "year";
export const TRANSFORM_LABELS: Record<Transform, string> = {
  none: "—",
  day: "Dia",
  week: "Semana",
  month: "Mês",
  quarter: "Trimestre",
  year: "Ano",
};

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "is_null"
  | "not_null";

export interface Dimension {
  field: string;
  transform?: Transform;
}
export interface Metric {
  field: string;
  agg: Aggregation;
}
export interface WidgetFilter {
  field: string;
  op: FilterOp;
  value?: unknown;
}

// Extras de KPI (Fase 6B): comparação com meta e razões (TM, valor/conta).
export interface KpiSettings {
  mode?: "meta" | "ratio";
  metric?: string; // modo meta: 'mrr' | 'clientes'
  scope?: "global" | "operation" | "responsible";
  operationId?: string | null;
  responsibleId?: string | null;
  period?: "month" | "year";
  numerator?: Metric; // modo razão
  denominator?: Metric;
  label?: string;
}

export interface WidgetConfig {
  source: "records";
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  visual_type: VisualType;
  settings?: KpiSettings;
}

export interface KpiResult {
  mode: "meta" | "ratio";
  label: string;
  realizado?: number;
  meta?: number | null;
  pct?: number | null;
  falta?: number | null;
  value?: number | null;
}

export interface GridPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Widget {
  id: string;
  dashboard_id: string;
  title: string | null;
  visual_type: VisualType;
  source: string;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  settings?: KpiSettings;
  grid_position: GridPosition | Record<string, never>;
  sort_order: number;
}

export interface Dashboard {
  id: string;
  name: string;
  owner_user_id: string | null;
  visible_to_roles: string[];
  is_shared: boolean;
}

/** Resultado já pronto para os charts. */
export interface WidgetData {
  rows: Record<string, unknown>[]; // chaves dim_1.., metric_1..
  dimensions: { key: string; label: string }[];
  metrics: { key: string; label: string }[];
  kpi?: KpiResult; // preenchido só quando o KPI tem settings (meta/razão)
}
