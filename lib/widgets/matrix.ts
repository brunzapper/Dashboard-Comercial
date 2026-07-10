// Versão: 1.0 | Data: 10/07/2026
// Fase 2: helpers da "Tabela editável". A estrutura (linhas/colunas) vem de
// widgets.settings.matrix; os valores das células vêm de dashboard_table_cells.
// Este módulo carrega as células de vários widgets de uma vez e as indexa por
// `rowKey:colKey` para o render. (As agregações col/linha da Fase 3 entram aqui.)
import type { SupabaseClient } from "@supabase/supabase-js";

/** Chave composta de uma célula no mapa em memória. */
export function cellKey(rowKey: string, colKey: string): string {
  return `${rowKey}:${colKey}`;
}

/** Valores das células por widget: widgetId → { 'rowKey:colKey' → value }. */
export type MatrixCells = Record<string, Record<string, unknown>>;

/**
 * Carrega as células dos widgets de tabela editável informados (RLS decide o
 * que o usuário pode ler/gravar).
 */
export async function loadMatrixCells(
  supabase: SupabaseClient,
  widgetIds: string[]
): Promise<MatrixCells> {
  const out: MatrixCells = {};
  if (widgetIds.length === 0) return out;
  const { data } = await supabase
    .from("dashboard_table_cells")
    .select("widget_id, row_key, col_key, value")
    .in("widget_id", widgetIds);
  for (const c of data ?? []) {
    const wid = c.widget_id as string;
    (out[wid] ??= {})[cellKey(c.row_key as string, c.col_key as string)] =
      c.value;
  }
  return out;
}
