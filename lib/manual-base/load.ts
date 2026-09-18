// Versão: 1.1 | Data: 18/09/2026
// v1.1 (18/09/2026): FAMÍLIAS (0143) — o catálogo dos eixos, os membros e a
//   DECLARAÇÃO por dado entram na mesma rodada de `Promise.all`, e `coords` na
//   lista de colunas do lançamento. O carimbo passa a cobrir as QUATRO tabelas:
//   sem isso, renomear um membro ou declarar uma família não refresca widget
//   nenhum até um F5.
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
  parseManualCoords,
  type ManualAxisCatalog,
  type ManualFamily,
  type ManualFamilyMember,
} from "./families";
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
  "id, series_id, period_start, period_end, value, responsible_id, operation_id, spread, note, coords";
const FAMILY_COLS = "id, key, label, sort_order";
const MEMBER_COLS = "id, family_id, key, label, sort_order";
const DECL_COLS = "series_id, family_key, sort_order";

/** As famílias que cada DADO declara (0143) — o opt-in do modelo de níveis. */
export type ManualDeclarations = Record<string, string[]>;

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
    // Coluna ausente (pré-0143) vira o nível ∅, que é o que toda linha da 0142
    // é. O saneamento é fail-closed POR CHAVE, nunca por lançamento.
    coords: parseManualCoords(r.coords),
  };
}

function toFamily(r: Record<string, unknown>): ManualFamily | null {
  const id = typeof r.id === "string" ? r.id : "";
  const key = typeof r.key === "string" ? r.key : "";
  if (!id || !key) return null;
  return {
    id,
    key,
    label: typeof r.label === "string" && r.label ? r.label : key,
    sort_order: Number(r.sort_order ?? 0) || 0,
  };
}

function toMember(r: Record<string, unknown>): ManualFamilyMember | null {
  const id = typeof r.id === "string" ? r.id : "";
  const familyId = typeof r.family_id === "string" ? r.family_id : "";
  const key = typeof r.key === "string" ? r.key : "";
  if (!id || !familyId || !key) return null;
  return {
    id,
    family_id: familyId,
    key,
    label: typeof r.label === "string" && r.label ? r.label : key,
    sort_order: Number(r.sort_order ?? 0) || 0,
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
    const scoped = (table: string, cols: string) => {
      const q = supabase.from(table).select(cols);
      return orgId ? q.eq("organization_id", orgId) : q;
    };
    // `allSettled`, não `all`: as tabelas de FAMÍLIA são mais novas que as de
    // número (0143 × 0142), e um `all` faria a ausência delas REJEITAR a
    // rodada inteira — a base voltaria vazia e os números sumiriam do
    // dashboard. A resiliência precisa ser por metade: sem famílias a Base
    // manual continua sendo exatamente o que era na 0142.
    const [srs, ers, frs, mrs] = await Promise.allSettled([
      scoped("manual_series", SERIES_COLS),
      scoped("manual_entries", ENTRY_COLS),
      scoped("manual_families", FAMILY_COLS),
      scoped("manual_family_members", MEMBER_COLS),
    ]);
    const settled = <T,>(r: PromiseSettledResult<T>): T | null =>
      r.status === "fulfilled" ? r.value : null;
    const sr = settled(srs);
    const er = settled(ers);
    const fr = settled(frs);
    const mr = settled(mrs);
    if (!sr || sr.error || !sr.data) return EMPTY_MANUAL_BASE;
    const series = (sr.data as unknown as Record<string, unknown>[])
      .map(toSeries)
      .filter((s): s is ManualSeries => s != null)
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "pt-BR"));
    if (series.length === 0) return EMPTY_MANUAL_BASE;
    const entries =
      !er || er.error || !er.data
        ? []
        : (er.data as unknown as Record<string, unknown>[])
            .map(toEntry)
            .filter((e): e is ManualEntry => e != null);
    // Famílias falham em silêncio para a base VAZIA de eixos, não para a base
    // vazia inteira: pré-0143 as tabelas não existem, e uma métrica manual sem
    // família nenhuma continua funcionando exatamente como na 0142.
    const families =
      !fr || fr.error || !fr.data
        ? []
        : (fr.data as unknown as Record<string, unknown>[])
            .map(toFamily)
            .filter((f): f is ManualFamily => f != null)
            .sort(
              (a, b) =>
                a.sort_order - b.sort_order ||
                a.label.localeCompare(b.label, "pt-BR")
            );
    const members =
      !mr || mr.error || !mr.data
        ? []
        : (mr.data as unknown as Record<string, unknown>[])
            .map(toMember)
            .filter((m): m is ManualFamilyMember => m != null);
    return { series, entries, families, members };
  } catch {
    return EMPTY_MANUAL_BASE;
  }
});

/**
 * A DECLARAÇÃO de famílias por dado (0143). Fora de `loadManualBase` porque o
 * ENGINE não precisa dela: quem decide o nível são as `coords` dos lançamentos,
 * nunca a declaração. Ela serve à UI (quais colunas de coordenada mostrar) e ao
 * catálogo de operandos com escopo (que sem ela emitiria dados × famílias ×
 * membros).
 */
export const loadManualDeclarations = cache(
  async function loadManualDeclarations(
    supabase: SupabaseClient,
    orgId?: string | null
  ): Promise<ManualDeclarations> {
    try {
      let q = supabase.from("manual_series_families").select(DECL_COLS);
      if (orgId) q = q.eq("organization_id", orgId);
      const { data, error } = await q;
      if (error || !data) return {};
      const rows = (data as Record<string, unknown>[])
        .map((r) => ({
          seriesId: typeof r.series_id === "string" ? r.series_id : "",
          familyKey: typeof r.family_key === "string" ? r.family_key : "",
          order: Number(r.sort_order ?? 0) || 0,
        }))
        .filter((r) => r.seriesId && r.familyKey)
        .sort((a, b) => a.order - b.order || a.familyKey.localeCompare(b.familyKey));
      const out: ManualDeclarations = {};
      for (const r of rows) {
        (out[r.seriesId] ??= []).push(r.familyKey);
      }
      return out;
    } catch {
      return {};
    }
  }
);

/** Só os DADOS — para o catálogo de operandos, que não precisa dos números.
 *  Consome o mesmo `cache()` acima: não custa uma segunda consulta. */
export async function loadManualSeries(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<ManualSeries[]> {
  return (await loadManualBase(supabase, orgId)).series;
}

/**
 * O catálogo dos EIXOS como os consumidores de FÓRMULA precisam dele (0143):
 * famílias + membros + declaração por dado. Dono ÚNICO da montagem — é ele que
 * mantém OFERTA e VALIDAÇÃO olhando o mesmo conjunto, que é a divergência que a
 * v2.8 já custou uma entrega.
 */
export async function loadManualAxes(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<ManualAxisCatalog> {
  const [base, declarations] = await Promise.all([
    loadManualBase(supabase, orgId),
    loadManualDeclarations(supabase, orgId),
  ]);
  return { families: base.families, members: base.members, declarations };
}

/** Só as FAMÍLIAS — para rotular um eixo onde os números não são necessários
 *  (`runWidgetByPeriod` degrada a métrica manual mas precisa do cabeçalho
 *  certo). Consome o mesmo `cache()`: não custa uma segunda consulta. */
export async function loadManualFamilies(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<ManualFamily[]> {
  return (await loadManualBase(supabase, orgId)).families;
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
    // QUATRO tabelas: renomear uma família ou um membro muda o RÓTULO de um
    // eixo em tela, então tem de entrar no carimbo junto com os números. A
    // DECLARAÇÃO fica de fora de propósito — ela não altera nenhum valor nem
    // rótulo de widget (quem decide o nível são as `coords` dos lançamentos).
    // `allSettled` pela mesma razão do loader: tabela de família ausente não
    // pode zerar o carimbo dos números (zerar = o widget deixa de re-buscar).
    const parts = await Promise.allSettled([
      pick("manual_series"),
      pick("manual_entries"),
      pick("manual_families"),
      pick("manual_family_members"),
    ]);
    return parts
      .map((r) => (r.status === "fulfilled" ? r.value : ""))
      .join("|");
  } catch {
    return "";
  }
}
