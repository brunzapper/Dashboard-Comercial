// Versão: 1.6 | Data: 16/07/2026
// v1.6 (16/07/2026): kanban — DashboardSettings.kanban (kanban dedicado, kind
//   'kanban' na 0062) e WidgetSettings.kanban (widget kanban). Config em
//   lib/kanban/types.ts (compartilhada página ↔ widget).
// v1.5 (15/07/2026): widget "Tabela Livre" (visual_type 'tabela_editavel',
//   reaproveitado da Fase 2) — QuickTableSettings: colunas tipadas (livre/
//   dimensão/métrica), linhas livres e bloqueio de edição por papel. A
//   estrutura vive em widgets.settings.quickTable; os VALORES das células em
//   dashboard_table_cells (ver lib/widgets/quick-table/model.ts).
// v1.4 (15/07/2026): novos widgets 'calculadora', 'nota' e 'forma' —
//   CalculatorSettings/NoteSettings/ShapeSettings, WidgetLinkTarget (atalho
//   para widget em qualquer aba/dashboard), Connector (linhas entre widgets,
//   em DashboardSettings.connectors) e grupos calculator/note/shape em
//   AppearanceSettings.
// v1.3 (15/07/2026): WidgetFilter ganha `sources` (fontes-alvo do filtro,
//   pass-through — persistido) e `record_types` (formato de fio; ver
//   lib/widgets/filter-sources.ts).
// v1.2 (15/07/2026): exibição percentual — Metric.percent (sufixo "%") e
//   Metric.resultPercent (calc ad-hoc ×100), KpiSettings.percent (razão) e o
//   carimbo percent em WidgetData.metrics (engine).
// v1.1 (09/07/2026): Fase 8 — WidgetConfig/Widget ganham `sources` (fontes
//   usadas; vazio = todas) e `splitBySource` (quebrar por fonte).
// Tipos do construtor de dashboards (Fase 6A).
import type { SourceKey } from "@/lib/sources";
import type { RoleKey } from "@/lib/auth/roles";
import type { Formula } from "@/lib/records/formulas";
import type { KanbanSettings } from "@/lib/kanban/types";
import type { AgendaSettings } from "@/lib/agenda/types";
import type { DateFormat } from "./format";
import type {
  ConversionBasis,
  CurrencyDisplay,
  CurrencyMultiMode,
  GrandTotalMode,
  MoneyBreakdown,
} from "./currency";

export type VisualType =
  | "tabela"
  | "tabela_editavel"
  | "barra"
  | "barra_horizontal"
  | "linha"
  | "pizza"
  | "kpi"
  | "funil"
  | "filtro"
  | "filtro_campo"
  | "calculado"
  | "calculadora"
  | "nota"
  | "forma"
  | "kanban"
  | "agenda";

export const VISUAL_TYPE_LABELS: Record<VisualType, string> = {
  kpi: "Card",
  calculado: "Métrica calculada",
  calculadora: "Calculadora",
  nota: "Nota (post-it)",
  forma: "Forma",
  tabela: "Tabela",
  // O valor 'tabela_editavel' no banco é herdado da Fase 2 (o CHECK já o
  // aceita); o produto atual chama o widget de "Tabela Livre".
  tabela_editavel: "Tabela Livre",
  barra: "Barra",
  barra_horizontal: "Barra horizontal",
  linha: "Linha",
  pizza: "Pizza",
  funil: "Funil",
  filtro: "Filtro de período",
  filtro_campo: "Filtro por campo",
  kanban: "Kanban",
  agenda: "Agenda",
};

export type Aggregation = "sum" | "count" | "avg" | "min" | "max";
export const AGG_LABELS: Record<Aggregation, string> = {
  sum: "Soma",
  count: "Contagem",
  avg: "Média",
  min: "Mínimo",
  max: "Máximo",
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
  | "not_null"
  // Operadores NORMALIZADOS (migração 0050) — internos das condições de
  // SOMASE/CONT.SE/MÉDIASE (lib/widgets/calc-metrics.condFilters); fora da UI
  // de filtros. eq_ci/neq_ci: texto com trim+minúsculas+booleanos canonizados
  // e null ≡ ''. *_num: comparação numérica com cast seguro.
  | "eq_ci"
  | "neq_ci"
  | "eq_num"
  | "neq_num"
  | "gt_num"
  | "gte_num"
  | "lt_num"
  | "lte_num";

export interface Dimension {
  field: string;
  // Nome exibido (estético) desta dimensão no dashboard. Não altera o campo real
  // no banco; ausente = rótulo padrão do campo. Ver lib/widgets/engine.ts.
  label?: string;
  transform?: Transform;
  // Só para transform 'week_month': "restricted" (recorta na virada do mês) ou
  // "full" (semana cheia seg→dom, pega dias do mês vizinho). Default restricted.
  weekMode?: "full" | "restricted";
  // "Agrupar período" (só dimensão de data com transform): como a data expõe as
  // métricas do widget agregado. Ausente = comportamento atual (agrega via RPC pela
  // agregação da métrica). Definido → engine agrega por registro (ver DateAgg):
  // 'individual' = 1 ponto/linha por registro; demais colapsam por período.
  dateAgg?: DateAgg;
}
export interface Metric {
  field: string;
  agg: Aggregation;
  // Métrica calculada de AGREGADOS (14/07/2026): fórmula sobre agg:sum|avg|count
  // avaliada por grupo/subtotal (ver lib/widgets/calc-metrics.ts). `calc` marca a
  // métrica (robusto a campo deletado); `field` é 'custom:<key>' (campo
  // 'calculado_agg' reutilizável) ou 'calc:formula' (ad-hoc, com `formula` e
  // `resultCurrency` aqui). `agg` é ignorado nesse caso (persistido 'sum' por
  // compat). A métrica NUNCA vai ao RPC — só seus operandos.
  calc?: boolean;
  formula?: Formula;
  resultCurrency?: string | null; // ad-hoc: moeda fixa (conversão real); null = número
  // Ad-hoc calc (15/07/2026): "Formato do resultado" = Percentual — o resultado
  // exibe ×100 + "%" (0.35 → "35%"). Mutuamente exclusivo com resultCurrency.
  resultPercent?: boolean;
  // Toggle "%" (15/07/2026): SÓ anexa "%" ao número exibido (35 → "35%"), sem
  // multiplicar — p/ números que já vêm em magnitude percentual. Ignorado em
  // métrica monetária e quando o campo já é percentual (×100 vence).
  percent?: boolean;
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
  // Fontes-alvo do filtro (PERSISTIDO em widgets.filters): o filtro só restringe
  // as linhas dessas fontes; as demais fontes do widget passam sem restrição
  // (pass-through). Ausente/vazio = todas as fontes (comportamento clássico).
  sources?: SourceKey[];
  // Formato de FIO (record_type[]) p/ o RPC e o modo lista: produzido por
  // applyFilterSourceTargets na hora da consulta; nunca persistido/editado.
  record_types?: string[];
}

// Extras de KPI (Fase 6B): comparação com meta e razões (TM, valor/conta).
export interface KpiSettings {
  // 'data_atual' = card sintético que mostra o dia de hoje (Brasília), sem RPC.
  mode?: "meta" | "ratio" | "data_atual";
  metric?: string; // modo meta: 'mrr' | 'clientes'
  scope?: "global" | "operation" | "responsible";
  operationId?: string | null;
  responsibleId?: string | null;
  period?: "month" | "year";
  numerator?: Metric; // modo razão
  denominator?: Metric;
  label?: string;
  // Razão (15/07/2026): exibe o valor ×100 + "%" (razão de contagens ≈ 0.35 →
  // "35%"). Ignorado quando o numerador é monetário. Sem UI própria — via
  // settings JSON/preset.
  percent?: boolean;
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
  field?: string; // campo de data PRIMÁRIO (visível/selecionável; default closed_at)
  // Override do campo de data por fonte (secundária/terciária/…): a mesma
  // seleção de calendário filtra cada fonte pela sua coluna de data. Ausente
  // para uma fonte = cai no campo primário (ver DEFAULT_PERIOD_FIELD_BY_SOURCE).
  fieldBySource?: Partial<Record<SourceKey, string>>;
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

// Filtro rápido de um widget (14/07/2026): dropdown exibido no próprio card
// (tabelas, gráficos, KPI e métrica calculada), configurado na seção "Filtros"
// do construtor. Os VALORES selecionados não ficam aqui — persistem em
// dashboard_table_cells (row_key '__qf__'), compartilhados entre usuários e
// reloads (ver lib/widgets/quick-filters.ts).
export interface QuickFilterEntry {
  id: string; // estável (qf_<rand>); chave do valor persistido
  field: string; // 'responsible_id' | 'operation_id' | campo de data
  // Só p/ datas: formato do dropdown. Ausente/'none' = padrão → dropdown de
  // período (presets/personalizado); demais = multi-seleção de buckets
  // (Janeiro…, T1/26…), com as mesmas chaves dos transforms de dimensão.
  transform?: Transform;
  weekMode?: "full" | "restricted"; // só p/ transform 'week_month'
  label?: string; // rótulo exibido no chip; ausente = rótulo do campo
}

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
  // Campo 'calculado_agg' salvo em /campos ('custom:<key>') usado no lugar da
  // fórmula local (14/07/2026). Presente → a fórmula/moeda vêm da definição.
  calcField?: string;
}

// --- Card (evolução do KPI, 17/07/2026) ---
// O card numérico ("value", comportamento original) ganha modos novos, todos
// resolvidos no servidor por lib/widgets/card.ts e exibidos pelo branch kpi do
// WidgetChart. `settings.mode` (meta/razão/data_atual) tem precedência sobre
// `card.mode` (presets antigos continuam intactos).
export type CardMode = "value" | "record" | "topn" | "list" | "formula";
export const CARD_MODE_LABELS: Record<CardMode, string> = {
  value: "Número (agregação)",
  record: "Valor de um registro (maior/menor)",
  topn: "Ranking (Top N)",
  list: "Lista de valores",
  formula: "Fórmula",
};
export interface CardConfig {
  mode?: CardMode; // ausente = "value"
  // record: exibe `showField` do registro com maior/menor `rankField` (número
  // ou data — cobre "cliente de maior valor" e "data mais recente").
  showField?: string;
  rankField?: string;
  rankDir?: "max" | "min"; // default "max"
  // topn/list: campo do rótulo (vira a dimensão da consulta agregada).
  labelField?: string;
  metric?: Metric; // topn: métrica do ranking
  limit?: number; // topn default 5; list default 10
  // formula: mesma engine do widget "calculado" (aceita SE/SOMASE/VARPCT…).
  formula?: Formula;
  // Extras de exibição (opcionais).
  prefix?: string;
  suffix?: string;
  secondaryText?: string;
}
export interface CardSettings {
  card?: CardConfig;
}

// --- Comparação com período anterior (17/07/2026) ---
// Config de DADOS por widget (settings.comparison): o engine roda uma segunda
// consulta com o range de comparação (lib/widgets/comparison.ts) e anexa o
// valor comparado por métrica em WidgetRow.__cmp + o metadado em
// WidgetData.comparison. Sem período ativo ("todo o período") não há base de
// comparação e a variação fica indisponível.
export type ComparisonBase =
  | "previous_period" // período imediatamente anterior de mesma duração
  | "previous_year" // mesmo período do ano anterior
  | "window_avg" // média por bucket de uma janela anterior maior
  | "window_median"; // mediana por bucket de uma janela anterior maior
export type ComparisonWindow = "quarter" | "semester" | "ytd" | "last_12m";
export const COMPARISON_BASE_LABELS: Record<ComparisonBase, string> = {
  previous_period: "Período anterior",
  previous_year: "Mesmo período do ano passado",
  window_avg: "Média de uma janela anterior",
  window_median: "Mediana de uma janela anterior",
};
export const COMPARISON_WINDOW_LABELS: Record<ComparisonWindow, string> = {
  quarter: "Último trimestre",
  semester: "Último semestre",
  ytd: "Ano até agora",
  last_12m: "Últimos 12 meses",
};

export interface ComparisonSettings {
  enabled?: boolean;
  base?: ComparisonBase; // default previous_period
  window?: ComparisonWindow; // só nas bases window_* (default last_12m)
  // Exibição (consumida pelos renderizadores; ver VariationBadge):
  showBaseValue?: boolean; // exibe o valor do período de comparação junto
  onlyVariation?: boolean; // Card: o número principal É a variação
  format?: "pct" | "abs" | "both"; // default "pct"
  style?: "color" | "arrow" | "both"; // default "both"
  invertColors?: boolean; // queda = verde (métricas tipo churn)
  tablePlacement?: "inline" | "column"; // tabela agregada; default "inline"
  ghostSeries?: boolean; // gráficos: série do período de comparação
  chartLabels?: boolean; // gráficos: rótulo de variação nos pontos/barras
}
export interface ComparisonWidgetSettings {
  comparison?: ComparisonSettings;
}

// Endereço de um widget-alvo de atalho (formas e links de nota). dashboardId
// ausente = mesmo dashboard; tab é informativa (a navegação resolve a aba
// efetiva pelo settings.tab ATUAL do alvo — sobrevive a mover o widget de aba).
export interface WidgetLinkTarget {
  widgetId: string;
  tab?: string;
  dashboardId?: string;
}

// --- Calculadora ---
// Variável nomeada exposta na calculadora: fórmula sobre o catálogo agregado
// (agg:*, SOMASE, …), computada no servidor com filtros+período do widget. O
// id é estável (cv_…) — a expressão digitada referencia `var:<id>`, então
// renomear a variável não quebra expressões salvas.
export interface CalculatorVariable {
  id: string;
  name: string; // rótulo exibido/inserido como [Nome]
  formula?: Formula;
}
export interface CalculatorSettings {
  calculator?: { variables?: CalculatorVariable[] };
}

// --- Nota (post-it) ---
// text = fonte editável ({=expressão} e [rótulo](@destino)); exprs = tokens de
// cada {=…} NA ORDEM em que aparecem, gravados no salvamento pelo editor da
// nota (refs estáveis sobrevivem a renomear campos, como no widget calculado).
export interface NoteSettings {
  note?: { text?: string; exprs?: Formula[] };
}

// --- Tabela Livre (planilha editável, visual_type 'tabela_editavel') ---
// A ESTRUTURA (colunas/linhas/bloqueios) vive em widgets.settings.quickTable
// (editável por dono/admin, via RLS widgets_write); os VALORES das células
// vivem em dashboard_table_cells (row_key/col_key = ids abaixo), graváveis por
// qualquer visualizador do dashboard — exceto colunas restritas por papel,
// validadas na server action (saveQuickTableCells).
export type QuickTableColKind = "free" | "dimension" | "metric";
export interface QuickTableColumn {
  id: string; // estável ("qc_…") — é o col_key das células e da aparência
  kind: QuickTableColKind;
  // Texto do cabeçalho (coluna livre) ou override do rótulo (dimensão/métrica).
  header?: string;
  field?: string; // kind="dimension": ref de AvailableField ('stage', 'custom:…')
  // Só p/ dimensão de DATA: formato/bucket (Nome do mês, Trimestre…), mesmo
  // vocabulário das dimensões do builder.
  transform?: Transform;
  weekMode?: "full" | "restricted"; // só p/ transform 'week_month'
  metric?: Metric; // kind="metric": mesmo shape das métricas do builder
  // Só p/ dimensão: os valores distintos EXPANDEM COLUNAS (pivot clássico de
  // BI) em vez de linhas. No máximo uma coluna pivot por tabela.
  pivot?: boolean;
  // Só p/ coluna livre: papéis que podem digitar nela. Ausente = todos os
  // visualizadores; [] = ninguém (admin sempre pode). Validado na UI E na
  // server action (a RLS da tabela de células não distingue coluna).
  editableRoles?: RoleKey[];
}
// Linha LIVRE (estática) da tabela. No modo BI as linhas de DADOS são
// derivadas dos valores da dimensão (row_key "d:…") e não ficam aqui.
export interface QuickTableRow {
  id: string; // estável ("qr_…") — é o row_key das células e da aparência
}
export interface QuickTableSettings {
  quickTable?: {
    columns: QuickTableColumn[];
    rows: QuickTableRow[];
    headerRow?: boolean; // exibe a linha de cabeçalho (default true)
  };
}

// --- Forma (figura geométrica) ---
export type ShapeKind =
  | "retangulo"
  | "retangulo_arredondado"
  | "elipse"
  | "losango"
  | "triangulo"
  | "seta"
  | "hexagono";
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  retangulo: "Retângulo",
  retangulo_arredondado: "Retângulo arredondado",
  elipse: "Elipse",
  losango: "Losango",
  triangulo: "Triângulo",
  seta: "Seta",
  hexagono: "Hexágono",
};
export interface ShapeSettings {
  shape?: { kind?: ShapeKind; text?: string; link?: WidgetLinkTarget };
}

// --- Conectores (linhas entre widgets, estilo n8n/Make) ---
// Persistidos em DashboardSettings.connectors (ganham undo/redo pelos
// snapshots). Desenhados por uma camada SVG sobre o grid; as pontas seguem o
// grid_position ao vivo durante drag/resize. side "auto" = escolhido pela
// posição relativa dos widgets.
export type ConnectorSide = "auto" | "top" | "right" | "bottom" | "left";
export interface ConnectorEndpoint {
  widgetId: string;
  side?: ConnectorSide;
}
export interface Connector {
  id: string; // cn_…
  tab?: string; // aba dona (ausente = primeira aba / tela única)
  from: ConnectorEndpoint;
  to: ConnectorEndpoint;
  shape?: "reta" | "curva"; // default "curva"
  color?: string;
  width?: number; // px (default 2)
  dash?: boolean;
  arrowEnd?: boolean; // default true
  label?: string;
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

// Alinhamento horizontal do texto de células/cabeçalhos de tabela (13/07/2026).
export type TableAlign = "left" | "center" | "right";

// --- Formatação condicional (17/07/2026) ---
// Regras valor→estilo e escalas de cor contínuas (heatmap), avaliadas nos
// renderizadores por lib/widgets/conditional.ts. Alvos (`target`):
//  - tabela agregada: colKey (`metric_1`, `dim_1`, `metric_1__var`);
//  - listas de registros/entidades: o field da coluna;
//  - Card/calculado: a chave especial "value";
//  - gráficos (barra série única / pizza): a chave da métrica plotada.
// Precedência com as cores manuais: ver conditional.ts.
export type CondOp =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "neq"
  | "between"
  | "contains"
  | "empty"
  | "not_empty"
  | "var_up" // variação vs. período de comparação positiva
  | "var_down"; // variação negativa
export const COND_OP_LABELS: Record<CondOp, string> = {
  gt: "maior que",
  gte: "maior ou igual a",
  lt: "menor que",
  lte: "menor ou igual a",
  eq: "igual a",
  neq: "diferente de",
  between: "entre",
  contains: "contém",
  empty: "vazio",
  not_empty: "não vazio",
  var_up: "variação positiva",
  var_down: "variação negativa",
};
export interface ConditionalRule {
  id: string; // cr_<rand>, estável
  target: string;
  op: CondOp;
  value?: number | string;
  value2?: number | string; // "entre": limite superior
  style: {
    text?: string;
    fill?: string;
    bold?: boolean;
    icon?: "up" | "down" | "dot" | "warn";
  };
}
export interface ColorScale {
  id: string; // cs_<rand>
  target: string; // coluna numérica
  min: string; // cor do menor valor
  mid?: string; // cor do ponto médio (opcional, escala de 3 pontos)
  max: string; // cor do maior valor
}
export interface ConditionalFormatting {
  rules?: ConditionalRule[];
  scales?: ColorScale[];
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
    // Borda por célula (16/07/2026): "rowKey:colKey" -> cor. Desenhada como
    // contorno interno (overlay), por cima das linhas de grade globais.
    cellBorders?: Record<string, string>;
    // colKey -> {texto, preench.} aplicado SÓ às linhas de grupo (subtotais e
    // "Total geral") no "Agrupar por"; não afeta as linhas de dados.
    groupColColors?: Record<string, ColorPair>;
    columnOrder?: string[]; // ordem das colunas (reordenação)
    rowOrder?: string[]; // ordem manual das linhas (por rowKey)
    // Formato de data por coluna (override do padrão global do dashboard).
    // Chave = colKey (c.field no record-list; dim_<n> na tabela agregada).
    dateFormats?: Record<string, DateFormat>;
    // Redimensionamento in-loco (edição de layout): largura por coluna (px) e
    // altura por linha (px). Chaves = colKey / rowKey.
    colWidths?: Record<string, number>;
    rowHeights?: Record<string, number>;
    // Alinhamento (13/07/2026): global (todas as colunas) + overrides por
    // coluna/linha/célula. Precedência: célula > linha > coluna > global >
    // default do tipo (numérico à direita, texto à esquerda). Ver resolveAlign.
    align?: TableAlign;
    colAlign?: Record<string, TableAlign>; // colKey -> alinhamento
    rowAlign?: Record<string, TableAlign>; // rowKey -> alinhamento
    cellAlign?: Record<string, TableAlign>; // "rowKey:colKey" -> alinhamento
    sort?: { column: string; dir: TableSortDir; colorOrder?: string[] };
    // Orientação da tabela agregada: "rows" (default) = dimensões/métricas como
    // colunas no topo, 1 linha por grupo; "columns" = transposta (rótulos descem
    // pela esquerda e cada grupo vira uma coluna).
    orientation?: "rows" | "columns";
    // Agrupamento estilo Excel: uma ou mais `keys` de dimensões/colunas pelas
    // quais as linhas são agrupadas em seções recolhíveis com subtotais (na
    // transposta os níveis agrupam o eixo esquerdo). Lista ordenada = hierarquia
    // (1º = grupo principal, demais aninhados). String = config antiga de 1
    // nível (ainda válida; ver groupByLevels em lib/widgets/appearance.ts).
    groupBy?: string | string[];
    // Transposta: qual dimensão vira as colunas do topo. Mesma convenção de
    // chaves do groupBy (agregada `dim_<n>`; registros `<field>`). Ausente ou
    // órfã (dimensões mudaram) = 1ª dimensão, comportamento original.
    colDim?: string;
  };
  // --- kpi ---
  kpi?: { bg?: string; border?: string; accent?: string }; // accent = abinha superior
  // --- calculadora ---
  calculator?: {
    bg?: string; // fundo do card
    displayBg?: string; // fundo do visor
    displayText?: string; // texto do visor
    keyBg?: string; // fundo das teclas numéricas
    keyText?: string;
    opKeyBg?: string; // fundo das teclas de operação
    opKeyText?: string;
  };
  // --- nota (post-it) ---
  note?: {
    bg?: string; // fundo do papel (default amarelo post-it #fef9c3)
    color?: string; // cor do texto
    linkColor?: string; // cor dos hyperlinks
    fontSize?: number; // px (default 14)
    frameless?: boolean; // sem cromo do card (só o papel)
  };
  // --- forma ---
  shape?: {
    fill?: string; // preenchimento
    stroke?: string; // contorno
    strokeWidth?: number; // px (default 2)
    textColor?: string;
    fontSize?: number; // px
  };
  // --- título / borda do card (todos os tipos estilizáveis) ---
  title?: {
    color?: string; // cor do texto do título
    bg?: string; // fundo da barra de título
    border?: string; // cor da borda/contorno externo do card
  };
  // --- formatação condicional (tabelas, listas, Card, gráficos) ---
  conditional?: ConditionalFormatting;
}

// settings de um widget é jsonb frouxo: KPI (meta/razão), filtro, o modo lista
// de tabela, a matriz editável, a métrica calculada e a aparência (Fase 10)
// convivem no mesmo objeto.
export type WidgetSettings = KpiSettings &
  FilterSettings &
  FieldFilterSettings &
  RecordListSettings &
  CalcSettings &
  CalculatorSettings &
  NoteSettings &
  ShapeSettings &
  QuickTableSettings &
  CardSettings &
  ComparisonWidgetSettings & {
    // Config do widget kanban (visual_type 'kanban', 0064).
    kanban?: KanbanSettings;
    // Config do widget agenda (visual_type 'agenda', 0064).
    agenda?: AgendaSettings;
    appearance?: AppearanceSettings;
    // Filtros rápidos expostos no card (dropdowns). Valores persistidos em
    // dashboard_table_cells ('__qf__'), compartilhados entre usuários.
    quickFilters?: QuickFilterEntry[];
    // Id da aba (DashboardSettings.tabs) a que este widget pertence. Ausente = aba
    // padrão (a primeira). Ver components/dashboards/dashboard-client.tsx.
    tab?: string;
    // Dimensões dinâmicas: o widget cresce p/ caber o conteúdo, sem encolher
    // abaixo do tamanho configurado (mínimo). Independente por eixo. Ausente =
    // desligado. O tamanho inflado é só de renderização, nunca é persistido
    // (o grid_position gravado segue sendo o mínimo). Ver dashboard-grid.tsx.
    autoSize?: { width?: boolean; height?: boolean };
  };

// Config por dashboard, guardada em dashboards.settings. Kanbans dedicados
// (dashboards.kind 'kanban', 0062) usam a MESMA coluna com a chave disjunta
// `kanban` (lib/kanban/types.ts) — as demais chaves não se aplicam a eles.
export interface DashboardSettings {
  // Config do kanban dedicado (kind 'kanban'). Ausente em dashboards comuns.
  kanban?: KanbanSettings;
  periodBar?: {
    enabled?: boolean; // default true (barra global visível)
    defaultPreset?: string; // preset inicial da barra global
    field?: string; // campo de data PRIMÁRIO (visível/selecionável na barra)
    // Override do campo de data por fonte (secundária/terciária/…): a mesma
    // seleção de calendário filtra cada fonte pela sua coluna de data (ex.:
    // negócios por `closed_at`/assinatura e Estudo por `source_created_at`).
    // Ausente para uma fonte = cai no campo primário (ver
    // DEFAULT_PERIOD_FIELD_BY_SOURCE em lib/sources.ts).
    fieldBySource?: Partial<Record<SourceKey, string>>;
    // Escopo do filtro de período: "global" (default) = um período para todo o
    // dashboard; "tab" = cada aba tem sua própria seleção (parâmetros de URL
    // namespados por id da aba). Ver components/dashboards/period-filter.tsx.
    scope?: "global" | "tab";
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
  // Conectores entre widgets (linhas retas/curvas estilo n8n). Ver Connector.
  connectors?: Connector[];
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

// Resultado do widget "Métrica calculada" (RSC → client): valor + moeda do
// resultado quando aponta p/ um campo 'calculado_agg' com moeda — automática
// (preservada dos operandos; misturou → BRL) ou fixa (null = número puro).
export interface CalcWidgetResult {
  value: number | null;
  currency?: string | null;
  // Resultado textual (SE(...) que devolve string/booleano) — usado pela Nota
  // (v1.4). Presente só quando value é null e a fórmula produziu texto.
  text?: string;
}

export interface KpiResult {
  mode: "meta" | "ratio" | "data_atual";
  label: string;
  realizado?: number;
  meta?: number | null;
  pct?: number | null;
  falta?: number | null;
  value?: number | null;
  // Textos já formatados quando o KPI é monetário (honram a config de moeda do
  // KPI). Ausentes = número puro (fmt) no cliente. Meta/falta são sempre R$.
  realizadoText?: string;
  metaText?: string;
  faltaText?: string;
  valueText?: string;
  // Valor do período de comparação (modo ratio; settings.comparison ativa).
  // Meta não compara — a meta já é a referência do card.
  cmpValue?: number | null;
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

// Uma linha de WidgetData: chaves dim_1.., metric_1.. + um mapa opcional de
// detalhamento monetário por métrica (`__money`), anexado pelo engine para as
// métricas monetárias. `metric_<n>` continua NUMÉRICO (valor a plotar); a moeda /
// modos de exibição saem de `__money[metricKey]`. JSON puro (server→client).
export interface WidgetRow {
  [key: string]: unknown;
  __money?: Record<string, MoneyBreakdown>;
  // Valor do período de comparação por métrica (`metric_<n>` → número a
  // comparar, na MESMA escala do valor plotado da métrica; monetárias usam a
  // decisão de moeda da série principal). null = grupo sem valor comparável.
  // Ausente = comparação desligada/indisponível. Ver lib/widgets/comparison.ts.
  __cmp?: Record<string, number | null>;
  // Basis das métricas calculadas de agregados desta linha (grupo): chave
  // 'sum:<field>'|'count:<field>'|'count:*' → valor (número, ou MoneyBreakdown
  // p/ operando monetário). Subtotais/Total geral fundem as basis das linhas e
  // reavaliam a fórmula (lib/widgets/calc-metrics).
  __calcOps?: Record<string, number | null | MoneyBreakdown>;
}

/** Resultado já pronto para os charts. */
export interface WidgetData {
  rows: WidgetRow[]; // chaves dim_1.., metric_1..
  dimensions: { key: string; label: string }[];
  // `isMoney` marca as métricas monetárias (têm `__money` nas linhas). `calc`
  // marca as métricas calculadas de agregados: a fórmula reavalia célula/
  // subtotal a partir de `__calcOps` (evalCalcMoney). `mode`/`fixedRate` regem a
  // moeda ('auto' preserva a dos operandos; 'fixed' converte p/ `currency`);
  // `currency` é a moeda fixa (null = automática/número).
  metrics: {
    key: string;
    label: string;
    isMoney?: boolean;
    // Exibição percentual (15/07/2026): carimbo do engine — a métrica exibe
    // ×100 + "%" (campo percentual agregado por sum/avg, ou calc percentual).
    // Contagens nunca recebem o carimbo. Poupa o chart de precisar de fieldDefs.
    percent?: boolean;
    calc?: {
      formula: Formula;
      currency?: string | null;
      allowNegative?: boolean;
      mode?: "none" | "auto" | "fixed";
      fixedRate?: number | null;
    };
  }[];
  kpi?: KpiResult; // preenchido só quando o KPI tem settings (meta/razão)
  // Modos novos do Card (lib/widgets/card.ts): "record"/"formula" trazem o
  // texto pronto; "topn"/"list" usam as próprias rows (rótulo + métrica) já
  // ordenadas/cortadas no servidor.
  card?: { mode: CardMode; valueText?: string; subText?: string };
  // Comparação com período anterior ATIVA neste resultado: range consultado +
  // rótulo pronto ("vs. período anterior") + a config de exibição. Ausente =
  // sem comparação (desligada, "todo o período" ou base indisponível) — os
  // renderizadores ocultam a variação.
  comparison?: {
    base: ComparisonBase;
    from: string;
    to: string;
    label: string;
    settings: ComparisonSettings;
  };
  // Erro ao computar o widget (RPC/consulta): rows/dimensions/metrics vêm
  // vazios e o card exibe o estado de erro em vez de ficar em branco.
  error?: string;
}
