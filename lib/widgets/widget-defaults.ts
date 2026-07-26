// Versão: 1.2 | Data: 25/07/2026
// v1.2 (25/07/2026): tamanhos no espaço FINO do grid (base 120, ×10−1/×4−1 —
//   lib/widgets/grid-space): 6×8 → 59×31 etc. O −1 preserva o vão de 1 célula
//   entre widgets adjacentes (as margens do grid antigo não existem mais).
// v1.1 (25/07/2026): defaults do novo tipo 'linha_divisoria' (rect largo 6×2
//   ⇒ lineFromRect deriva um divisor horizontal na primeira renderização).
// Defaults de criação por tipo de widget, compartilhados entre o menu de
// contexto do grid (Inserir ▸ qualquer tipo) e o construtor (tamanho do ghost
// do modo Posicionar). Centraliza o que antes vivia inline em
// dashboard-grid.insertAt (nota/tabela_editavel/calculadora) e nos branches do
// widget-builder.save().

import type {
  Dimension,
  Metric,
  VisualType,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";
import { VISUAL_TYPE_LABELS } from "@/lib/widgets/types";
import type { SourceKey } from "@/lib/sources";
import { defaultQuickTable } from "@/lib/widgets/quick-table/model";
import { DEFAULT_PERIOD_FIELD } from "@/lib/widgets/period";

// Estruturalmente compatível com WidgetInput (actions) sem grid_position; o
// tipo é redeclarado aqui para não importar de app/ dentro de lib/.
export interface WidgetSeed {
  title: string | null;
  visual_type: VisualType;
  sources: SourceKey[];
  splitBySource: boolean;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  settings: WidgetSettings;
}

// Tamanho inicial por tipo (unidades FINAS do grid — os equivalentes dos
// antigos 6×8/4×4/… no espaço base-120). Calculadora e demais "grandes"
// preservam as convenções do insertAt antigo; os tipos "pequenos" (KPI,
// métrica calculada, forma, filtros) nascem mais compactos.
export const DEFAULT_WIDGET_SIZE: Record<VisualType, { w: number; h: number }> =
  {
    tabela: { w: 59, h: 31 },
    tabela_editavel: { w: 59, h: 31 },
    barra: { w: 59, h: 31 },
    barra_horizontal: { w: 59, h: 31 },
    linha: { w: 59, h: 31 },
    pizza: { w: 59, h: 31 },
    kpi: { w: 39, h: 15 },
    funil: { w: 59, h: 31 },
    filtro: { w: 59, h: 11 },
    filtro_campo: { w: 59, h: 15 },
    calculado: { w: 39, h: 15 },
    calculadora: { w: 39, h: 35 },
    nota: { w: 59, h: 31 },
    forma: { w: 39, h: 23 },
    // Rect mais largo que alto: lineFromRect (lines.ts) deriva a linha média
    // HORIZONTAL — um divisor recém-inserido nasce horizontal.
    linha_divisoria: { w: 59, h: 7 },
    kanban: { w: 59, h: 31 },
    agenda: { w: 59, h: 31 },
    imagem: { w: 39, h: 23 },
  };

// Tipos que exigem configuração para mostrar algo útil: a criação rápida abre
// o editor automaticamente. Nota/calculadora/tabela livre/forma são
// auto-suficientes (conteúdo editado no próprio card).
export const WIDGET_NEEDS_CONFIG: Record<VisualType, boolean> = {
  tabela: true,
  tabela_editavel: false,
  barra: true,
  barra_horizontal: true,
  linha: true,
  pizza: true,
  kpi: true,
  funil: true,
  filtro: true,
  filtro_campo: true,
  calculado: true,
  calculadora: false,
  nota: false,
  forma: false,
  linha_divisoria: false,
  kanban: true,
  agenda: true,
  // Sem URL não há nada a mostrar: abre o editor direto na criação.
  imagem: true,
};

// Tipos consultados pelo engine (run_widget_query): precisam de ≥1 métrica —
// SELECT vazio é rejeitado. A contagem de registros é o placeholder válido.
const ENGINE_TYPES: ReadonlySet<VisualType> = new Set([
  "tabela",
  "barra",
  "barra_horizontal",
  "linha",
  "pizza",
  "kpi",
  "funil",
]);

// Títulos herdados do insertAt antigo (mais curtos que os rótulos da UI).
const SEED_TITLES: Partial<Record<VisualType, string>> = {
  nota: "Nota",
  tabela_editavel: "Tabela Livre",
  calculadora: "Calculadora",
};

function seedSettings(type: VisualType): WidgetSettings {
  switch (type) {
    case "calculadora":
      return { calculator: { variables: [] } };
    case "tabela_editavel":
      return { quickTable: defaultQuickTable(3, 3) };
    case "forma":
      return { shape: { kind: "retangulo_arredondado" } };
    // O traçado (shape.line) NÃO é gravado no create: lineOf/lineFromRect o
    // derivam preguiçosamente do grid_position (mesma regra da forma antiga).
    case "linha_divisoria":
      return { shape: { kind: "linha" } };
    case "filtro":
      return {
        kind: "period",
        field: DEFAULT_PERIOD_FIELD,
        excludedTargets: [],
        defaultPreset: "",
      };
    case "filtro_campo":
      return { fields: [], searchFields: ["title"], excludedTargets: [] };
    // Kanban SEM fonte só funciona no modo tarefas ("registros" exige fonte —
    // ver widget-builder.save()).
    case "kanban":
      return { kanban: { mode: "tarefas" } };
    case "agenda":
      return { agenda: { showTasks: true, defaultView: "month" } };
    case "imagem":
      return { image: {} };
    default:
      return {};
  }
}

// Seed completo de um widget novo do tipo dado, pronto para virar WidgetInput
// (falta só grid_position). `tabId` associa o widget à aba ativa.
export function defaultWidgetSeed(type: VisualType, tabId?: string): WidgetSeed {
  return {
    title: SEED_TITLES[type] ?? VISUAL_TYPE_LABELS[type],
    visual_type: type,
    sources: [],
    splitBySource: false,
    dimensions: [],
    metrics: ENGINE_TYPES.has(type) ? [{ field: "*", agg: "count" }] : [],
    filters: [],
    settings: {
      ...seedSettings(type),
      ...(tabId ? { tab: tabId } : {}),
    },
  };
}
