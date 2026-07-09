// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — WidgetConfig/Widget ganham `sources` (fontes
//   usadas; vazio = todas) e `splitBySource` (quebrar por fonte).
// Tipos do construtor de dashboards (Fase 6A).
import type { SourceKey } from "@/lib/sources";

export type VisualType =
  | "tabela"
  | "barra"
  | "linha"
  | "pizza"
  | "kpi"
  | "funil"
  | "filtro";

export const VISUAL_TYPE_LABELS: Record<VisualType, string> = {
  kpi: "KPI (número)",
  tabela: "Tabela",
  barra: "Barra",
  linha: "Linha",
  pizza: "Pizza",
  funil: "Funil",
  filtro: "Filtro de período",
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

// Config do widget de filtro de período (visual_type 'filtro'), guardada em
// widgets.settings. `defaultPreset` guarda uma chave de PERIOD_PRESETS (ou "").
export interface FilterSettings {
  kind?: "period";
  targets?: string[]; // ids dos widgets controlados; vazio = dashboard inteiro
  field?: string; // campo de data alvo (default closed_at)
  defaultPreset?: string; // preset inicial (chave de PERIOD_PRESETS) ou ""
  defaultDe?: string; // range personalizado inicial (ISO YYYY-MM-DD)
  defaultAte?: string;
}

// settings de um widget é jsonb frouxo: KPI (meta/razão) e/ou filtro convivem.
export type WidgetSettings = KpiSettings & FilterSettings;

// Config por dashboard, guardada em dashboards.settings.
export interface DashboardSettings {
  periodBar?: {
    enabled?: boolean; // default true (barra global visível)
    defaultPreset?: string; // preset inicial da barra global
    field?: string; // campo de data padrão da barra global
  };
}

export interface WidgetConfig {
  source: "records";
  // Fase 8: fontes selecionadas (vazio/ausente = todas) e modo "quebrar por fonte".
  sources?: SourceKey[];
  splitBySource?: boolean;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  visual_type: VisualType;
  settings?: WidgetSettings;
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
  sources?: SourceKey[];
  split_by_source?: boolean;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  settings?: WidgetSettings;
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
