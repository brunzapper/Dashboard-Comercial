// Versão: 1.0 | Data: 22/07/2026
// Contrato do "Importar dashboard via JSON (modo IA)": um JSON declarativo
// gerado por uma IA externa descreve um dashboard COMPLETO (abas, widgets com
// cálculos/aparência, campos custom e sub-bases/correspondências necessárias).
// O shape espelha deliberadamente o dos presets (lib/presets/definitions.ts) —
// o importador valida (validate.ts) e MATERIALIZA num PresetDashboard, aplicado
// pelo MESMO motor idempotente dos presets (applyPresetDefinition). Identidade:
// presetKey "import:<chave>" (namespace distinto dos presets de fábrica) —
// reimportar o mesmo `chave` ATUALIZA o dashboard em vez de duplicar.
import type {
  Dimension,
  GridPosition,
  Metric,
  VisualType,
  WidgetFilter,
  WidgetSettings,
  DashboardSettings,
} from "@/lib/widgets/types";
import type { DataType } from "@/lib/records/types";
import type { Formula } from "@/lib/records/formulas";
import type { SourceKey } from "@/lib/sources";
import type { PresetDashboard } from "@/lib/presets/definitions";

export const DASHBOARD_IMPORT_FORMAT = "dashboard-import";
export const DASHBOARD_IMPORT_VERSION = 1;
// Prefixo de identidade dos dashboards importados (dashboards.settings.preset.
// key e widgets.settings.presetKey). NUNCA colide com os presets de fábrica.
export const IMPORT_PRESET_PREFIX = "import:";

// ---------- Seções do JSON (entrada, ainda NÃO confiável) ----------
// Os campos aceitam `formula_text` (estilo Sheets — muito mais fácil para uma
// IA gerar) como forma primária; `formula` (tokens) é aceita por compat. A
// tokenização/validação roda no servidor com os MESMOS módulos dos editores.

export interface ImportFieldSpec {
  field_key: string;
  label: string;
  data_type: DataType;
  options?: string[];
  visible_to_roles?: string[];
  editable_by_roles?: string[];
  is_local?: boolean;
  // Moeda: o motor de presets só cria campos 'moeda' com moeda herdada do
  // registro (currency_mode 'inherit') — moeda fixa não é suportada no import.
  currency_mode?: string;
  formula_text?: string;
  formula?: Formula;
  applies_to?: string[];
}

export interface ImportSubSourceSpec {
  key: string;
  parent_key: string;
  label: string;
  short_label?: string;
  default_period_field: string; // coluna core de data ou 'custom:<key>' (tipo data)
  filter: { field: string; op: string; value?: unknown }[];
}

export interface ImportCorrespondenceSpec {
  key: string;
  label: string;
  data_type?: DataType; // default 'texto'
  members: { source_key: string; field_ref: string }[];
}

// Métrica do JSON: Metric + formula_text (métrica calculada ad-hoc).
export interface ImportMetricSpec extends Partial<Omit<Metric, "field">> {
  field?: string;
  formula_text?: string;
}

export interface ImportWidgetSpec {
  // Identidade ESTÁVEL dentro do import (vira "import:<chave>.<key>"). Opcional
  // — ausente usa a posição (reordenar widgets no JSON muda a identidade).
  key?: string;
  title: string;
  visual_type: VisualType | string;
  sources?: SourceKey[];
  split_by_source?: boolean;
  dimensions?: Dimension[];
  metrics?: ImportMetricSpec[];
  filters?: WidgetFilter[];
  settings?: WidgetSettings;
  grid_position?: GridPosition;
}

export interface DashboardImportJson {
  formato: string; // DASHBOARD_IMPORT_FORMAT
  versao: number; // DASHBOARD_IMPORT_VERSION
  chave: string; // identidade do import (slug) — reimporte atualiza
  base: SourceKey; // Base principal (precisa existir no catálogo)
  dashboard: {
    name: string;
    visible_to_roles?: string[];
    settings?: DashboardSettings;
  };
  fields?: ImportFieldSpec[];
  subSources?: ImportSubSourceSpec[];
  correspondences?: ImportCorrespondenceSpec[];
  widgets: ImportWidgetSpec[];
}

// ---------- Contexto e resultado da validação ----------

// Linha de field_definitions com o necessário p/ catálogos de operandos e p/ o
// grafo de dependências (mesmo shape do DefRow de app/(app)/campos/actions.ts).
export interface ImportDefRow {
  id: string;
  field_key: string;
  label: string;
  data_type: DataType;
  formula: Formula | null;
  applies_to: string[] | null;
  source_system: string | null;
}

export interface DashboardImportContext {
  sources: import("@/lib/sources").SourceDef[]; // catálogo vivo (raízes + subs)
  defs: ImportDefRow[]; // field_definitions existentes
  correspondenceKeys: string[]; // keys de campos unificados existentes
  // Nomes reais p/ validar condições de SOMASE/CONT.SE sobre relações (o
  // runtime compara por NOME — nome inexistente viraria contagem 0 silenciosa).
  responsibleNames: string[];
  operationNames: string[];
}

export interface DashboardImportValidation {
  ok: boolean;
  errors: string[]; // legíveis em pt-BR — o usuário devolve à IA corrigir
  warnings: string[]; // não bloqueiam (ex.: campo já existente é reutilizado)
  preset?: PresetDashboard; // materializado, pronto p/ applyPresetDefinition
  // Seções presentes (o chamador decide os gates de permissão por seção).
  declares: { fields: boolean; subSources: boolean; correspondences: boolean };
}
