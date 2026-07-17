// Versão: 1.0 | Data: 17/07/2026
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

// Tamanho inicial por tipo (unidades do grid). Calculadora 4×9 e demais 6×8
// preservam as convenções do insertAt antigo; os tipos "pequenos" (KPI,
// métrica calculada, forma, filtros) nascem mais compactos.
export const DEFAULT_WIDGET_SIZE: Record<VisualType, { w: number; h: number }> =
  {
    tabela: { w: 6, h: 8 },
    tabela_editavel: { w: 6, h: 8 },
    barra: { w: 6, h: 8 },
    barra_horizontal: { w: 6, h: 8 },
    linha: { w: 6, h: 8 },
    pizza: { w: 6, h: 8 },
    kpi: { w: 4, h: 4 },
    funil: { w: 6, h: 8 },
    filtro: { w: 6, h: 3 },
    filtro_campo: { w: 6, h: 4 },
    calculado: { w: 4, h: 4 },
    calculadora: { w: 4, h: 9 },
    nota: { w: 6, h: 8 },
    forma: { w: 4, h: 6 },
    kanban: { w: 6, h: 8 },
    agenda: { w: 6, h: 8 },
    imagem: { w: 4, h: 6 },
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
    case "filtro":
      return {
        kind: "period",
        field: DEFAULT_PERIOD_FIELD,
        targets: [],
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
