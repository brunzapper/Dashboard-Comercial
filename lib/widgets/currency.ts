// Versão: 2.0 | Data: 12/07/2026
// Formatação e CONVERSÃO monetária. Cada registro tem uma coluna `currency`
// (código ISO: "BRL", "USD", …) vinda do Bitrix; campos personalizados 'moeda'
// e 'calculado'-moeda carregam sua própria moeda (currency_code/currency_mode).
// v2.0 (12/07/2026): sistema de conversão — moedas do sistema (habilitáveis) +
//   taxas por ano/trimestre (base = Real). Base R$; taxa = R$ por 1 unidade da
//   moeda estrangeira. Converter = valor × taxa. Também: resolveFieldMoney (a
//   moeda efetiva de um campo) e formatMoneyDisplay (modos original/convertido/
//   referência US$→R$).

// Opções do select de edição da coluna `currency` (registros individuais e a tela
// de Registros). O `value` é o código ISO gravado (e enviado ao Bitrix no
// write-back via CURRENCY_ID). É também o fallback quando a tabela `currencies`
// ainda não foi semeada/carregada.
export const CURRENCY_OPTIONS: { value: string; label: string }[] = [
  { value: "BRL", label: "Real (R$)" },
  { value: "USD", label: "Dólar (US$)" },
  { value: "EUR", label: "Euro (€)" },
  { value: "GBP", label: "Libra (£)" },
  { value: "ARS", label: "Peso argentino ($)" },
];

// Moeda base do sistema: tudo converte para Real.
export const BASE_CURRENCY = "BRL";
// Moeda de referência da exibição "com referência" (US$ original → R$ convertido).
export const REFERENCE_CURRENCY = "USD";

// Código de moeda efetivo: usa o do registro quando é um código ISO de 3 letras;
// senão cai no BRL (comportamento legado).
export function resolveCurrencyCode(code?: string | null): string {
  const c = (code ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : "BRL";
}

/**
 * Formata um valor monetário na moeda informada. `value` pode ser number,
 * string numérica ou null; retorna "—" quando não é um número finito.
 */
export function formatMoney(value: unknown, currencyCode?: string | null): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: resolveCurrencyCode(currencyCode),
  });
}

// ===================== Moedas do sistema + taxas ==============================

export interface SystemCurrency {
  code: string;
  label: string;
  enabled: boolean;
  sort_order: number;
}

// Taxas achatadas para trafegar server→client como objeto simples. Chave =
// `${code}:${year}:${quarter}` (quarter 0 = anual; 1..4 = trimestral).
export type CurrencyRates = Record<string, number>;

export function rateKey(code: string, year: number, quarter = 0): string {
  return `${resolveCurrencyCode(code)}:${year}:${quarter}`;
}

type Db = import("@supabase/supabase-js").SupabaseClient;

/** Moedas habilitadas (para os seletores de campo/métrica). */
export async function loadEnabledCurrencies(
  db: Db
): Promise<SystemCurrency[]> {
  const { data } = await db.from("currencies").select("code, label, enabled, sort_order");
  const rows = (data ?? []) as SystemCurrency[];
  const enabled = rows.filter((r) => r.enabled);
  const list = enabled.length > 0 ? enabled : fallbackCurrencies();
  return list.sort((a, b) => a.sort_order - b.sort_order);
}

/** Todas as moedas (para a tela de Configurações → Moedas). */
export async function loadAllCurrencies(db: Db): Promise<SystemCurrency[]> {
  const { data } = await db.from("currencies").select("code, label, enabled, sort_order");
  const rows = (data ?? []) as SystemCurrency[];
  const list = rows.length > 0 ? rows : fallbackCurrencies();
  return list.sort((a, b) => a.sort_order - b.sort_order);
}

function fallbackCurrencies(): SystemCurrency[] {
  return CURRENCY_OPTIONS.map((o, i) => ({
    code: o.value,
    label: o.label,
    enabled: o.value === "BRL" || o.value === "USD",
    sort_order: i,
  }));
}

/** Carrega as taxas (currency_rates) num mapa achatado. */
export async function loadCurrencyRates(db: Db): Promise<CurrencyRates> {
  const { data } = await db.from("currency_rates").select("code, year, quarter, rate");
  const out: CurrencyRates = {};
  for (const r of (data ?? []) as {
    code: string;
    year: number;
    quarter: number;
    rate: number | string;
  }[]) {
    out[rateKey(r.code, r.year, r.quarter)] = Number(r.rate);
  }
  return out;
}

/** Opções `{value,label}` das moedas habilitadas (para Combobox). */
export function currencyOptionsFrom(
  currencies: SystemCurrency[]
): { value: string; label: string }[] {
  return currencies.map((c) => ({ value: c.code, label: c.label }));
}

/**
 * Taxa (R$ por 1 unidade) da moeda no ano/trimestre. Usa a taxa do trimestre se
 * preenchida; senão cai na anual. BRL = 1. Retorna null quando não há taxa.
 */
export function resolveRate(
  rates: CurrencyRates,
  code: string,
  year: number,
  quarter = 0
): number | null {
  const c = resolveCurrencyCode(code);
  if (c === BASE_CURRENCY) return 1;
  if (quarter && quarter >= 1 && quarter <= 4) {
    const q = rates[rateKey(c, year, quarter)];
    if (Number.isFinite(q)) return q;
  }
  const annual = rates[rateKey(c, year, 0)];
  return Number.isFinite(annual) ? annual : null;
}

/**
 * Converte um valor para Real (base). BRL passa direto; sem taxa disponível
 * retorna null (não engana com o valor cru). `year`/`quarter` escolhem a taxa.
 */
export function convertToBRL(
  amount: number | null | undefined,
  code: string,
  rates: CurrencyRates,
  year: number,
  quarter = 0
): number | null {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const n = Number(amount);
  const c = resolveCurrencyCode(code);
  if (c === BASE_CURRENCY) return n;
  const rate = resolveRate(rates, c, year, quarter);
  return rate == null ? null : n * rate;
}

/**
 * Converte um valor de uma moeda para outra (ponte via Real). Mesma moeda passa
 * direto; sem taxa disponível para qualquer lado retorna null.
 */
export function convertCurrency(
  amount: number | null | undefined,
  from: string,
  to: string,
  rates: CurrencyRates,
  year: number,
  quarter = 0
): number | null {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const n = Number(amount);
  const f = resolveCurrencyCode(from);
  const tgt = resolveCurrencyCode(to);
  if (f === tgt) return n;
  const brl = convertToBRL(n, f, rates, year, quarter);
  if (brl == null) return null;
  if (tgt === BASE_CURRENCY) return brl;
  const rateTo = resolveRate(rates, tgt, year, quarter);
  return rateTo == null || rateTo === 0 ? null : brl / rateTo;
}

/** Ano e trimestre (1..4) de uma data ISO; hoje como fallback. */
export function yearQuarterOf(dateIso?: string | null): {
  year: number;
  quarter: number;
} {
  const s = (dateIso ?? "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) {
    const d = new Date();
    return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
  }
  const mo = Number(m[2]);
  return { year: Number(m[1]), quarter: Math.floor((mo - 1) / 3) + 1 };
}

// ===================== Moeda efetiva de um campo ==============================

// Forma mínima de um FieldDefinition p/ resolver a moeda (evita ciclo de import).
export interface FieldMoneyInput {
  data_type: string;
  currency_code?: string | null;
  currency_mode?: string | null;
}

export interface FieldMoney {
  isMoney: boolean;
  // Código da moeda quando isMoney; para calc 'inherit' vem da moeda do registro.
  code: string;
}

/**
 * Moeda efetiva de um campo para EXIBIÇÃO:
 * - 'moeda'      → currency_code (default BRL).
 * - 'calculado'  → currency_mode: 'inherit' usa a moeda do registro; 'fixed' usa
 *                  currency_code; ausente = não é moeda (número puro).
 * - demais       → não é moeda.
 */
export function resolveFieldMoney(
  field: FieldMoneyInput,
  recordCurrency?: string | null
): FieldMoney {
  if (field.data_type === "moeda") {
    return { isMoney: true, code: resolveCurrencyCode(field.currency_code) };
  }
  if (field.data_type === "calculado") {
    if (field.currency_mode === "inherit") {
      return { isMoney: true, code: resolveCurrencyCode(recordCurrency) };
    }
    if (field.currency_mode === "fixed") {
      return { isMoney: true, code: resolveCurrencyCode(field.currency_code) };
    }
  }
  return { isMoney: false, code: BASE_CURRENCY };
}

// ===================== Modos de exibição de moeda =============================

// Uma única moeda estrangeira: só original / só convertido (R$) / US$→R$.
export type CurrencyDisplay = "original" | "converted" | "reference";
// Várias moedas num grupo/KPI/total: converter tudo / separados / US$→R$.
export type CurrencyMultiMode = "convert" | "separate" | "reference";
// Total geral: total convertido (R$) ou total em US$ separado.
export type GrandTotalMode = "converted" | "dollar";
// Qual taxa aplicar: ano/trimestre do registro ou do período do dashboard.
export interface ConversionBasis {
  source: "record" | "period";
  granularity: "year" | "quarter";
}

/** Expressa um valor (em `code`) na moeda de referência (US$), via ponte R$. */
export function toReferenceUSD(
  amount: number,
  code: string,
  rates: CurrencyRates,
  year: number,
  quarter = 0
): number | null {
  const brl = convertToBRL(amount, code, rates, year, quarter);
  if (brl == null) return null;
  const usdRate = resolveRate(rates, REFERENCE_CURRENCY, year, quarter);
  if (usdRate == null || usdRate === 0) return null;
  return brl / usdRate;
}

/**
 * Formata um valor monetário (na moeda `code`) conforme o modo de moeda única.
 * `original` = na própria moeda; `converted` = R$; `reference` = US$ → R$.
 * Sem taxa disponível (convertido/referência) cai no valor original.
 */
export function formatMoneyDisplay(
  amount: number | null | undefined,
  code: string,
  mode: CurrencyDisplay,
  rates: CurrencyRates,
  year: number,
  quarter = 0
): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  const c = resolveCurrencyCode(code);
  // Real ou modo "original" → uma moeda só, sem conversão.
  if (mode === "original" || c === BASE_CURRENCY) return formatMoney(amount, c);
  const brl = convertToBRL(amount, c, rates, year, quarter);
  if (brl == null) return formatMoney(amount, c); // sem taxa: mostra o original
  if (mode === "converted") return formatMoney(brl, BASE_CURRENCY);
  // reference: US$ original → R$ convertido
  const usd = toReferenceUSD(amount, c, rates, year, quarter);
  const left = usd == null ? formatMoney(amount, c) : formatMoney(usd, REFERENCE_CURRENCY);
  return `${left} → ${formatMoney(brl, BASE_CURRENCY)}`;
}
