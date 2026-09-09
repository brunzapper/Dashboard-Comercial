// Versão: 1.0 | Data: 09/09/2026
// Modelo da SÉRIE DE TAREFAS PERIÓDICAS (0132) — a cobrança recorrente que uma
// automação mantém sobre um registro ("enquanto o deal estiver em Nutrição,
// abra uma tarefa a cada quinze dias").
//
// O pedido separa duas coisas que costumam ser confundidas:
//  - o gatilho PRIMÁRIO (quais registros participam) — são as CONDIÇÕES da
//    regra, que o motor 0109 já casa em E; nada novo;
//  - o gatilho SECUNDÁRIO (qual data conta para o relógio) — é a `anchor`
//    daqui. A etapa diz QUEM entra; a data de mudança de etapa diz A PARTIR DE
//    QUANDO contar.
// Sem essa separação, "quinzenal" não teria de onde contar.
//
// Parse FAIL-CLOSED como todo jsonb do projeto: série malformada não roda
// "como der", fica inerte com erro visível.
import type { WorkflowFieldSpec } from "@/lib/workflow/types";

/** De onde sai a data que inicia a contagem. */
export type SeriesAnchor =
  // Última alteração de um campo (records.field_modified_at[<campo>]) — é o
  // "desde que mudou para esta etapa", e é o MESMO fato que a condição de
  // tempo `field_changed` já carrega para a rodada.
  | { kind: "field_changed"; field: string }
  // Criação na origem (records.source_created_at).
  | { kind: "created" }
  // Um campo de data do próprio registro.
  | { kind: "field"; field: string };

/**
 * Limite de uma ponta da janela.
 *
 * A quarta forma de "quando parar" não está aqui: é a AUSÊNCIA de `until` —
 * cobra enquanto as condições da regra valerem, e sair da etapa faz a regra
 * deixar de casar. As três abaixo são os limites explícitos.
 *
 * v1.1 (09/09/2026): `field_changed` — para de cobrar quando ESSE campo mudar.
 * Lê o mesmo `records.field_modified_at` da âncora homônima e da condição de
 * tempo do motor, então o fato já chega na rodada sem consulta nova.
 */
export type SeriesBound =
  | { kind: "field"; field: string }
  // Data absoluta YYYY-MM-DD — o "prazo de término independente de variável".
  | { kind: "date"; date: string }
  | { kind: "field_changed"; field: string };

/** Em que escopo uma exceção de cadência pode ser gravada, e em que ordem. */
export type SeriesScopeKind = "record" | "responsible" | "field";

export interface SeriesScopeSpec {
  kind: SeriesScopeKind;
  /** Só em `field`: qual campo do registro recorta (ex.: `stage`). */
  field?: string;
}

export interface SeriesCadence {
  /** O padrão do esquema. 14 = quinzenal. */
  defaultDays: number;
  /**
   * Quem pode sobrescrever o padrão, NA ORDEM DE PRECEDÊNCIA (o primeiro que
   * tiver exceção gravada vence). É o esquema que declara isso; as exceções
   * em si são DADO (series_settings), editáveis sem abrir o construtor.
   */
  overrideScopes: SeriesScopeSpec[];
}

/** Quando a primeira cobrança acontece. */
export type SeriesFirstAt =
  // Um ciclo depois da âncora (o padrão: entrou em Nutrição hoje, cobra em 15
  // dias). Cobrar no mesmo instante em que o registro entrou é ruído.
  | "apos_um_ciclo"
  // No próprio dia da âncora.
  | "imediato";

export interface SeriesConfig {
  /** Identidade da série — carimbada na tarefa e chave das exceções. */
  key: string;
  /** Título da tarefa gerada (template com as refs do esquema). */
  title: WorkflowFieldSpec | string;
  description?: string;
  anchor: SeriesAnchor;
  /** Janela: antes de `from` não cobra; depois de `until` para de cobrar. */
  from?: SeriesBound;
  until?: SeriesBound;
  cadence: SeriesCadence;
  firstAt: SeriesFirstAt;
  /** Teto de cobranças por registro (0/ausente = sem teto). */
  maxOccurrences?: number;
  /** Atributo concedido ao registro que entra na série (ex.: "tree"). */
  grantAttribute?: string;
}

export const SERIES_SCOPE_LABELS: Record<SeriesScopeKind, string> = {
  record: "Registro",
  responsible: "Responsável",
  field: "Campo",
};

/** Teto de sobrescritas declaradas (configuração humana, não carga de dados). */
export const MAX_SERIES_SCOPES = 6;
export const MIN_CADENCE_DAYS = 1;
export const MAX_CADENCE_DAYS = 365;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const SLUG = /^[a-z][a-z0-9_]{1,39}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseAnchor(raw: unknown): SeriesAnchor | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "created") return { kind: "created" };
  const field = typeof raw.field === "string" ? raw.field.trim() : "";
  if (field === "") return null;
  if (raw.kind === "field_changed") return { kind: "field_changed", field };
  if (raw.kind === "field") return { kind: "field", field };
  return null;
}

function parseBound(raw: unknown): SeriesBound | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "date") {
    const date = typeof raw.date === "string" ? raw.date.slice(0, 10) : "";
    return ISO_DATE.test(date) ? { kind: "date", date } : null;
  }
  if (raw.kind === "field" || raw.kind === "field_changed") {
    const field = typeof raw.field === "string" ? raw.field.trim() : "";
    if (field === "") return null;
    return raw.kind === "field"
      ? { kind: "field", field }
      : { kind: "field_changed", field };
  }
  return null;
}

function parseScopes(raw: unknown): SeriesScopeSpec[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SERIES_SCOPES) return null;
  const out: SeriesScopeSpec[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const kind = item.kind;
    if (kind === "record" || kind === "responsible") {
      out.push({ kind });
      continue;
    }
    if (kind === "field") {
      const field = typeof item.field === "string" ? item.field.trim() : "";
      if (field === "") return null;
      out.push({ kind: "field", field });
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Parse fail-closed da configuração da série. Devolve null para qualquer
 * estrutura fora do contrato — cadência zero, âncora sem campo, escopo
 * desconhecido. Série que "roda como der" cobra o vendedor errado.
 */
export function parseSeriesConfig(raw: unknown): SeriesConfig | null {
  if (!isRecord(raw)) return null;

  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  if (!SLUG.test(key)) return null;

  const titleRaw = raw.title;
  const title =
    typeof titleRaw === "string"
      ? titleRaw.trim()
      : isRecord(titleRaw) && typeof titleRaw.value === "string"
        ? titleRaw.value.trim()
        : "";
  if (title === "") return null;

  const anchor = parseAnchor(raw.anchor);
  if (!anchor) return null;

  const cadenceRaw = isRecord(raw.cadence) ? raw.cadence : null;
  const defaultDays =
    cadenceRaw && typeof cadenceRaw.defaultDays === "number"
      ? Math.floor(cadenceRaw.defaultDays)
      : NaN;
  if (
    !Number.isFinite(defaultDays) ||
    defaultDays < MIN_CADENCE_DAYS ||
    defaultDays > MAX_CADENCE_DAYS
  ) {
    return null;
  }
  const overrideScopes = parseScopes(cadenceRaw?.overrideScopes);
  if (!overrideScopes) return null;

  const config: SeriesConfig = {
    key,
    title,
    anchor,
    cadence: { defaultDays, overrideScopes },
    firstAt: raw.firstAt === "imediato" ? "imediato" : "apos_um_ciclo",
  };

  if (typeof raw.description === "string" && raw.description.trim() !== "") {
    config.description = raw.description.trim();
  }
  for (const side of ["from", "until"] as const) {
    if (raw[side] !== undefined && raw[side] !== null) {
      const bound = parseBound(raw[side]);
      if (!bound) return null;
      config[side] = bound;
    }
  }
  if (typeof raw.maxOccurrences === "number" && raw.maxOccurrences > 0) {
    config.maxOccurrences = Math.floor(raw.maxOccurrences);
  }
  if (typeof raw.grantAttribute === "string" && SLUG.test(raw.grantAttribute)) {
    config.grantAttribute = raw.grantAttribute;
  }
  return config;
}
