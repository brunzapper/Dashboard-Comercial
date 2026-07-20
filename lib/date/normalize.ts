// Versão: 1.0 | Data: 19/07/2026
// PREMISSA (auditoria 20/07/2026): o offset emitido é o do INSTANTE do valor —
// para America/Sao_Paulo, valores anteriores a 2019 (era do horário de verão)
// sairiam "-02:00" e divergiriam do "-03:00" fixo do backfill 0080. O dataset
// é ≥2026 (premissa da 0080), então isso não ocorre; se um dia entrarem datas
// pré-2019, alinhar aqui com o formato do backfill antes de sincronizá-las.
// Normalização de fuso para strings de data/hora vindas de fontes externas
// (data_sources.timezone — ex.: portal Bitrix em Europe/Moscow). O read side
// inteiro é prefix-based (lê o "YYYY-MM-DD" literal da string: format.ts,
// date-buckets.ts, comparação textual do período na RPC), então o dia CERTO
// precisa estar no prefixo já na GRAVAÇÃO. Regras:
//   - sourceTz null/indefinido -> passthrough (fonte sem conversão)
//   - "YYYY-MM-DD" (date-only) -> inalterado (semântica de calendário)
//   - datetime COM offset/Z    -> instante re-expresso no fuso alvo
//   - datetime naive           -> interpretado no sourceTz, depois convertido
//   - lixo / fuso inválido     -> inalterado (nunca lança; sync não pode cair)
// A saída "YYYY-MM-DDTHH:mm:ss±HH:MM" precisa bater BYTE A BYTE com o
// to_char(...) || '-03:00' do backfill (0080) — divergência faria o reconcile
// reescrever tudo de novo (valuesDiffer compara strings).

export const BRASILIA_TZ = "America/Sao_Paulo";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const NAIVE_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

interface WallParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mi: number;
  ss: number;
}

// Um Intl.DateTimeFormat por fuso (criação é cara; o sync converte milhares
// de valores). en-CA + h23 dá partes numéricas estáveis "YYYY-MM-DD HH:mm:ss".
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmtFor(tz: string): Intl.DateTimeFormat {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(tz, fmt);
  }
  return fmt;
}

/** Horário "de parede" de um instante no fuso dado. */
export function zonedParts(epochMs: number, tz: string): WallParts {
  const parts = fmtFor(tz).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    hh: get("hour") % 24, // ICU antigas emitem "24" à meia-noite
    mi: get("minute"),
    ss: get("second"),
  };
}

function partsToUtc(p: WallParts): number {
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.ss);
}

/**
 * Epoch de um horário de parede no fuso dado: chute (parede como UTC) +
 * correção pelo desvio observado. Duas passadas estabilizam em fusos com DST.
 */
export function wallTimeToEpoch(p: WallParts, tz: string): number {
  const wall = partsToUtc(p);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    guess = wall - (partsToUtc(zonedParts(guess, tz)) - guess);
  }
  return guess;
}

/** Sufixo "±HH:MM" do fuso no instante dado (ex.: "-03:00"). */
export function offsetSuffix(epochMs: number, tz: string): string {
  const offMin = Math.round((partsToUtc(zonedParts(epochMs, tz)) - epochMs) / 60000);
  const sign = offMin < 0 ? "-" : "+";
  const abs = Math.abs(offMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function emit(epochMs: number, tz: string): string {
  const p = zonedParts(epochMs, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${String(p.y).padStart(4, "0")}-${pad(p.m)}-${pad(p.d)}` +
    `T${pad(p.hh)}:${pad(p.mi)}:${pad(p.ss)}` +
    offsetSuffix(epochMs, tz)
  );
}

/**
 * Normaliza uma string de data/hora da ORIGEM para o fuso alvo (Brasília).
 * Só faz sentido para valores DATETIME — campo de calendário puro (date-only)
 * passa inalterado, e quem chama decide pelo tipo do campo (Bitrix `date`
 * nunca deve ser convertido, mesmo que venha com hora zerada da origem).
 */
export function normalizeDateString(
  value: string,
  sourceTz: string | null | undefined,
  targetTz: string = BRASILIA_TZ
): string {
  if (!sourceTz) return value;
  if (DATE_ONLY_RE.test(value)) return value;
  try {
    // Valida o fuso ANTES de qualquer caminho (inclusive o de offset, que não
    // precisaria dele p/ resolver o instante): fuso inválido = passthrough
    // TOTAL, nunca conversão parcial (offset converte, naive não).
    fmtFor(sourceTz);
    let epoch: number;
    if (OFFSET_RE.test(value)) {
      epoch = Date.parse(value.replace(" ", "T"));
    } else {
      const m = NAIVE_RE.exec(value);
      if (!m) return value;
      const p: WallParts = {
        y: Number(m[1]),
        m: Number(m[2]),
        d: Number(m[3]),
        hh: Number(m[4]),
        mi: Number(m[5]),
        ss: Number(m[6] ?? 0),
      };
      // Sentinelas tipo "0000-00-00 00:00:00" casam o regex mas não são datas.
      if (p.y < 1 || p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31) return value;
      epoch = wallTimeToEpoch(p, sourceTz);
    }
    if (Number.isNaN(epoch)) return value;
    return emit(epoch, targetTz);
  } catch {
    return value;
  }
}
