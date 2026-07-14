// Versão: 2.1 | Data: 14/07/2026
// Formatação e CONVERSÃO monetária. Cada registro tem uma coluna `currency`
// (código ISO: "BRL", "USD", …) vinda do Bitrix; campos personalizados 'moeda'
// e 'calculado'-moeda carregam sua própria moeda (currency_code/currency_mode).
// v2.0 (12/07/2026): sistema de conversão — moedas do sistema (habilitáveis) +
//   taxas por ano/trimestre (base = Real). Base R$; taxa = R$ por 1 unidade da
//   moeda estrangeira. Converter = valor × taxa. Também: resolveFieldMoney (a
//   moeda efetiva de um campo) e formatMoneyDisplay (modos original/convertido/
//   referência US$→R$).
// v2.1 (14/07/2026): campos 'moeda' também suportam currency_mode='inherit'
//   (moeda do registro) — agora o padrão; 'fixed'/null = moeda fixa (legado).

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
 * Taxa (R$ por 1 unidade) da moeda no ano/trimestre. Prioridade: trimestre pedido
 * do ano → anual do ano. Faltando taxa nesse ano, cai para o **ano mais recente**
 * cadastrado da moeda (anual → trimestre pedido → qualquer trimestre) — assim
 * nenhum valor fica sem conversão por falta de taxa no ano exato (nem quando só há
 * taxas trimestrais). BRL = 1. Retorna null só quando a moeda não tem taxa alguma.
 */
export function resolveRate(
  rates: CurrencyRates,
  code: string,
  year: number,
  quarter = 0
): number | null {
  const c = resolveCurrencyCode(code);
  if (c === BASE_CURRENCY) return 1;
  // Ano exato: trimestre pedido → anual.
  if (quarter >= 1 && quarter <= 4) {
    const q = rates[rateKey(c, year, quarter)];
    if (Number.isFinite(q)) return q;
  }
  const annual = rates[rateKey(c, year, 0)];
  if (Number.isFinite(annual)) return annual;

  // Fallback: ano mais recente com qualquer taxa desta moeda.
  const prefix = `${c}:`;
  let latestYear = -Infinity;
  for (const k of Object.keys(rates)) {
    if (!k.startsWith(prefix)) continue;
    const y = Number(k.split(":")[1]);
    if (Number.isFinite(y) && y > latestYear) latestYear = y;
  }
  if (latestYear === -Infinity) return null;
  const lAnnual = rates[rateKey(c, latestYear, 0)];
  if (Number.isFinite(lAnnual)) return lAnnual;
  if (quarter >= 1 && quarter <= 4) {
    const lq = rates[rateKey(c, latestYear, quarter)];
    if (Number.isFinite(lq)) return lq;
  }
  for (let q = 1; q <= 4; q++) {
    const lq = rates[rateKey(c, latestYear, q)];
    if (Number.isFinite(lq)) return lq;
  }
  return null;
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
  field_key?: string;
  currency_code?: string | null;
  currency_mode?: string | null;
}

export interface FieldMoney {
  isMoney: boolean;
  // Código da moeda quando isMoney; para calc 'inherit' vem do carimbo por valor
  // (custom_fields "<key>__cur") ou, na ausência dele, da moeda do registro.
  code: string;
}

// Carimbo de moeda por VALOR de um campo 'calculado'-automático: chave irmã em
// custom_fields ("<field_key>__cur" → "USD"). O valor do campo continua número
// puro; o carimbo diz em que moeda o resultado foi materializado (a moeda única
// dos operandos, ou BRL quando a fórmula misturou moedas). `slugify` nunca gera
// "__" em field_keys, então o sufixo não colide com campos reais.
export const CALC_CURRENCY_SUFFIX = "__cur";
export function calcCurrencyKey(fieldKey: string): string {
  return `${fieldKey}${CALC_CURRENCY_SUFFIX}`;
}

// Código ISO válido vindo de um carimbo/valor desconhecido; senão null.
export function validCurrencyStamp(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

/**
 * Moeda efetiva de um campo para EXIBIÇÃO:
 * - 'moeda'      → currency_mode 'inherit' usa a moeda do registro (sem moeda =
 *                  BRL); 'fixed'/null (legado) usa currency_code (default BRL).
 * - 'calculado'  → currency_mode: 'inherit' (automática) usa o carimbo por valor
 *                  (`stampedCode`, gravado em custom_fields "<key>__cur") e cai
 *                  na moeda do registro quando ausente (valores pré-recálculo);
 *                  'fixed' usa currency_code; ausente = não é moeda (número puro).
 * - demais       → não é moeda.
 */
export function resolveFieldMoney(
  field: FieldMoneyInput,
  recordCurrency?: string | null,
  stampedCode?: unknown
): FieldMoney {
  if (field.data_type === "moeda") {
    if (field.currency_mode === "inherit") {
      return { isMoney: true, code: resolveCurrencyCode(recordCurrency) };
    }
    return { isMoney: true, code: resolveCurrencyCode(field.currency_code) };
  }
  if (field.data_type === "calculado") {
    if (field.currency_mode === "inherit") {
      const stamp = validCurrencyStamp(stampedCode);
      return { isMoney: true, code: stamp ?? resolveCurrencyCode(recordCurrency) };
    }
    if (field.currency_mode === "fixed") {
      return { isMoney: true, code: resolveCurrencyCode(field.currency_code) };
    }
  }
  return { isMoney: false, code: BASE_CURRENCY };
}

/**
 * `resolveFieldMoney` lendo o carimbo por valor direto do registro (conveniência
 * p/ células/tabelas que têm o RecordRow em mãos).
 */
export function resolveFieldMoneyFromRecord(
  field: FieldMoneyInput,
  record: {
    currency?: string | null;
    custom_fields?: Record<string, unknown> | null;
  }
): FieldMoney {
  const stamp = field.field_key
    ? record.custom_fields?.[calcCurrencyKey(field.field_key)]
    : undefined;
  return resolveFieldMoney(field, record.currency, stamp);
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

// ===================== Agregação monetária (compartilhada) ====================
// Detalhamento de um recorte (grupo/KPI/total) sobre um conjunto de valores: soma
// por moeda + já convertido para Real + em referência US$ + contagem (p/ média).
// É a "moeda intermediária" entre o caminho de registros individuais e o agregado:
// os dois montam este objeto (registro a registro OU a partir de subtotais SQL) e
// o formatam pelo MESMO `formatMoneyAggregate`, garantindo saída idêntica. JSON puro
// (trafega server→client no WidgetData).
export interface MoneyBreakdown {
  perCurrency: Record<string, number>;
  brl: number;
  usd: number;
  count: number;
}

// Config de moeda de uma métrica p/ formatar o agregado (subconjunto de Metric /
// KpiSettings — tipado à parte p/ evitar ciclo de import com types.ts).
export interface MoneyAggConfig {
  agg: string; // "sum" | "count" | "avg"
  currencyDisplay?: CurrencyDisplay;
  currencyMultiMode?: CurrencyMultiMode;
  grandTotalMode?: GrandTotalMode;
}

export function emptyBreakdown(): MoneyBreakdown {
  return { perCurrency: {}, brl: 0, usd: 0, count: 0 };
}

/**
 * Monta um `MoneyBreakdown` a partir de um conjunto de registros crus, acumulando
 * o valor de cada um por moeda + convertido (R$) + referência (US$), convertendo
 * cada registro pela taxa do seu próprio ano/trimestre. É a lógica compartilhada
 * entre o modo "registros individuais" (record-list-table `metricAggText`) e o
 * agregado por período (engine `runWidgetByPeriod`), garantindo saída idêntica
 * quando os dois formatam pelo MESMO `formatMoneyAggregate` — tudo client-side,
 * sem depender do RPC. `rawValue`/`codeOf`/`yqOf` são resolvidos pelo chamador
 * (dependem da métrica: campo, moeda efetiva e base da taxa).
 */
export function buildRecordBreakdown<T>(
  records: T[],
  rawValue: (r: T) => unknown,
  codeOf: (r: T) => string,
  yqOf: (r: T) => { year: number; quarter: number },
  rates: CurrencyRates
): MoneyBreakdown {
  const bd = emptyBreakdown();
  for (const r of records) {
    const raw = Number(rawValue(r));
    if (!Number.isFinite(raw)) continue;
    bd.count += 1;
    const code = codeOf(r);
    bd.perCurrency[code] = (bd.perCurrency[code] ?? 0) + raw;
    const { year, quarter } = yqOf(r);
    const b = convertToBRL(raw, code, rates, year, quarter);
    if (b != null) bd.brl += b;
    const u = toReferenceUSD(raw, code, rates, year, quarter);
    if (u != null) bd.usd += u;
  }
  return bd;
}

/** Funde vários detalhamentos num só (subtotais de grupo / Total geral). */
export function foldBreakdowns(list: (MoneyBreakdown | undefined)[]): MoneyBreakdown {
  const out = emptyBreakdown();
  for (const b of list) {
    if (!b) continue;
    for (const [code, amt] of Object.entries(b.perCurrency)) {
      out.perCurrency[code] = (out.perCurrency[code] ?? 0) + amt;
    }
    out.brl += b.brl;
    out.usd += b.usd;
    out.count += b.count;
  }
  return out;
}

// Código quando o recorte tem UMA única moeda; senão null. Usado p/ decidir se um
// gráfico mantém a moeda estrangeira (moeda única) ou converte p/ R$ (misturado).
export function plotSingleCurrency(b: MoneyBreakdown): string | null {
  const codes = Object.keys(b.perCurrency);
  return codes.length === 1 ? codes[0] : null;
}

/**
 * Formata um detalhamento agregado conforme os modos de moeda da métrica. Lógica
 * idêntica ao `metricAggText` da tabela de registros (a fonte da verdade):
 * - `isGrand` (Total geral): converte tudo (R$) ou soma em US$ separado.
 * - moeda única: respeita `currencyDisplay` (original / convertido R$ / US$→R$).
 * - várias moedas: respeita `currencyMultiMode` (separado / referência / converter).
 * `avg` divide pela contagem. Reusa `formatMoney`.
 */
export function formatMoneyAggregate(
  b: MoneyBreakdown,
  cfg: MoneyAggConfig,
  isGrand = false
): string {
  const div = (v: number) => (cfg.agg === "avg" && b.count > 0 ? v / b.count : v);
  if (isGrand) {
    return cfg.grandTotalMode === "dollar"
      ? formatMoney(div(b.usd), "USD")
      : formatMoney(div(b.brl), "BRL");
  }
  const codes = Object.keys(b.perCurrency);
  if (codes.length <= 1) {
    const code = codes[0] ?? "BRL";
    const disp = cfg.currencyDisplay ?? "original";
    if (code === "BRL" || disp === "original") {
      return formatMoney(div(b.perCurrency[code] ?? 0), code);
    }
    if (disp === "converted") return formatMoney(div(b.brl), "BRL");
    return `${formatMoney(div(b.usd), "USD")} → ${formatMoney(div(b.brl), "BRL")}`;
  }
  // Várias moedas no grupo.
  switch (cfg.currencyMultiMode ?? "convert") {
    case "separate":
      return codes.map((c) => formatMoney(div(b.perCurrency[c]), c)).join(" · ");
    case "reference":
      return `${formatMoney(div(b.usd), "USD")} → ${formatMoney(div(b.brl), "BRL")}`;
    case "convert":
    default:
      return formatMoney(div(b.brl), "BRL");
  }
}
