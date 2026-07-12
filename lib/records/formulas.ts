// Versão: 1.0 | Data: 09/07/2026
// Campos calculados (Fase 7): modelo de fórmula estruturada + avaliador puro
// (shunting-yard → RPN, SEM eval) usado para materializar o valor por registro.
// Operandos são referências a colunas numéricas ('value','mrr','lead_time_days')
// ou campos personalizados numéricos ('custom:<key>') e constantes. Operadores
// + − × ÷ com precedência e parênteses. Null-safe: operando ausente/não-numérico
// ou divisão por zero => resultado null (não engana com zero).

import {
  convertCurrency,
  loadCurrencyRates,
  resolveCurrencyCode,
  yearQuarterOf,
  type CurrencyRates,
} from "@/lib/widgets/currency";

export type FormulaOp = "+" | "-" | "*" | "/";

export type FormulaToken =
  | { kind: "field"; ref: string }
  | { kind: "const"; value: number }
  | { kind: "op"; op: FormulaOp }
  | { kind: "lparen" }
  | { kind: "rparen" };

export interface Formula {
  tokens: FormulaToken[];
}

const PRECEDENCE: Record<FormulaOp, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

const DAY_MS = 86_400_000;

// Colunas de data do núcleo aceitas como operandos de data em campos calculados.
export const CORE_DATE_REFS = [
  "closed_at",
  "opened_at",
  "source_created_at",
] as const;

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Data (qualquer valor parseável) → epoch ms; null quando ausente/ inválida.
function toMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

/**
 * Contexto de DATAS (ref → epoch ms) de um registro para o avaliador: datas do
 * próprio registro + campos personalizados do tipo `data` (por chave). Refs de
 * `match:<fonte>:<data>` são acrescentados por quem resolve o registro casado
 * (ver lib/records/recalc.ts).
 */
export function buildDateContext(
  rec: {
    closed_at?: string | null;
    opened_at?: string | null;
    source_created_at?: string | null;
  },
  customFields: Record<string, unknown>,
  customDateKeys: Iterable<string>
): Record<string, number | null> {
  const ctx: Record<string, number | null> = {
    closed_at: toMs(rec.closed_at),
    opened_at: toMs(rec.opened_at),
    source_created_at: toMs(rec.source_created_at),
  };
  for (const key of customDateKeys) ctx[`custom:${key}`] = toMs(customFields[key]);
  return ctx;
}

/** Referências (refs) usadas por uma fórmula — útil para validação/recompute. */
export function formulaRefs(formula: Formula): string[] {
  return formula.tokens
    .filter((t): t is { kind: "field"; ref: string } => t.kind === "field")
    .map((t) => t.ref);
}

// Valor tipado na pilha do avaliador: número puro ou DATA (ms). O tipo permite
// `data − data → dias` sem confundir com uma subtração numérica comum.
type Val = { v: number | null; date: boolean };

/**
 * Avalia a fórmula contra um contexto ref→valor. `dateCtx` (ref → epoch ms)
 * marca operandos de DATA: `data − data` resulta em DIAS; qualquer outra
 * combinação envolvendo data resulta em null; número op número inalterado. Um
 * resultado que sobra como data também vira null (o campo calculado é numérico).
 * Qualquer operando null/NaN ou divisão por zero propaga null. Retrocompatível:
 * sem `dateCtx`, comportamento idêntico ao anterior (tudo numérico).
 */
export function evaluateFormula(
  formula: Formula,
  ctx: Record<string, number | null>,
  dateCtx?: Record<string, number | null>
): number | null {
  const output: Val[] = [];
  const ops: (FormulaOp | "(")[] = [];

  const applyTop = () => {
    const op = ops.pop();
    if (op === "(" || op === undefined) return;
    const b = output.pop();
    const a = output.pop();
    if (!a || !b || a.v == null || b.v == null) {
      output.push({ v: null, date: false });
      return;
    }
    // data − data → dias
    if (op === "-" && a.date && b.date) {
      const r = Math.round((a.v - b.v) / DAY_MS);
      output.push({ v: Number.isFinite(r) ? r : null, date: false });
      return;
    }
    // Qualquer outra operação envolvendo data é inválida → null.
    if (a.date || b.date) {
      output.push({ v: null, date: false });
      return;
    }
    let r: number | null;
    switch (op) {
      case "+": r = a.v + b.v; break;
      case "-": r = a.v - b.v; break;
      case "*": r = a.v * b.v; break;
      case "/": r = b.v === 0 ? null : a.v / b.v; break;
      default: r = null;
    }
    output.push({ v: r != null && Number.isFinite(r) ? r : null, date: false });
  };

  for (const t of formula.tokens) {
    if (t.kind === "field") {
      if (dateCtx && Object.prototype.hasOwnProperty.call(dateCtx, t.ref)) {
        output.push({ v: dateCtx[t.ref] ?? null, date: true });
      } else {
        output.push({ v: ctx[t.ref] ?? null, date: false });
      }
    } else if (t.kind === "const") {
      output.push({ v: Number.isFinite(t.value) ? t.value : null, date: false });
    } else if (t.kind === "op") {
      while (
        ops.length > 0 &&
        ops[ops.length - 1] !== "(" &&
        PRECEDENCE[ops[ops.length - 1] as FormulaOp] >= PRECEDENCE[t.op]
      ) {
        applyTop();
      }
      ops.push(t.op);
    } else if (t.kind === "lparen") {
      ops.push("(");
    } else if (t.kind === "rparen") {
      while (ops.length > 0 && ops[ops.length - 1] !== "(") applyTop();
      ops.pop(); // remove '('
    }
  }
  while (ops.length > 0) applyTop();

  if (output.length !== 1) return null;
  const res = output[0];
  return res.date ? null : res.v;
}

export interface FormulaValidation {
  ok: boolean;
  error?: string;
}

/**
 * Valida a estrutura da fórmula: operandos/operadores alternados, parênteses
 * balanceados e refs conhecidas. `allowedRefs` deve conter APENAS colunas
 * numéricas que NÃO sejam campos calculados (evita dependência circular).
 */
export function validateFormula(
  formula: Formula,
  allowedRefs: Set<string>,
  allowedDateRefs?: Set<string>
): FormulaValidation {
  const tokens = formula.tokens;
  if (!tokens || tokens.length === 0) {
    return { ok: false, error: "A fórmula está vazia." };
  }
  let expectOperand = true;
  let depth = 0;
  for (const t of tokens) {
    if (expectOperand) {
      if (t.kind === "field") {
        if (!allowedRefs.has(t.ref) && !allowedDateRefs?.has(t.ref)) {
          return { ok: false, error: `Coluna inválida na fórmula: ${t.ref}` };
        }
        expectOperand = false;
      } else if (t.kind === "const") {
        if (!Number.isFinite(t.value)) {
          return { ok: false, error: "Constante numérica inválida." };
        }
        expectOperand = false;
      } else if (t.kind === "lparen") {
        depth += 1;
      } else {
        return { ok: false, error: "Esperava uma coluna/número ou '('." };
      }
    } else {
      if (t.kind === "op") {
        expectOperand = true;
      } else if (t.kind === "rparen") {
        depth -= 1;
        if (depth < 0) return { ok: false, error: "Parênteses desbalanceados." };
      } else {
        return { ok: false, error: "Esperava um operador (+ − × ÷) ou ')'." };
      }
    }
  }
  if (expectOperand) return { ok: false, error: "A fórmula termina de forma incompleta." };
  if (depth !== 0) return { ok: false, error: "Parênteses desbalanceados." };
  return { ok: true };
}

export interface FormulaFieldDef {
  field_key: string;
  formula: Formula | null;
  // Moeda do resultado (12/07/2026): 'inherit' = moeda do registro; 'fixed' =
  // currency_code; ausente = número puro (sem conversão).
  currency_mode?: string | null;
  currency_code?: string | null;
}

/** Chaves dos campos personalizados do tipo `data` (para o contexto de datas). */
export async function loadCustomDateKeys(
  db: import("@supabase/supabase-js").SupabaseClient
): Promise<string[]> {
  const { data } = await db
    .from("field_definitions")
    .select("field_key")
    .eq("data_type", "data");
  return (data ?? []).map((r) => r.field_key as string);
}

/** Carrega as definições de campos calculados (data_type='calculado'). */
export async function loadFormulaDefs(
  db: import("@supabase/supabase-js").SupabaseClient
): Promise<FormulaFieldDef[]> {
  const { data } = await db
    .from("field_definitions")
    .select("field_key, formula, currency_mode, currency_code")
    .eq("data_type", "calculado");
  return (data ?? [])
    .map((r) => ({
      field_key: r.field_key as string,
      formula: (r.formula as Formula | null) ?? null,
      currency_mode: (r.currency_mode as string | null) ?? null,
      currency_code: (r.currency_code as string | null) ?? null,
    }))
    .filter((d) => d.formula != null);
}

// Contexto de conversão de moeda de um registro (para materializar calc-fields).
export interface FormulaCurrencyContext {
  recordCurrency: string; // moeda do registro (value/mrr)
  year: number;
  quarter: number; // 0 = anual; 1..4
  rates: CurrencyRates;
  // Moeda de cada operando monetário: ref → código ISO (só refs monetárias).
  operandCurrency: Record<string, string>;
}

// Insumos de câmbio compartilhados: taxas + moeda de cada campo 'moeda'.
export interface CurrencyMaterials {
  rates: CurrencyRates;
  moedaCurrency: Record<string, string>; // 'custom:<key>' → ISO
}

/** True quando algum calc-field é monetário (precisa de conversão). */
export function anyMoneyDef(defs: FormulaFieldDef[]): boolean {
  return defs.some(
    (d) => d.currency_mode === "inherit" || d.currency_mode === "fixed"
  );
}

/** Carrega taxas + a moeda de cada campo personalizado 'moeda'. */
export async function loadCurrencyMaterials(
  db: import("@supabase/supabase-js").SupabaseClient
): Promise<CurrencyMaterials> {
  const rates = await loadCurrencyRates(db);
  const { data } = await db
    .from("field_definitions")
    .select("field_key, currency_code")
    .eq("data_type", "moeda");
  const moedaCurrency: Record<string, string> = {};
  for (const f of data ?? []) {
    moedaCurrency[`custom:${f.field_key as string}`] = resolveCurrencyCode(
      f.currency_code as string | null
    );
  }
  return { rates, moedaCurrency };
}

/** Monta o contexto de conversão de um registro a partir dos insumos. */
export function buildRecordCurrencyContext(
  rec: {
    currency?: string | null;
    closed_at?: string | null;
    opened_at?: string | null;
    source_created_at?: string | null;
  },
  mats: CurrencyMaterials
): FormulaCurrencyContext {
  const recCur = resolveCurrencyCode(rec.currency);
  const { year, quarter } = yearQuarterOf(
    rec.closed_at ?? rec.opened_at ?? rec.source_created_at
  );
  return {
    recordCurrency: recCur,
    year,
    quarter,
    rates: mats.rates,
    operandCurrency: { value: recCur, mrr: recCur, ...mats.moedaCurrency },
  };
}

/**
 * Materializa todos os campos calculados de um registro. Monta o contexto a
 * partir das colunas numéricas do núcleo + dos custom_fields já resolvidos e
 * avalia cada def. Retorna um mapa field_key → número|null para mesclar em
 * custom_fields. Campos calculados não entram no contexto como operandos.
 */
export function computeFormulaFields(
  coreValues: Record<string, number | null>,
  customFields: Record<string, unknown>,
  formulaDefs: FormulaFieldDef[],
  conv?: FormulaCurrencyContext,
  dateCtx?: Record<string, number | null>
): Record<string, number | null> {
  const baseCtx: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(coreValues)) baseCtx[k] = v;
  for (const [k, v] of Object.entries(customFields)) baseCtx[`custom:${k}`] = toNum(v);

  const out: Record<string, number | null> = {};
  for (const def of formulaDefs) {
    if (!def.formula) continue;
    // Fórmula que usa um operando `match:` ainda não resolvido no dateCtx é
    // PULADA (não entra em `out`) — deixa o valor anterior intacto. Assim o sync
    // incremental não zera campos baseados em registro casado; eles são
    // materializados no recalc em lote (lib/records/recalc.ts).
    const hasUnresolvedMatch = formulaRefs(def.formula).some(
      (r) =>
        r.startsWith("match:") &&
        !(dateCtx && Object.prototype.hasOwnProperty.call(dateCtx, r))
    );
    if (hasUnresolvedMatch) continue;
    // Campo calculado monetário: converte cada operando monetário para a moeda
    // de destino (herdada do registro ou fixa) antes de avaliar. Assim, ao
    // envolver moedas diferentes, o cálculo é feito já convertido.
    const isMoney = def.currency_mode === "inherit" || def.currency_mode === "fixed";
    if (conv && isMoney) {
      const target =
        def.currency_mode === "fixed"
          ? def.currency_code ?? "BRL"
          : conv.recordCurrency;
      out[def.field_key] = evaluateFormula(
        def.formula,
        convertOperands(baseCtx, target, conv),
        dateCtx
      );
    } else {
      out[def.field_key] = evaluateFormula(def.formula, baseCtx, dateCtx);
    }
  }
  return out;
}

// Converte os operandos monetários do contexto para a moeda `target` (ponte via
// Real). Operandos não-monetários (sem entrada em operandCurrency) passam iguais.
function convertOperands(
  baseCtx: Record<string, number | null>,
  target: string,
  conv: FormulaCurrencyContext
): Record<string, number | null> {
  const ctx: Record<string, number | null> = {};
  for (const [ref, v] of Object.entries(baseCtx)) {
    const cur = conv.operandCurrency[ref];
    if (v == null || !cur) {
      ctx[ref] = v;
      continue;
    }
    ctx[ref] = convertCurrency(v, cur, target, conv.rates, conv.year, conv.quarter);
  }
  return ctx;
}

/** Texto legível de uma fórmula (para exibição na config). */
export function formulaToText(
  formula: Formula | null | undefined,
  labelForRef: (ref: string) => string
): string {
  if (!formula) return "";
  return formula.tokens
    .map((t) => {
      switch (t.kind) {
        case "field": return labelForRef(t.ref);
        case "const": return String(t.value);
        case "op": return t.op === "*" ? "×" : t.op === "/" ? "÷" : t.op;
        case "lparen": return "(";
        case "rparen": return ")";
      }
    })
    .join(" ");
}
