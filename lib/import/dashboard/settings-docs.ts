// Versão: 1.1 | Data: 25/07/2026
// v1.1 (25/07/2026): merge da 0100 — entradas p/ as chaves novas de
//   AppearanceSettings (barFillPct, chartInset, filter) e comentário de
//   dataLabels com a semântica da barra horizontal (portados do SPEC v1.4,
//   que os documentava à mão antes da derivação).
// Documentação DERIVADA dos settings para o prompt de importação por IA
// (instructions.ts). Cada dicionário é EXAUSTIVO por construção
// (`satisfies Record<keyof T, string | null>`): chave NOVA no tipo sem entrada
// aqui QUEBRA o typecheck — na mesma entrega, documente-a (valor = linha(s) do
// bloco pseudo-JSON do SPEC, sem indentação à esquerda; o render indenta) ou
// marque-a `null` (sem linha própria: interna, fora do escopo da IA, ou
// coberta na linha de OUTRA chave — diga qual no comentário). O validador
// trata settings como passthrough, então este arquivo é a única ponte entre os
// tipos reais e o que a IA sabe gerar. Guarda textual:
// lib/import/dashboard/instructions.test.ts.
import type {
  AppearanceSettings,
  DashboardSettings,
  WidgetSettings,
} from "@/lib/widgets/types";
import {
  CARD_MODE_LABELS,
  COMPARISON_BASE_LABELS,
  COMPARISON_WINDOW_LABELS,
  COND_OP_LABELS,
  IMAGE_FIT_LABELS,
  PERIOD_WINDOW_LABELS,
  SHAPE_KIND_LABELS,
} from "@/lib/widgets/types";
import type { FormulaFuncName } from "@/lib/records/formulas";
import { PERIOD_ALL, PERIOD_PRESETS } from "@/lib/widgets/period";

// ---------- Helpers de render ----------

/** "a | b | c" a partir das chaves de um Record de labels. */
export function enumKeys(labels: Record<string, unknown>): string {
  return Object.keys(labels).join(" | ");
}

/** "a (Rótulo A), b (Rótulo B)" a partir de um Record chave→rótulo. */
export function enumKeysLabeled(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, l]) => `${k} (${l})`)
    .join(", ");
}

/** Chaves com linha própria no SPEC (valor não-null), na ordem do dicionário. */
export function documentedKeys(doc: Record<string, string | null>): string[] {
  return Object.entries(doc)
    .filter(([, v]) => v != null)
    .map(([k]) => k);
}

/** Junta os valores não-null do dicionário, indentando cada linha. */
export function renderDocBlock(
  doc: Record<string, string | null>,
  indent = "  "
): string {
  return Object.values(doc)
    .filter((v): v is string => v != null)
    .map((v) =>
      v
        .split("\n")
        .map((line) => (line.length > 0 ? indent + line : line))
        .join("\n")
    )
    .join("\n");
}

// ---------- Funções de fórmula por grupo ----------
// Fonte da verdade dos NOMES é o union FormulaFuncName (lib/records/formulas.ts);
// os grupos daqui alimentam as listas do SPEC. Função nova no union sem entrada
// aqui = erro de typecheck.

export type FormulaFuncGroup = "logica" | "cond_agg" | "pura" | "comparacao";
export const FORMULA_FUNC_GROUPS = {
  SE: "logica",
  E: "logica",
  OU: "logica",
  SOMASE: "cond_agg",
  SOMASES: "cond_agg",
  "CONT.SE": "cond_agg",
  "CONT.SES": "cond_agg",
  MÉDIASE: "cond_agg",
  SOMA: "pura",
  MÉDIA: "pura",
  MÍN: "pura",
  MÁX: "pura",
  "CONT.NÚM": "pura",
  "CONT.VALORES": "pura",
  ARRED: "pura",
  ABS: "pura",
  CONCATENAR: "pura",
  ANTERIOR: "comparacao",
  VARPCT: "comparacao",
  VARABS: "comparacao",
} satisfies Record<FormulaFuncName, FormulaFuncGroup>;

export function formulaFuncsIn(group: FormulaFuncGroup): string[] {
  return Object.entries(FORMULA_FUNC_GROUPS)
    .filter(([, g]) => g === group)
    .map(([name]) => name);
}

// ---------- appearance.table ----------
// `null` nas chaves de manipulação DIRETA (resize/pintura por célula/ordem
// manual de linhas): estado de edição in-loco que a IA não deve gerar.

export const APPEARANCE_TABLE_DOC = {
  gridLines: `"gridLines": "both",                   // linhas de grade: none | horizontal | vertical | both`,
  cellText: `"cellText": "wrap",                    // texto que excede a célula: "clip" (corta, default) | "wrap" (quebra linha)`,
  headerBg: `"headerBg": "#f1f5f9", "headerColor": "#0f172a",   // cabeçalho: fundo e texto`,
  headerColor: null, // documentado na linha de headerBg
  bodyBg: `"bodyBg": "#ffffff", "bodyColor": "#1e293b", "borderColor": "#e2e8f0",  // corpo e bordas`,
  bodyColor: null, // documentado na linha de bodyBg
  borderColor: null, // documentado na linha de bodyBg
  colColors: `"colColors": { "metric_1": { "fill": "#eff6ff", "text": "#1d4ed8" } },  // cor POR COLUNA (colKey: dim_<n>/metric_<n> na agregada; field na lista)`,
  rowColors: `"rowColors": { "<rowKey>": { "fill": "#fef2f2" } },        // cor POR LINHA`,
  cellColors: `"cellColors": { "<rowKey>:<colKey>": { "fill": "#fee2e2" } },  // cor POR CÉLULA`,
  groupColColors: `"groupColColors": { "metric_1": { "fill": "#f8fafc" } },  // cor das linhas de GRUPO (subtotais/Total geral)`,
  columnOrder: `"columnOrder": ["dim_1", "metric_2", "metric_1"],  // ordem das colunas`,
  dateFormats: `"dateFormats": { "closed_at": "dd/mm/aa" },  // formato de data POR COLUNA (override do padrão do dashboard)`,
  align: `"align": "center",                     // alinhamento global: left | center | right`,
  colAlign: `"colAlign": { "metric_1": "right" },   // override de alinhamento por coluna (há também "rowAlign"/"cellAlign", mesmas chaves de rowColors/cellColors)`,
  rowAlign: null, // citado na linha de colAlign
  cellAlign: null, // citado na linha de colAlign
  colDecimals: `"colDecimals": { "metric_1": 2 },      // casas decimais por coluna (há também "rowDecimals"/"cellDecimals")`,
  rowDecimals: null, // citado na linha de colDecimals
  cellDecimals: null, // citado na linha de colDecimals
  sort: `"sort": { "column": "metric_1", "dir": "desc" },  // ordenação (dir: "asc" | "desc")`,
  orientation: `"orientation": "columns",              // "rows" (default) | "columns" (transposta: grupos viram colunas)`,
  groupBy: `"groupBy": ["dim_1"],                  // "Agrupar por": níveis com subtotais recolhíveis (dim_<n> na agregada; field na lista)`,
  groupDateFormats: `"groupDateFormats": { "dim_1": "month_year" },  // formato/bucket do CABEÇALHO do grupo (transform "por nome" ou máscara de data)`,
  colDim: `"colDim": "dim_2",                     // transposta: qual dimensão vira as colunas do topo`,
  colWidths: null, // resize manual (px por coluna) — manipulação direta, não gerar
  rowHeights: null, // resize manual (px por linha) — manipulação direta, não gerar
  cellBorders: null, // borda pintada por célula — manipulação direta, não gerar
  rowOrder: null, // ordem manual de linhas (drag) — manipulação direta, não gerar
} satisfies Record<keyof NonNullable<AppearanceSettings["table"]>, string | null>;

// ---------- appearance ----------

export const APPEARANCE_DOC = {
  decimals: `"decimals": 0,                           // casas decimais (tabelas, Card, rótulos, tooltip); overrides por coluna em table.colDecimals etc.`,
  seriesColors: `// gráficos (barra / barra_horizontal / linha):
"seriesColors": { "metric_1": "#2563eb" },   // cor POR MÉTRICA/série (chave = metric_<n>, na ordem das métricas)`,
  categoryColors: `"categoryColors": { "Instagram": { "fill": "#16a34a", "text": "#166534" } },
                                         // cor POR BARRA (série única): chave = NOME exibido da categoria;
                                         // "fill" = cor da barra, "text" = cor do rótulo de dados`,
  colorByCategory: `"colorByCategory": true,                 // série única: cada barra pega uma cor da paleta (categoryColors vence)`,
  palette: `"palette": "design",                     // paleta nomeada (pizza/funil e colorByCategory) — ver "Paletas" abaixo`,
  stacked: `"stacked": true,                         // 2+ métricas no widget "barra": empilha num único stack`,
  chartBackground: `"chartBackground": "#0b1220",            // fundo do gráfico`,
  gridLines: `"gridLines": "horizontal",               // linhas de grade do gráfico: none | horizontal | vertical | both`,
  fillMode: `"fillMode": "solid",                     // "solid" | "gradient"`,
  barFillPct: `"barFillPct": 80,                        // espessura das barras: % do slot da categoria (10-100; omitir = Auto)`,
  chartInset: `"chartInset": 8,                         // margem interna do plot em px (barra/barra_horizontal/linha; omitir = Auto)`,
  seriesAxis: `"seriesAxis": { "metric_2": "right" },    // eixo por métrica (combo de 2 eixos): "left" | "right"`,
  categoryOrder: `"categoryOrder": ["Instagram", "Google"],  // ordem MANUAL das categorias (eixo X / fatias)`,
  categorySort: `"categorySort": { "dir": "desc", "by": "value" },  // ordenação dinâmica: dir "asc"|"desc"; by "label"|"value" (+ "metric": "metric_<n>" opcional)`,
  categoryLimit: `"categoryLimit": { "n": 8, "others": true },  // Top-N de categorias + "Outros"`,
  dataLabels: `"dataLabels": { "show": true, "position": "top", "format": "value",
                "color": "#0f172a", "mode": "detailed" },
                                         // position: barra "top"(=acima)|"inside"; barra_horizontal "top"(=FORA, à direita
                                         //   da barra; rótulo "inside" que não cabe na barra aparece fora sozinho e a área
                                         //   do gráfico reserva o espaço automaticamente); linha "top"|"bottom"; pizza "top"(=fora)|"inside"
                                         // format: "value" | "percent" | "both"
                                         // mode (SÓ barras empilhadas): "detailed" (um rótulo por segmento, default)
                                         //   | "total" (um único rótulo com a SOMA da barra; detalhe fica na tooltip)`,
  legend: `"legend": { "show": true, "color": "#334155" },  // legenda das séries`,
  sliceColors: `// pizza / funil:
"sliceColors": { "0": "#2563eb", "1": "#f59e0b" },  // cor por fatia (índice como string) — sobrepõe a paleta`,
  conditional: `// formatação condicional (tabelas, listas, Card, gráficos):
"conditional": { "rules": [ { "id": "cr_1", "target": "metric_1", "op": "lt", "value": 0.2,
                              "scope": "cell",
                              "style": { "text": "#dc2626", "fill": "#fee2e2", "bold": true } } ],
                 "scales": [ { "id": "cs_1", "target": "metric_1", "min": "#fee2e2", "max": "#dcfce7" } ] }
                                         // rule.op: ${enumKeys(COND_OP_LABELS)}
                                         // rule.scope (tabelas): "cell" (default) | "row" | "col"
                                         // rule.style: { "text", "fill", "bold", "icon": "up"|"down"|"dot"|"warn" }`,
  table: `// tabela (agregada e lista de registros):
"table": {
${renderDocBlock(APPEARANCE_TABLE_DOC, "  ")}
},`,
  kpi: `"kpi": { "bg": "#ffffff", "border": "#e2e8f0", "accent": "#2563eb" },  // Card: fundo, borda e abinha superior`,
  filter: `// widgets de filtro (filtro / filtro_campo):
"filter": { "bg": "#f8fafc", "border": "#e2e8f0", "accent": "#2563eb" },  // fundo/borda do card + abinha superior`,
  title: `"title": { "color": "#0f172a", "bg": "#f8fafc", "border": "#e2e8f0" },  // barra de título / contorno do card (todos os tipos)`,
  note: `"note": { "bg": "#fef9c3", "color": "#1f2937", "fontSize": 14 },  // aparência da nota (post-it); "frameless": true = sem cromo do card`,
  shape: `"shape": { "fill": "#eef2ff", "stroke": "#6366f1", "strokeWidth": 2, "textColor": "#312e81" },  // aparência da forma`,
  calculator: null, // cores da calculadora (visor/teclas) — estética de nicho, edite na UI
  fonts: `"fonts": { "title": 14, "value": 30, "labels": 12, "table": 14, "chart": 11 },  // px por elemento; ausente = auto (× fontScale do dashboard)`,
} satisfies Record<keyof AppearanceSettings, string | null>;

// ---------- widget.settings ----------

export const WIDGET_SETTINGS_DOC = {
  tab: `"tab": "geral",                            // id da aba`,
  quickFilters: `"quickFilters": [                          // dropdowns no card (seleção compartilhada)
  { "id": "qf1", "field": "responsible_id" },
  { "id": "qf2", "field": "operation_id" },
  { "id": "qf3", "field": "closed_at" },                          // dropdown de período
  { "id": "qf4", "field": "closed_at", "transform": "month_name" } // multi-seleção de meses
],`,
  comparison: `"comparison": {                            // variação vs outro período
  "enabled": true,
  "base": "previous_period",               // ${enumKeys(COMPARISON_BASE_LABELS)}
  "window": "last_12m",                    // só window_*: ${enumKeys(COMPARISON_WINDOW_LABELS)}
  "format": "pct",                         // pct | abs | both
  "style": "both",                         // color | arrow | both
  "showBaseValue": false, "invertColors": false,
  "ghostSeries": false, "chartLabels": false,
  "tablePlacement": "inline"               // tabela: inline | column
},`,
  businessDayAlign: `"businessDayAlign": { "enabled": true, "reference": "today" },  // "today"|"period_end"`,
  periodWindow: `"periodWindow": { "options": ["3m","6m","12m"], "default": "6m", "showAlignToggle": true },  // chaves: ${enumKeys(PERIOD_WINDOW_LABELS)}`,
  goalLine: `"goalLine": { "enabled": true, "metric": "mrr", "mode": "pace", "label": "Meta" },  // mode: monthly|pace; só barra/linha`,
  mode: `"mode": "meta",                            // Card especial (kpi): "meta" (compara com a meta cadastrada) | "ratio" (razão numerador/denominador) | "data_atual" (mostra o dia de hoje)`,
  metric: `"metric": "mrr", "scope": "global", "period": "month",          // config do Card de meta`,
  scope: null, // documentado na linha de `metric` (Card de meta)
  period: null, // documentado na linha de `metric` (Card de meta)
  operationId: null, // Card de meta com escopo por operação — exige UUID; prefira quickFilters (regra 6)
  responsibleId: null, // idem, escopo por responsável
  numerator: `"numerator": { "field": "*", "agg": "count" }, "denominator": { "field": "mrr", "agg": "sum" },  // Card ratio: métricas da razão`,
  denominator: null, // documentado na linha de `numerator`
  label: `"label": "Conversão",                      // rótulo do Card de meta/razão`,
  percent: `"percent": true,                           // Card ratio: exibe a razão ×100 + "%"`,
  conversionBasis: null, // config avançada de moeda do KPI — edite na UI
  currencyDisplay: null, // idem
  currencyMultiMode: null, // idem
  grandTotalMode: null, // idem
  kind: null, // FilterSettings.kind: sempre "period" (implícito no visual_type "filtro")
  targets: `"targets": [],                             // widget "filtro": ids dos widgets controlados; vazio = dashboard inteiro`,
  field: `"field": "closed_at",                      // widget "filtro": campo de data primário do controle`,
  fieldBySource: `"fieldBySource": { "<baseKey>": "<campo de data daquela Base>" },  // widget "filtro": campo por Base (mesma semântica do periodBar)`,
  defaultPreset: `"defaultPreset": "este_mes",               // widget "filtro": preset inicial (mesmas chaves do periodBar)`,
  defaultDe: null, // range personalizado inicial (ISO) do widget "filtro" — prefira defaultPreset
  defaultAte: null, // idem
  fields: `"fields": [ { "field": "stage" }, { "field": "custom:fonte" } ],  // widget "filtro_campo": campos expostos como controles`,
  searchFields: `"searchFields": ["title"],                 // widget "filtro_campo": colunas de texto da busca livre`,
  excludedTargets: null, // widgets desmarcados na edição do filtro_campo — estado de UI
  valueScope: null, // escopo do valor do filtro_campo ("all" compartilhado | "user") — o default por usuário serve
  rowMode: `"rowMode": "records",                      // tabela: lista de registros individuais`,
  rowSource: `"rowSource": "records",                    // modo lista: "records" (default) | "responsibles" | "operations"`,
  columns: `"columns": [ { "field": "title" }, { "field": "closed_at", "transform": "month_year" },
            { "field": "custom:fonte", "label": "Origem" } ],   // modo lista: colunas ordenadas`,
  limit: `"limit": 10,                               // modo lista: teto de linhas (ausente = sem limite)`,
  showFilterBar: `"showFilterBar": false,                    // tabela: oculta a barra de busca/filtro embutida`,
  card: `"card": { "mode": "topn", "labelField": "responsible_id",       // Card: ${enumKeys(CARD_MODE_LABELS)}
          "metric": { "field": "mrr", "agg": "sum" }, "limit": 5 },`,
  note: `"note": { "text": "Texto livre da nota." },  // widget "nota": texto do post-it`,
  shape: `"shape": { "kind": "retangulo", "text": "Etapa 1" },  // widget "forma"; kind: ${enumKeys(SHAPE_KIND_LABELS)}`,
  image: `"image": { "url": "https://…", "fit": "contain", "alt": "Logo" },  // widget "imagem" (só https); fit: ${enumKeys(IMAGE_FIT_LABELS)}`,
  coexistSubSources: `"coexistSubSources": ["<key de Sub-base>"],  // Sub-bases a manter como série/perna PRÓPRIA (conviver com a Base-mãe); ausente/vazio = absorvidas (padrão)`,
  subSeriesMode: `"subSeriesMode": "stacked",                // 2+ sub-bases no widget: stacked (empilhado, default) | total (somado, some a coluna Base) | grouped (lado a lado)`,
  autoSize: `"autoSize": { "width": false, "height": false },`,
  formula: null, // métrica calculada da IA usa metrics[].formula_text — nunca tokens aqui
  calcField: null, // campo calculado_agg salvo — via "fields" + metrics[].field
  calculator: null, // variáveis da calculadora usam Formula tokenizada (editor); o widget funciona sem settings
  quickTable: null, // estrutura da Tabela Livre (colunas/linhas editáveis) — montada na UI, fora do escopo da IA
  presetKey: null, // identidade de preset/import — o SERVIDOR carimba; a IA nunca envia
  kanban: null, // config do widget kanban — fora do escopo da IA
  agenda: null, // config do widget agenda — fora do escopo da IA
  appearance: `"appearance": {                            // aparência (tudo opcional; TUDO NO NÍVEL RAIZ — NÃO existe sub-objeto "chart")
${renderDocBlock(APPEARANCE_DOC, "  ")}
}`,
} satisfies Record<keyof WidgetSettings, string | null>;

// ---------- dashboard.settings ----------

export const DASHBOARD_SETTINGS_DOC = {
  tabs: `"tabs": [ { "id": "geral", "name": "Visão geral", "color": "#eef2ff" } ],`,
  periodBar: `"periodBar": {
  "enabled": true,
  "defaultPreset": "este_mes",       // ${[...Object.keys(PERIOD_PRESETS), PERIOD_ALL].join("|")}
  "field": "closed_at",              // campo de data primário
  "fieldBySource": { "<baseKey>": "<campo de data daquela Base>" },
  "scope": "global"                  // "global" | "tab"
},`,
  canvas: `"canvas": { "cols": 12, "rowHeight": 30 },`,
  dateFormat: `"dateFormat": "dd/mm/aaaa",          // dd/mm/aaaa | dd/mm/aa | mm/aa`,
  background: `"background": { "mode": "solid", "color": "#f8fafc" },  // fundo do dashboard; gradiente: { "mode": "gradient", "from": "#eef2ff", "to": "#fdf2f8", "angle": 135 }`,
  fontScale: `"fontScale": 1,                      // escala global de fonte (1 = 100%)`,
  kanban: null, // config de kanban dedicado — nunca no import (o export não a emite)
  connectors: null, // linhas entre widgets — o export não as emite; criadas na UI
  preset: null, // identidade de preset — o SERVIDOR gerencia; a IA nunca envia
  sourceScope: null, // recorte de Bases do board (⋮ → Bases) — config manual, fora do import
} satisfies Record<keyof DashboardSettings, string | null>;
