// Versão: 1.0 | Data: 15/07/2026
// Tipos do recurso Snapshot: link PÚBLICO (sem autenticação) e somente-leitura
// para os resultados de UMA aba de um dashboard, sobre um dataset CONGELADO
// (ver supabase/migrations/0056_snapshots.sql e lib/snapshots/refresh.ts).
import type { FieldDefinition } from "@/lib/records/types";
import type { Correspondence } from "@/lib/correspondences";
import type { SystemCurrency, CurrencyRates } from "@/lib/widgets/currency";
import type { SavedPeriod } from "@/lib/widgets/period";
import type {
  DashboardSettings,
  FieldFilterOptions,
  Widget,
} from "@/lib/widgets/types";

export type RefreshMode = "manual" | "hourly" | "daily" | "weekly";
export type SnapshotStatus = "active" | "paused";

export interface SelectOption {
  value: string;
  label: string;
}

// Linha de public.snapshots como o app a consome. token_hash fica DE FORA de
// propósito: só o loader público (app/s/[token]) o usa como chave de busca —
// nunca é selecionado para a UI nem devolvido por server actions.
export interface SnapshotRow {
  id: string;
  dashboard_id: string;
  tab_id: string;
  name: string;
  allowed_responsible_ids: string[] | null;
  allowed_operation_ids: string[] | null;
  // record_type ('lead' | 'negocio' | 'venda_site') — ver lib/sources.ts.
  allowed_sources: string[] | null;
  allow_quick_filters: boolean;
  allow_widget_filters: boolean;
  refresh_mode: RefreshMode;
  refresh_time: string | null; // "HH:MM" (Brasília)
  refresh_weekday: number | null; // 1..7 ISO (segunda = 1)
  next_refresh_at: string | null;
  // Filtro de período do dashboard no momento da criação (0059), aplicado como
  // período de todos os widgets no viewer. null = todo o período.
  default_period: SavedPeriod | null;
  status: SnapshotStatus;
  config: SnapshotConfig;
  last_refreshed_at: string | null;
  last_refresh_error: string | null;
  last_accessed_at: string | null;
  access_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Colunas seguras p/ listagens de gestão (sem config, que pode ser grande).
export const SNAPSHOT_LIST_COLS =
  "id, dashboard_id, tab_id, name, allowed_responsible_ids, allowed_operation_ids, allowed_sources, allow_quick_filters, allow_widget_filters, refresh_mode, refresh_time, refresh_weekday, next_refresh_at, default_period, status, last_refreshed_at, last_refresh_error, last_accessed_at, access_count, created_by, created_at, updated_at";

/** Item de listagem (gestão): SnapshotRow sem o config. */
export type SnapshotListItem = Omit<SnapshotRow, "config">;

// Bundle CONGELADO no refresh (snapshots.config). É tudo o que o viewer
// público precisa para renderizar a aba além do dataset (snapshot_records):
// edições no dashboard só chegam ao link no PRÓXIMO refresh.
export interface SnapshotConfig {
  dashboard: {
    name: string;
    // Settings congelado JÁ saneado para o viewer: tabs reduzido à aba do
    // snapshot, connectors filtrados aos widgets da aba e periodBar
    // desabilitado (snapshot não tem filtro de período geral).
    settings: DashboardSettings;
  };
  tabName: string;
  // Widgets da aba (linhas completas, congeladas).
  widgets: Widget[];
  fields: FieldDefinition[];
  correspondences: Correspondence[];
  currencies: SystemCurrency[];
  currencyRates: CurrencyRates;
  // Opções dos filtros rápidos por widget/entry — SEMPRE restritas às
  // permissões do snapshot (nunca a lista completa de responsáveis/operações;
  // buckets calculados sobre snapshot_records, pós-restrição).
  quickFilterOptions: Record<string, Record<string, SelectOption[]>>;
  // Opções dos widgets "Filtro por campo" (mesma regra de restrição).
  fieldFilterOptions: Record<string, FieldFilterOptions>;
  // Expressão compartilhada corrente de cada calculadora (semente read-only).
  calcExprById: Record<string, string>;
  // Células digitadas das Tabelas Livres da aba (read-only no viewer).
  tableCellsById: Record<
    string,
    { row_key: string; col_key: string; value: number | string | null }[]
  >;
}
