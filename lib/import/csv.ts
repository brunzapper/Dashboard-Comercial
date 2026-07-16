// Versão: 1.0 | Data: 16/07/2026
// Núcleo PURO do import de CSV (client-safe: sem node/crypto/supabase) —
// mapeamento de colunas, inferência de tipo e coerção pt-BR. Usado pelo
// wizard (components/importacao) e pelo motor server-side (lib/import/ingest).
// Uma futura API de ingestão reutiliza exatamente estes tipos/coerções com um
// mapeamento salvo — mesmo engine, front diferente.

// ============ Alvos de mapeamento ============
// Cada coluna do CSV mapeia para:
//   "ignore"              -> descartada
//   "responsible"         -> responsável por NOME (resolve/cria em responsibles)
//   "core:<coluna>"       -> coluna física whitelisted de records
//   "custom:<field_key>"  -> chave em records.custom_fields (field_definitions)
export interface ColumnMapping {
  csvColumn: string;
  target: string;
  // Tipo p/ coerção de valores custom (os core derivam da própria coluna).
  dataType?: string;
}

export interface CoreImportTarget {
  value: string; // "core:<col>"
  label: string;
  kind: "texto" | "numero" | "data";
}

// Colunas core aceitas pelo import (whitelist — nunca aceitar coluna arbitrária).
export const CORE_IMPORT_TARGETS: CoreImportTarget[] = [
  { value: "core:title", label: "Título / Nome", kind: "texto" },
  { value: "core:value", label: "Valor", kind: "numero" },
  { value: "core:mrr", label: "MRR", kind: "numero" },
  { value: "core:currency", label: "Moeda (código)", kind: "texto" },
  { value: "core:stage", label: "Etapa", kind: "texto" },
  { value: "core:pipeline", label: "Pipeline / Funil", kind: "texto" },
  { value: "core:channel", label: "Canal", kind: "texto" },
  { value: "core:sale_type", label: "Tipo de venda / Plano", kind: "texto" },
  { value: "core:closed_at", label: "Data de fechamento", kind: "data" },
  { value: "core:opened_at", label: "Data de abertura", kind: "data" },
  { value: "core:source_created_at", label: "Data de criação (origem)", kind: "data" },
];

export const CORE_IMPORT_COLUMNS = new Set(
  CORE_IMPORT_TARGETS.map((t) => t.value.slice("core:".length))
);

export function coreTargetKind(col: string): "texto" | "numero" | "data" {
  return (
    CORE_IMPORT_TARGETS.find((t) => t.value === `core:${col}`)?.kind ?? "texto"
  );
}

// Sugestões de alvo por cabeçalho normalizado (slug) — só palpites; o usuário
// confirma no passo de mapeamento.
const HEADER_SUGGESTIONS: Record<string, string> = {
  titulo: "core:title",
  nome: "core:title",
  name: "core:title",
  cliente: "core:title",
  valor: "core:value",
  contrato: "core:value",
  contract: "core:value",
  mrr: "core:mrr",
  moeda: "core:currency",
  currency: "core:currency",
  etapa: "core:stage",
  estagio: "core:stage",
  stage: "core:stage",
  pipeline: "core:pipeline",
  funil: "core:pipeline",
  canal: "core:channel",
  channel: "core:channel",
  plano: "core:sale_type",
  tipo_de_venda: "core:sale_type",
  data_de_fechamento: "core:closed_at",
  fechamento: "core:closed_at",
  data_de_abertura: "core:opened_at",
  abertura: "core:opened_at",
  data_de_criacao: "core:source_created_at",
  criado_em: "core:source_created_at",
  created_at: "core:source_created_at",
  data: "core:source_created_at",
  data_da_venda: "core:source_created_at",
  responsavel: "responsible",
  consultor: "responsible",
  vendedor: "responsible",
  owner: "responsible",
};

export function suggestTarget(headerSlug: string): string | null {
  return HEADER_SUGGESTIONS[headerSlug] ?? null;
}

// ============ Coerção pt-BR ============

/** "1.234,56" | "1234,56" | "1,234.56" | "1234.56" | "R$ 1.234" -> número. */
export function coerceNumber(raw: string): number | null {
  let s = raw.trim().replace(/^r\$\s*/i, "").replace(/[\s ]/g, "");
  if (s === "" || s === "-") return null;
  const negative = /^\(.*\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  if (/,\d{1,2}$/.test(s)) {
    // decimal com vírgula (pt-BR): pontos são milhar.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // só pontos em grupos de 3: milhar pt-BR sem decimais.
    s = s.replace(/\./g, "");
  } else {
    // formato en-US ou já limpo: vírgulas são milhar.
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** "dd/mm/aaaa[ hh:mm[:ss]]" | "aaaa-mm-dd[...]" | "dd-mm-aaaa" -> ISO. */
export function coerceDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // ISO (com ou sem hora) — valida e repassa.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})([T ](\d{2}):(\d{2})(:(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, , hh, mi, , ss] = m;
    if (!validYmd(+y, +mo, +d)) return null;
    return hh ? `${y}-${mo}-${d}T${hh}:${mi}:${ss ?? "00"}` : `${y}-${mo}-${d}`;
  }
  // dd/mm/aaaa ou dd-mm-aaaa (+ hora opcional).
  m = s.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})( (\d{1,2}):(\d{2})(:(\d{2}))?)?$/
  );
  if (m) {
    const [, d, mo, y, , hh, mi, , ss] = m;
    if (!validYmd(+y, +mo, +d)) return null;
    const date = `${y}-${pad2(+mo)}-${pad2(+d)}`;
    return hh ? `${date}T${pad2(+hh)}:${mi}:${ss ?? "00"}` : date;
  }
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const TRUE_WORDS = new Set(["sim", "s", "true", "1", "x", "yes", "y", "verdadeiro"]);
const FALSE_WORDS = new Set(["nao", "não", "n", "false", "0", "no", "falso", ""]);

export function coerceBoolean(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

/** Coage um valor de célula pro tipo do campo destino (null = vazio/inválido). */
export function coerceValue(dataType: string, raw: unknown): unknown {
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return null;
  switch (dataType) {
    case "numero":
    case "moeda":
      return coerceNumber(s);
    case "data":
      return coerceDate(s);
    case "booleano":
      return coerceBoolean(s);
    default:
      return s;
  }
}

// ============ Inferência de tipo ============

/** Infere o tipo de uma coluna pelas amostras não-vazias (>=90% de acerto). */
export function inferDataType(samples: unknown[]): "texto" | "numero" | "data" {
  const values = samples
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter((v) => v !== "")
    .slice(0, 100);
  if (values.length === 0) return "texto";
  const threshold = Math.ceil(values.length * 0.9);
  let dates = 0;
  let numbers = 0;
  for (const v of values) {
    if (coerceDate(v) != null) dates += 1;
    if (coerceNumber(v) != null) numbers += 1;
  }
  // Data primeiro: "16/07/2026" também não parseia como número, mas números
  // puros nunca parseiam como data — a ordem evita ambiguidade.
  if (dates >= threshold) return "data";
  if (numbers >= threshold) return "numero";
  return "texto";
}
