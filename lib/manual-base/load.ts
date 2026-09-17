// Versão: 1.0 | Data: 17/09/2026
// Leitura da Base manual (0142). O client vem INJETADO, como em todo loader
// que o engine de widgets consome — é o que faz o viewer público de snapshots
// ler os ESPELHOS congelados sem que este módulo saiba disso
// (lib/snapshots/db-adapter.ts redireciona `manual_series`/`manual_entries`).
//
// Resiliência dos loaders de lib/config/: qualquer falha (tabela ausente
// pré-migração, rede) devolve a base VAZIA. Uma métrica manual sem dado exibe
// "—"; um dashboard que não abre por causa disso seria pior.
//
// `orgId` é OPCIONAL e existe para o caminho service role, que enxerga todas
// as organizações: sem ele, os lançamentos de outra org entrariam nos
// dashboards desta (precedente de currencies na 0123). Com o client RLS do
// usuário, a policy já resolve e o filtro é redundante — mas inofensivo.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_MANUAL_SPREAD,
  EMPTY_MANUAL_BASE,
  isManualSpread,
  type ManualBaseData,
  type ManualEntry,
  type ManualSeries,
} from "./types";

const SERIES_COLS = "id, key, label, default_spread, sort_order";
const ENTRY_COLS =
  "id, series_id, period_start, period_end, value, responsible_id, operation_id, spread, note";

function toSeries(r: Record<string, unknown>): ManualSeries | null {
  const key = typeof r.key === "string" ? r.key : "";
  const id = typeof r.id === "string" ? r.id : "";
  if (!key || !id) return null;
  return {
    id,
    key,
    label: typeof r.label === "string" && r.label ? r.label : key,
    default_spread: isManualSpread(r.default_spread)
      ? r.default_spread
      : DEFAULT_MANUAL_SPREAD,
    sort_order: Number(r.sort_order ?? 0) || 0,
  };
}

function toEntry(r: Record<string, unknown>): ManualEntry | null {
  const id = typeof r.id === "string" ? r.id : "";
  const seriesId = typeof r.series_id === "string" ? r.series_id : "";
  if (!id || !seriesId) return null;
  const value = Number(r.value);
  if (!Number.isFinite(value)) return null;
  // `date` volta como "YYYY-MM-DD"; o slice protege de uma coluna que um dia
  // vire timestamp sem que este módulo perceba.
  const start = String(r.period_start ?? "").slice(0, 10);
  const end = String(r.period_end ?? "").slice(0, 10);
  if (!start) return null;
  return {
    id,
    series_id: seriesId,
    period_start: start,
    period_end: end || start,
    value,
    responsible_id: typeof r.responsible_id === "string" ? r.responsible_id : null,
    operation_id: typeof r.operation_id === "string" ? r.operation_id : null,
    spread: isManualSpread(r.spread) ? r.spread : DEFAULT_MANUAL_SPREAD,
    note: typeof r.note === "string" && r.note ? r.note : null,
  };
}

/**
 * A base inteira (dados + lançamentos). É pequena por natureza — são números
 * digitados à mão — então não vale paginar nem recortar por período aqui: o
 * recorte é do engine, que precisa dos lançamentos de FORA do período para
 * decidir "interseção" e "diário" nas bordas.
 */
export const loadManualBase = cache(async function loadManualBase(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<ManualBaseData> {
  try {
    let sq = supabase.from("manual_series").select(SERIES_COLS);
    let eq = supabase.from("manual_entries").select(ENTRY_COLS);
    if (orgId) {
      sq = sq.eq("organization_id", orgId);
      eq = eq.eq("organization_id", orgId);
    }
    const [sr, er] = await Promise.all([sq, eq]);
    if (sr.error || !sr.data) return EMPTY_MANUAL_BASE;
    const series = (sr.data as Record<string, unknown>[])
      .map(toSeries)
      .filter((s): s is ManualSeries => s != null)
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "pt-BR"));
    if (series.length === 0) return EMPTY_MANUAL_BASE;
    const entries =
      er.error || !er.data
        ? []
        : (er.data as Record<string, unknown>[])
            .map(toEntry)
            .filter((e): e is ManualEntry => e != null);
    return { series, entries };
  } catch {
    return EMPTY_MANUAL_BASE;
  }
});

/** Só os DADOS — para o catálogo de operandos, que não precisa dos números.
 *  Consome o mesmo `cache()` acima: não custa uma segunda consulta. */
export async function loadManualSeries(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<ManualSeries[]> {
  return (await loadManualBase(supabase, orgId)).series;
}

/**
 * Carimbo de versão da base, para o fingerprint de re-busca dos widgets
 * DEFERIDOS (deferredScopeById). Sem ele, editar um lançamento não muda nada
 * que o efeito do cliente observe, e o payload velho fica na tela até F5.
 *
 * É `max(updated_at)` MAIS a contagem de linhas: excluir um lançamento não
 * move nenhum `updated_at`, e só o timestamp deixaria a exclusão invisível
 * para quem estava com o dashboard aberto.
 *
 * Falha ⇒ string vazia: pior caso, não re-busca — nunca quebra a page.
 */
export async function loadManualBaseStamp(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<string> {
  try {
    const pick = async (table: string) => {
      let q = supabase
        .from(table)
        .select("updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .limit(1);
      if (orgId) q = q.eq("organization_id", orgId);
      const { data, count } = await q;
      const row = Array.isArray(data) ? data[0] : null;
      const at = row?.updated_at ? String(row.updated_at) : "";
      return `${at}#${count ?? 0}`;
    };
    const [s, e] = await Promise.all([pick("manual_series"), pick("manual_entries")]);
    return `${s}|${e}`;
  } catch {
    return "";
  }
}
