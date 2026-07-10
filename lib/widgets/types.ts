// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — WidgetConfig/Widget ganham `sources` (fontes
//   usadas; vazio = todas) e `splitBySource` (quebrar por fonte).
// Tipos do construtor de dashboards (Fase 6A).
import type { SourceKey } from "@/lib/sources";
import type { Formula } from "@/lib/records/formulas";

export type VisualType =
  | "tabela"
  | "barra"
  | "barra_horizontal"
  | "linha"
  | "pizza"
  | "kpi"
  | "funil"
  | "filtro"
  | "tabela_editavel"
  | "calculado";

export const VISUAL_TYPE_LABELS: Record<VisualType, string> = {
  kpi: "KPI (número)",
  calculado: "Métrica calculada",
  tabela: "Tabela",
  tabela_editavel: "Tabela editável",
  barra: "Barra",
  barra_horizontal: "Barra horizontal",
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

// Config do widget de Tabela no modo "registros individuais" (Fase 1): a tabela
// lista 1 linha por registro (sem agregação) e colunas marcadas como editáveis
// gravam de volta no registro (via updateRecordField, respeitando permissões).
export interface RecordListColumn {
  field: string; // 'title' | 'stage' | 'custom:<key>' | ...
  editable?: boolean; // só faz efeito em campos personalizados (custom:*)
}
export interface RecordListSettings {
  rowMode?: "records"; // presença => modo lista no widget 'tabela'
  columns?: RecordListColumn[]; // colunas ordenadas a exibir
  limit?: number; // teto de linhas (default 100)
}

// Config do widget "Tabela editável" (Fase 2): grade com linhas/colunas
// nomeadas, cujos valores (dashboard-scoped) vivem em dashboard_table_cells.
// Cada eixo tem `key` estável (gerado na criação) + `label` livre — renomear o
// label não órfã as células nem quebra referências de fórmula (que usam `key`).
export interface MatrixAxis {
  key: string;
  label: string;
}
export interface MatrixSettings {
  matrix?: {
    rows: MatrixAxis[];
    cols: MatrixAxis[];
    cellType?: "numero" | "texto"; // default 'numero'
  };
}

// Config do widget "Métrica calculada" (Fase 3): uma fórmula avaliada com um
// contexto de dashboard. Os refs podem apontar para células/linhas/colunas de
// tabelas editáveis (table:*) e para agregações de registros (agg:*).
export interface CalcSettings {
  formula?: Formula;
}

// Aparência de um widget (Fase 10): camada opcional lida na renderização, com
// fallback total para o comportamento atual (paleta do design system) quando
// ausente. Aninhada em WidgetSettings.appearance p/ não colidir com as demais
// chaves (KPI/filtro/matriz/lista). Nada aqui altera a forma dos dados.
export type GridLines = "none" | "horizontal" | "vertical" | "both";
export type AxisSide = "left" | "right";
export type TableSortDir = "asc" | "desc" | "alpha" | "color";

export interface AppearanceSettings {
  // --- gráficos (barra / barra_horizontal / linha) ---
  chartBackground?: string; // fundo do gráfico
  gridLines?: GridLines; // linhas de grade
  fillMode?: "solid" | "gradient"; // sólido ou gradiente sutil entre colunas
  seriesColors?: Record<string, string>; // metricKey -> cor (toda a série)
  columnColors?: Record<number, string>; // índice da categoria -> cor (série única)
  seriesAxis?: Record<string, AxisSide>; // metricKey -> eixo esq/dir (combo)
  dataLabels?: { show?: boolean; position?: "inside" | "top"; color?: string };
  legend?: { show?: boolean; color?: string }; // legenda do gráfico (séries)
  // --- pizza ---
  palette?: string; // chave de paleta nomeada (PALETTES)
  sliceColors?: Record<number, string>; // fatia -> cor (sobrepõe a paleta)
  // --- tabela ---
  table?: {
    gridLines?: GridLines;
    headerBg?: string;
    headerColor?: string;
    bodyBg?: string;
    bodyColor?: string;
    borderColor?: string;
    columnColors?: Record<string, string>; // colKey -> cor
    rowColors?: Record<number, string>; // índice da linha -> cor
    cellColors?: Record<string, string>; // "rowIndex:colKey" -> cor
    columnOrder?: string[]; // ordem das colunas (reordenação)
    sort?: { column: string; dir: TableSortDir };
  };
  // --- kpi ---
  kpi?: { bg?: string; border?: string; accent?: string }; // accent = abinha superior
}

// settings de um widget é jsonb frouxo: KPI (meta/razão), filtro, o modo lista
// de tabela, a matriz editável, a métrica calculada e a aparência (Fase 10)
// convivem no mesmo objeto.
export type WidgetSettings = KpiSettings &
  FilterSettings &
  RecordListSettings &
  MatrixSettings &
  CalcSettings & { appearance?: AppearanceSettings };

// Config por dashboard, guardada em dashboards.settings.
export interface DashboardSettings {
  periodBar?: {
    enabled?: boolean; // default true (barra global visível)
    defaultPreset?: string; // preset inicial da barra global
    field?: string; // campo de data padrão da barra global
  };
  // Fundo da área do dashboard (Fase 10): sólido ou gradiente sutil.
  background?: {
    mode: "solid" | "gradient";
    color?: string; // modo sólido
    from?: string; // modo gradiente
    to?: string;
    angle?: number; // graus (default 135)
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
