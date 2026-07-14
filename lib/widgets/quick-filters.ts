// Versão: 1.0 | Data: 14/07/2026
// Filtros rápidos por widget: helpers compartilhados entre o RSC (page.tsx), o
// runtime do card (quick-filters-bar) e o modo lista (record-list).
//
// - A CONFIG (quais dropdowns o widget expõe) vive em settings.quickFilters
//   (QuickFilterEntry, lib/widgets/types.ts).
// - Os VALORES selecionados persistem em dashboard_table_cells com
//   row_key '__qf__' e col_key = entry.id — a RLS dessa tabela permite escrita
//   por QUALQUER visualizador do dashboard (0026), então a seleção é
//   compartilhada entre usuários e sobrevive a reloads.
// - Datas no formato PADRÃO viram um dropdown estilo período (presets), e o
//   filtro é um intervalo (gte/lte ou sentinel @period p/ unified:).
// - Datas COM formato (transform de dimensão) viram multi-seleção de buckets;
//   o filtro é o sentinel '@bucket' (op 'in'), resolvido pelo RPC (migração
//   0048) e pós-filtrado no modo lista (record-list.ts) com a MESMA chave
//   canônica (canonicalBucketKey).
import type { RecordRow } from "@/lib/records/types";
import type { AvailableField } from "./fields";
import { MONTH_NAMES_PT, WEEKDAY_NAMES_PT } from "./date-buckets";
import { unifiedMemberRef } from "@/lib/correspondences";
import type { QuickFilterEntry, Transform, WidgetFilter } from "./types";

// row_key reservado em dashboard_table_cells para os valores dos filtros
// rápidos (col_key = id do entry). Excluído do snapshot de Desfazer/Refazer.
export const QF_ROW_KEY = "__qf__";

// Campo sintético do filtro por bucket de data ('mês do ano', 'trimestre'…).
// Só o RPC (0048) e o pós-filtro do modo lista o reconhecem.
export const BUCKET_FIELD_SENTINEL = "@bucket";

/** Valor do filtro sintético `@bucket`: campo/formato + chaves selecionadas. */
export interface BucketFilterValue {
  field: string;
  transform: Transform;
  weekMode?: "full" | "restricted";
  keys: string[]; // chaves canônicas (ver canonicalBucketKey)
}

/** Valor persistido de um filtro rápido. */
export type QuickFilterValue =
  | { kind: "options"; values: string[] } // multi-seleção (ids/buckets)
  | { kind: "period"; preset?: string; de?: string; ate?: string }; // data padrão

/** Payload por widget entregue ao cliente (card). */
export interface WidgetQuickFilters {
  entries: QuickFilterEntry[];
  // Valores EFETIVOS por entry (já com override de vendedor / espelho do
  // período geral aplicados no servidor).
  values: Record<string, QuickFilterValue>;
  // Opções de dropdown por entry (multi-seleção). Período não usa opções.
  options: Record<string, { value: string; label: string }[]>;
}

/** Entry de data no formato padrão (dropdown de período)? */
export function isPeriodEntry(
  entry: QuickFilterEntry,
  available: AvailableField[]
): boolean {
  const isDate = available.find((a) => a.field === entry.field)?.isDate ?? false;
  return isDate && (!entry.transform || entry.transform === "none");
}

/** Entry de data com formato (multi-seleção de buckets)? */
export function isBucketEntry(
  entry: QuickFilterEntry,
  available: AvailableField[]
): boolean {
  const isDate = available.find((a) => a.field === entry.field)?.isDate ?? false;
  return isDate && Boolean(entry.transform) && entry.transform !== "none";
}

/** Parse seguro do jsonb persistido (entrada inválida → null, nunca lança). */
export function parseQuickFilterValue(raw: unknown): QuickFilterValue | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "options" && Array.isArray(o.values)) {
    return { kind: "options", values: o.values.map(String).filter(Boolean) };
  }
  if (o.kind === "period") {
    return {
      kind: "period",
      preset: typeof o.preset === "string" ? o.preset : "",
      de: typeof o.de === "string" ? o.de : "",
      ate: typeof o.ate === "string" ? o.ate : "",
    };
  }
  return null;
}

/** Um valor tem alguma seleção efetiva? */
export function hasQuickValue(v: QuickFilterValue | null | undefined): boolean {
  if (!v) return false;
  if (v.kind === "options") return v.values.length > 0;
  return Boolean(v.preset || v.de || v.ate);
}

// ===================== Chave canônica de bucket ==============================
// A MESMA convenção do RPC (0048): é o contrato entre as opções montadas no
// servidor, o valor persistido e o WHERE gerado (SQL) / pós-filtro (JS).
//   weekday      → "1".."7" (isodow)         month_name → "1".."12"
//   year         → "2026"                    quarter    → "2026-Q1"
//   month_year   → "2026-01"                 week_year  → "YYYY-MM-DD" (segunda)
//   week_month   → "YYYY-MM-DD" (segunda, ou recortada no início do mês)

const DAY_MS = 86_400_000;

function parseYmd(value: unknown): { y: number; m: number; d: number } | null {
  if (value == null) return null;
  const m = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function isoDate(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

function mondayOf(y: number, m: number, d: number): number {
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // segunda = 0
  return t - dow * DAY_MS;
}

/**
 * Chave canônica do bucket de uma DATA CRUA (valor do registro), no formato
 * que o RPC compara. Data inválida/vazia → null (registro fica fora).
 */
export function canonicalBucketKey(
  rawIso: unknown,
  transform: Transform,
  weekMode: "full" | "restricted" = "restricted"
): string | null {
  const p = parseYmd(rawIso);
  if (!p) return null;
  const { y, m, d } = p;
  switch (transform) {
    case "weekday": {
      const isodow = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
      return String(isodow);
    }
    case "month_name":
      return String(m);
    case "year":
      return String(y);
    case "quarter":
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case "month_year":
      return `${y}-${String(m).padStart(2, "0")}`;
    case "week_year":
      return isoDate(mondayOf(y, m, d));
    case "week_month": {
      const mon = mondayOf(y, m, d);
      const monthStart = Date.UTC(y, m - 1, 1);
      return isoDate(weekMode === "full" ? mon : Math.max(mon, monthStart));
    }
    default:
      return null;
  }
}

/**
 * Chave canônica a partir do BUCKET devolvido pelo RPC como dimensão (ISO do
 * date_trunc, ou isodow p/ weekday). Usada p/ montar as opções do dropdown.
 */
export function bucketKeyFromRpcValue(
  raw: unknown,
  transform: Transform
): string | null {
  if (raw == null || raw === "") return null;
  if (transform === "weekday") {
    const n = Number(raw);
    return n >= 1 && n <= 7 ? String(n) : null;
  }
  const p = parseYmd(raw);
  if (!p) return null;
  switch (transform) {
    case "month_name":
      return String(p.m);
    case "year":
      return String(p.y);
    case "quarter":
      return `${p.y}-Q${Math.floor((p.m - 1) / 3) + 1}`;
    case "month_year":
      return `${p.y}-${String(p.m).padStart(2, "0")}`;
    case "week_year":
    case "week_month":
      return isoDate(Date.UTC(p.y, p.m - 1, p.d));
    default:
      return null;
  }
}

/** Opções fixas (independem dos dados) p/ os formatos cíclicos. */
export function staticBucketOptions(
  transform: Transform
): { value: string; label: string }[] | null {
  if (transform === "month_name") {
    return MONTH_NAMES_PT.map((name, i) => ({ value: String(i + 1), label: name }));
  }
  if (transform === "weekday") {
    return WEEKDAY_NAMES_PT.map((name, i) => ({ value: String(i + 1), label: name }));
  }
  return null;
}

// ===================== Entry + valor → WidgetFilter ==========================

/**
 * Converte um entry de MULTI-SELEÇÃO (responsável/operação/bucket de data) num
 * WidgetFilter pronto p/ mesclar em config.filters. Período é tratado à parte
 * (vira intervalo via applyPeriodToFilters na page). Sem seleção → [].
 */
export function quickOptionsFilter(
  entry: QuickFilterEntry,
  values: string[],
  available: AvailableField[]
): WidgetFilter[] {
  if (values.length === 0) return [];
  if (isBucketEntry(entry, available)) {
    const value: BucketFilterValue = {
      field: entry.field,
      transform: entry.transform!,
      weekMode: entry.weekMode,
      keys: values,
    };
    return [
      { field: BUCKET_FIELD_SENTINEL, op: "in", value } as unknown as WidgetFilter,
    ];
  }
  return [{ field: entry.field, op: "in", value: values }];
}

// ===================== Pós-filtro no modo lista ==============================

/**
 * Valor cru de um campo num registro, p/ o pós-filtro do modo lista: coluna do
 * núcleo, custom:<k>, unified:<k> (membro da fonte do registro) e
 * match:<fonte>:<ref> (registro casado, via __match).
 */
export function recordRawValue(
  field: string,
  r: RecordRow,
  available: AvailableField[]
): unknown {
  if (field.startsWith("match:")) {
    const rest = field.slice("match:".length);
    const sep = rest.indexOf(":");
    if (sep <= 0) return undefined;
    const src = rest.slice(0, sep);
    const ref = rest.slice(sep + 1);
    const partner = r.__match?.[src];
    if (!partner) return undefined;
    return recordRawValue(ref, partner, available);
  }
  const ref = field.startsWith("unified:")
    ? unifiedMemberRef(
        available.find((a) => a.field === field)?.unifiedMembers,
        r.record_type
      )
    : field;
  if (!ref) return undefined;
  return ref.startsWith("custom:")
    ? r.custom_fields?.[ref.slice(7)]
    : (r as unknown as Record<string, unknown>)[ref];
}

/** Um registro passa por um filtro `@bucket`? (pós-filtro do modo lista) */
export function matchesBucketFilter(
  r: RecordRow,
  bf: BucketFilterValue,
  available: AvailableField[]
): boolean {
  const key = canonicalBucketKey(
    recordRawValue(bf.field, r, available),
    bf.transform,
    bf.weekMode
  );
  return key != null && bf.keys.includes(key);
}

/** Extrai o BucketFilterValue de um WidgetFilter '@bucket' (ou null). */
export function bucketFilterValue(f: WidgetFilter): BucketFilterValue | null {
  if (f.field !== BUCKET_FIELD_SENTINEL) return null;
  const v = f.value as BucketFilterValue | undefined;
  if (!v || typeof v !== "object" || !v.field || !Array.isArray(v.keys)) {
    return null;
  }
  return v;
}
