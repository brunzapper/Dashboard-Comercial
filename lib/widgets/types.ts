// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — WidgetConfig/Widget ganham `sources` (fontes
//   usadas; vazio = todas) e `splitBySource` (quebrar por fonte).
// Tipos do construtor de dashboards (Fase 6A).
import type { SourceKey } from "@/lib/sources";
import type { Formula } from "@/lib/records/formulas";
import type { DateFormat } from "./format";
import type {
  ConversionBasis,
  CurrencyDisplay,
  CurrencyMultiMode,
  GrandTotalMode,
} from "./currency";

export type VisualType =
  | "tabela"
  | "barra"
  | "barra_horizontal"
  | "linha"
  | "pizza"
  | "kpi"
  | "funil"
  | "filtro"
  | "filtro_campo"
  | "calculado";

export const VISUAL_TYPE_LABELS: Record<VisualType, string> = {
  kpi: "KPI (número)",
  calculado: "Métrica calculada",
  tabela: "Tabela",
  barra: "Barra",
  barra_horizontal: "Barra horizontal",
  linha: "Linha",
  pizza: "Pizza",
  funil: "Funil",
  filtro: "Filtro de período",
  filtro_campo: "Filtro por campo",
};

export type Aggregation = "sum" | "count" | "avg";
export const AGG_LABELS: Record<Aggregation, string> = {
  sum: "Soma",
  count: "Contagem",
  avg: "Média",
};

export type Transform =
  | "none"
  | "weekday" // Segunda-feira…
  | "quarter" // T1/26
  | "year" // 2026
  // Transforms "por nome" (rótulo textual, agrupam por mês/semana no período):
  | "month_name" // Janeiro
  | "month_year" // Janeiro/26
  | "week_year" // 5ª semana
  | "week_month" // 1ª semana de Janeiro
  // Legados (aceitos pelo RPC / widgets antigos; fora da lista da UI):
  | "day"
  | "week"
  | "month";
export const TRANSFORM_LABELS: Record<Transform, string> = {
  none: "—",
  weekday: "Dia da semana",
  quarter: "Trimestre",
  year: "Ano",
  month_name: "Nome do mês",
  month_year: "Mês/ano",
  week_year: "Semana do ano",
  week_month: "Semana do mês",
  day: "Dia",
  week: "Semana",
  month: "Mês",
};

// Agregação por período no widget de "registros individuais": como uma coluna de
// data expõe as métricas do widget. "individual" mantém 1 linha por registro; as
// demais colapsam em 1 linha por período (Janeiro, Fevereiro…). Mediana/moda são
// calculadas no cliente (o SQL não faz), o que é ok pois o widget tem os registros.
export type DateAgg =
  | "individual"
  | "sum"
  | "count"
  | "avg"
  | "median"
  | "mode";
export const DATE_AGG_LABELS: Record<DateAgg, string> = {
  individual: "Individual (por registro)",
  sum: "Soma",
  count: "Contagem",
  avg: "Média",
  median: "Mediana",
  mode: "Moda",
};

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "ilike"
  | "is_null"
  | "not_null";

export interface Dimension {
  field: string;
  // Nome exibido (estético) desta dimensão no dashboard. Não altera o campo real
  // no banco; ausente = rótulo padrão do campo. Ver lib/widgets/engine.ts.
  label?: string;
  transform?: Transform;
  // Só para transform 'week_month': "restricted" (recorta na virada do mês) ou
  // "full" (semana cheia seg→dom, pega dias do mês vizinho). Default restricted.
  weekMode?: "full" | "restricted";
}
export interface Metric {
  field: string;
  agg: Aggregation;
  // Nome exibido (estético) desta métrica; ausente = "<Agg> · <campo>".
  label?: string;
  // Moeda (12/07/2026): só relevante p/ métrica monetária (value/mrr/campo moeda).
  // A taxa a usar (ano/trimestre do registro ou do período do dashboard):
  conversionBasis?: ConversionBasis;
  // Exibição quando o recorte tem UMA moeda estrangeira:
  currencyDisplay?: CurrencyDisplay;
  // Exibição quando o recorte (grupo/KPI/total) tem VÁRIAS moedas:
  currencyMultiMode?: CurrencyMultiMode;
  // Como o "Total geral" aparece (convertido em R$ ou total em US$ separado):
  grandTotalMode?: GrandTotalMode;
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
  // Moeda do KPI monetário (mesma semântica dos campos de Metric acima).
  conversionBasis?: ConversionBasis;
  currencyDisplay?: CurrencyDisplay;
  currencyMultiMode?: CurrencyMultiMode;
  grandTotalMode?: GrandTotalMode;
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

// Config do widget de "Filtro por campo" (visual_type 'filtro_campo'): filtra
// widgets-alvo por campo/valor e/ou busca textual. Diferente do filtro de
// período, o alvo padrão são TODOS os widgets de dados cujas fontes se
// sobrepõem às deste filtro; `excludedTargets` guarda os desmarcados na edição.
export interface FieldFilterEntry {
  field: string; // campo exposto para filtrar ('stage' | 'custom:xxx' | ...)
  op?: FilterOp; // operador (default 'eq'); 'ilike' faz busca parcial
  label?: string; // rótulo opcional (fallback = rótulo do campo)
}
export interface FieldFilterSettings {
  fields?: FieldFilterEntry[]; // campos que o widget expõe como controles
  searchFields?: string[]; // colunas de texto da busca livre (default ['title'])
  excludedTargets?: string[]; // ids de widgets desmarcados (padrão = todos p/ fonte)
}

// Opções de dropdown dos controles do "Filtro por campo", por campo. O servidor
// resolve responsáveis/operações ativos (value = id) e as etapas da(s) fonte(s)
// (value = texto) e entrega ao controle, que troca o <Input> livre por um select.
export type FieldFilterOptions = Record<
  string,
  { value: string; label: string }[]
>;

// Config do widget de Tabela no modo "registros individuais" (Fase 1): a tabela
// lista 1 linha por registro (sem agregação) e colunas marcadas como editáveis
// gravam de volta no registro (via updateRecordField, respeitando permissões).
export interface RecordListColumn {
  field: string; // 'title' | 'stage' | 'custom:<key>' | ...
  // Nome exibido (estético) do cabeçalho desta coluna; ausente = rótulo do campo.
  label?: string;
  // Edição inline no dashboard (dono/admin decide por coluna). Ausente = padrão
  // legado (custom não calculado editável). Vale p/ custom E colunas do núcleo.
  editable?: boolean;
  // Ao editar esta coluna, também enfileira write-back p/ o Bitrix (campos com
  // origem Bitrix: custom com source_field_id ou coluna do núcleo mapeada).
  writeBack?: boolean;
  // Só p/ colunas de data: formato de exibição (nome do mês, ano, dia da semana…).
  transform?: Transform;
  weekMode?: "full" | "restricted"; // só p/ transform 'week_month'
  // Só p/ colunas de data: agrega o widget por período (ver DateAgg). Default
  // 'individual' (1 linha por registro). As demais colapsam por período.
  agg?: DateAgg;
}
// Fonte das linhas do modo lista: registros (default), responsáveis ou operações.
// Campos personalizados não calculados editáveis gravam de volta na entidade
// listada (registro → records.custom_fields; responsável/operação →
// entity_custom_values).
export type RowSource = "records" | "responsibles" | "operations";
export interface RecordListSettings {
  rowMode?: "records"; // presença => modo lista no widget 'tabela'
  rowSource?: RowSource; // fonte das linhas (default 'records')
  columns?: RecordListColumn[]; // colunas ordenadas a exibir
  limit?: number; // teto de linhas explícito (sem isto = sem limite)
  // Barra de busca/filtro embutida na tabela (registros e agregada), aplicada
  // pelo servidor. Ausente/true = visível; false = oculta ("ocultável na config").
  showFilterBar?: boolean;
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
// Ordenação: crescente/decrescente (auto por tipo: texto=alfabético,
// número/data=numérico/cronológico) ou por cor (ordem definida em colorOrder).
export type TableSortDir = "asc" | "desc" | "color";

// Par de cores de um alvo (coluna/linha/célula/categoria): texto e preenchimento.
export interface ColorPair {
  text?: string;
  fill?: string;
}

export interface AppearanceSettings {
  // --- gráficos (barra / barra_horizontal / linha) ---
  chartBackground?: string; // fundo do gráfico
  gridLines?: GridLines; // linhas de grade
  fillMode?: "solid" | "gradient"; // sólido ou gradiente sutil entre colunas
  seriesColors?: Record<string, string>; // metricKey -> cor (toda a série)
  // Cor por categoria (barra, série única), chaveada pelo NOME da categoria
  // (sobrevive à reordenação): fill = barra, text = rótulo de dados.
  categoryColors?: Record<string, ColorPair>;
  categoryOrder?: string[]; // ordem manual das categorias (eixo X)
  categorySort?: { dir: TableSortDir; colorOrder?: string[] };
  seriesAxis?: Record<string, AxisSide>; // metricKey -> eixo esq/dir (combo)
  dataLabels?: { show?: boolean; position?: "inside" | "top"; color?: string };
  legend?: { show?: boolean; color?: string }; // legenda do gráfico (séries)
  // --- pizza ---
  palette?: string; // chave de paleta nomeada (PALETTES)
  sliceColors?: Record<number, string>; // fatia -> cor (sobrepõe a paleta)
  // --- tabela ---
  table?: {
    gridLines?: GridLines;
    // Comportamento do texto que excede a largura/altura da célula (redimensionada):
    // "clip" (padrão) = corta com reticências em 1 linha; "wrap" = quebra em várias linhas.
    cellText?: "clip" | "wrap";
    headerBg?: string;
    headerColor?: string;
    bodyBg?: string;
    bodyColor?: string;
    borderColor?: string;
    colColors?: Record<string, ColorPair>; // colKey -> {texto, preenchimento}
    rowColors?: Record<string, ColorPair>; // rowKey -> {texto, preenchimento}
    cellColors?: Record<string, ColorPair>; // "rowKey:colKey" -> {texto, preench.}
    columnOrder?: string[]; // ordem das colunas (reordenação)
    rowOrder?: string[]; // ordem manual das linhas (por rowKey)
    // Formato de data por coluna (override do padrão global do dashboard).
    // Chave = colKey (c.field no record-list; dim_<n> na tabela agregada).
    dateFormats?: Record<string, DateFormat>;
    // Redimensionamento in-loco (edição de layout): largura por coluna (px) e
    // altura por linha (px). Chaves = colKey / rowKey.
    colWidths?: Record<string, number>;
    rowHeights?: Record<string, number>;
    sort?: { column: string; dir: TableSortDir; colorOrder?: string[] };
    // Orientação da tabela agregada: "rows" (default) = dimensões/métricas como
    // colunas no topo, 1 linha por grupo; "columns" = transposta (rótulos descem
    // pela esquerda e cada grupo vira uma coluna).
    orientation?: "rows" | "columns";
    // Agrupamento estilo Excel: `key` de uma dimensão pela qual as linhas são
    // agrupadas em seções recolhíveis com subtotais (só na orientação "rows").
    groupBy?: string;
  };
  // --- kpi ---
  kpi?: { bg?: string; border?: string; accent?: string }; // accent = abinha superior
  // --- título / borda do card (todos os tipos estilizáveis) ---
  title?: {
    color?: string; // cor do texto do título
    bg?: string; // fundo da barra de título
    border?: string; // cor da borda/contorno externo do card
  };
}

// settings de um widget é jsonb frouxo: KPI (meta/razão), filtro, o modo lista
// de tabela, a matriz editável, a métrica calculada e a aparência (Fase 10)
// convivem no mesmo objeto.
export type WidgetSettings = KpiSettings &
  FilterSettings &
  FieldFilterSettings &
  RecordListSettings &
  CalcSettings & {
    appearance?: AppearanceSettings;
    // Id da aba (DashboardSettings.tabs) a que este widget pertence. Ausente = aba
    // padrão (a primeira). Ver components/dashboards/dashboard-client.tsx.
    tab?: string;
  };

// Config por dashboard, guardada em dashboards.settings.
export interface DashboardSettings {
  periodBar?: {
    enabled?: boolean; // default true (barra global visível)
    defaultPreset?: string; // preset inicial da barra global
    field?: string; // campo de data padrão da barra global
  };
  // Formato padrão das datas exibidas nas tabelas deste dashboard (pode ser
  // sobrescrito por coluna em AppearanceSettings.table.dateFormats).
  dateFormat?: DateFormat;
  // Fundo da área do dashboard (Fase 10): sólido ou gradiente sutil.
  background?: {
    mode: "solid" | "gradient";
    color?: string; // modo sólido
    from?: string; // modo gradiente
    to?: string;
    angle?: number; // graus (default 135)
  };
  // Área de trabalho (grid): tamanho da área em unidades do grid (colunas/linhas)
  // e altura da linha. A alça de canto (modo edição) aumenta cols/rows; o canvas
  // ganha rolagem quando passa da tela, mantendo o tamanho de célula das 12
  // colunas. Ausente = padrão (12 colunas, linha 30px, altura pelo conteúdo).
  // `width`/`height` (px) são legados de uma versão anterior e ignorados.
  canvas?: {
    cols?: number;
    rows?: number;
    rowHeight?: number;
    width?: number;
    height?: number;
  };
  // Abas do dashboard: cada aba tem nome e cor de fundo do "chip" do nome. Os
  // widgets são associados por `WidgetSettings.tab` (id). Ausente/vazio = uma tela
  // única (todos os widgets numa aba padrão implícita).
  tabs?: { id: string; name: string; color?: string }[];
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
