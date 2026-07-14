// Versão: 2.0 | Data: 09/07/2026
// Campos calculados (Fase 7): modelo de fórmula estruturada + avaliador puro
// (parser recursivo tokens→AST, SEM eval) usado para materializar o valor por
// registro. Operandos são referências a colunas ('value','mrr','stage',...),
// campos personalizados ('custom:<key>') e constantes. Null-safe: operando
// ausente/não-numérico em aritmética ou divisão por zero => null (não engana
// com zero).
// v2.0 (13/07/2026): condicionais estilo Google Sheets — funções SE/E/OU,
//   comparações (= <> < > <= >=), literais de texto/booleano e separador de
//   argumentos ';'. Valores tipados (número|texto|booleano|data|null); o
//   resultado materializado pode ser texto. Fórmulas legadas (só + − × ÷)
//   avaliam de forma idêntica. `Formula.source` guarda o texto digitado no
//   editor estilo Sheets (round-trip; ver lib/records/formula-text.ts).

import {
  BASE_CURRENCY,
  calcCurrencyKey,
  convertCurrency,
  loadCurrencyRates,
  resolveCurrencyCode,
  yearQuarterOf,
  type CurrencyRates,
} from "@/lib/widgets/currency";
import { todayBrasiliaMs } from "@/lib/date/today";

export type FormulaOp = "+" | "-" | "*" | "/";
export type FormulaCmpOp = "=" | "<>" | "<" | ">" | "<=" | ">=";
export type FormulaFuncName = "SE" | "E" | "OU";

export type FormulaToken =
  | { kind: "field"; ref: string }
  | { kind: "const"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "op"; op: FormulaOp }
  | { kind: "cmp"; op: FormulaCmpOp }
  | { kind: "func"; name: FormulaFuncName }
  | { kind: "argsep" }
  | { kind: "lparen" }
  | { kind: "rparen" };

export interface Formula {
  tokens: FormulaToken[];
  // Texto original digitado no editor estilo Sheets (quando a fórmula foi criada
  // por texto). Ausente em fórmulas montadas pelo construtor de botões.
  source?: string;
}

// Resultado de uma fórmula: número, texto (ramo de SE), booleano ou null.
export type FormulaResult = number | string | boolean | null;

/** True quando a fórmula usa recursos que o construtor de botões não representa
 * (funções, comparações, textos, booleanos). */
export function formulaUsesFunctions(formula: Formula | null | undefined): boolean {
  if (!formula) return false;
  return formula.tokens.some(
    (t) =>
      t.kind === "str" ||
      t.kind === "bool" ||
      t.kind === "cmp" ||
      t.kind === "func" ||
      t.kind === "argsep"
  );
}

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
    // Operando sintético "Data atual" (hoje em Brasília). Como calc-fields são
    // materializados, o valor congela no momento do cálculo — o recalc diário
    // (app/api/sync/recalc-daily) reatualiza os campos que usam `today`.
    today: todayBrasiliaMs(),
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

// --- Parser: tokens → AST (recursivo, com precedência) -----------------------
// Gramática (menor → maior precedência):
//   expression := additive ( CMP additive )?         (comparação não associativa)
//   additive   := multiplicative ( (+|-) multiplicative )*
//   multiplicative := unary ( (*|/) unary )*
//   unary      := '-' unary | primary
//   primary    := const | str | bool | field | FUNC '(' expr (';' expr)* ')' | '(' expr ')'

type FormulaNode =
  | { k: "lit"; v: number | string | boolean }
  | { k: "ref"; ref: string }
  | { k: "neg"; a: FormulaNode }
  | { k: "bin"; op: FormulaOp; a: FormulaNode; b: FormulaNode }
  | { k: "cmp"; op: FormulaCmpOp; a: FormulaNode; b: FormulaNode }
  | { k: "call"; name: FormulaFuncName; args: FormulaNode[] };

class FormulaParseError extends Error {}

function parseTokens(tokens: FormulaToken[]): FormulaNode {
  if (!tokens || tokens.length === 0) {
    throw new FormulaParseError("A fórmula está vazia.");
  }
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function expression(): FormulaNode {
    const a = additive();
    const t = peek();
    if (t?.kind === "cmp") {
      next();
      const b = additive();
      if (peek()?.kind === "cmp") {
        throw new FormulaParseError(
          "Comparações encadeadas não são permitidas (use E(a > b; b > c))."
        );
      }
      return { k: "cmp", op: t.op, a, b };
    }
    return a;
  }
  function additive(): FormulaNode {
    let a = multiplicative();
    for (;;) {
      const t = peek();
      if (t?.kind === "op" && (t.op === "+" || t.op === "-")) {
        next();
        a = { k: "bin", op: t.op, a, b: multiplicative() };
      } else return a;
    }
  }
  function multiplicative(): FormulaNode {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t?.kind === "op" && (t.op === "*" || t.op === "/")) {
        next();
        a = { k: "bin", op: t.op, a, b: unary() };
      } else return a;
    }
  }
  function unary(): FormulaNode {
    const t = peek();
    if (t?.kind === "op" && t.op === "-") {
      next();
      return { k: "neg", a: unary() };
    }
    return primary();
  }
  function primary(): FormulaNode {
    const t = next();
    if (!t) throw new FormulaParseError("A fórmula termina de forma incompleta.");
    if (t.kind === "const") {
      if (!Number.isFinite(t.value)) {
        throw new FormulaParseError("Constante numérica inválida.");
      }
      return { k: "lit", v: t.value };
    }
    if (t.kind === "str") return { k: "lit", v: t.value };
    if (t.kind === "bool") return { k: "lit", v: t.value };
    if (t.kind === "field") return { k: "ref", ref: t.ref };
    if (t.kind === "func") {
      const name = t.name;
      if (next()?.kind !== "lparen") {
        throw new FormulaParseError(`Esperava '(' após ${name}.`);
      }
      const args: FormulaNode[] = [];
      if (peek()?.kind === "rparen") {
        next();
      } else {
        args.push(expression());
        while (peek()?.kind === "argsep") {
          next();
          args.push(expression());
        }
        if (next()?.kind !== "rparen") {
          throw new FormulaParseError(
            `Esperava ')' ou ';' nos argumentos de ${name}.`
          );
        }
      }
      if (name === "SE" && (args.length < 2 || args.length > 3)) {
        throw new FormulaParseError(
          "SE espera 2 ou 3 argumentos: SE(condição; então; senão)."
        );
      }
      if ((name === "E" || name === "OU") && args.length < 2) {
        throw new FormulaParseError(`${name} espera pelo menos 2 argumentos.`);
      }
      return { k: "call", name, args };
    }
    if (t.kind === "lparen") {
      const e = expression();
      if (next()?.kind !== "rparen") {
        throw new FormulaParseError("Parênteses desbalanceados.");
      }
      return e;
    }
    if (t.kind === "argsep") {
      throw new FormulaParseError("';' só pode aparecer entre argumentos de uma função.");
    }
    throw new FormulaParseError("Esperava uma coluna, número, texto ou '('.");
  }

  const root = expression();
  if (i < tokens.length) {
    throw new FormulaParseError(
      "Símbolo inesperado após o fim da fórmula (verifique operadores e parênteses)."
    );
  }
  return root;
}

// --- Avaliador tipado ---------------------------------------------------------

// Valor tipado do avaliador: número, texto, booleano ou null; `date` marca
// datas (epoch ms) e permite `data − data → dias` e comparação cronológica.
type Val = { v: number | string | boolean | null; date: boolean };

const NULL_VAL: Val = { v: null, date: false };

function toNumVal(v: Val): number | null {
  if (v.date) return null; // data em aritmética comum → null
  return toNum(v.v);
}

// Canonicaliza texto para comparação/booleano: minúsculas pt-BR, sem espaços nas
// pontas; strings booleanas viram "true"/"false" (cobre custom booleano gravado
// como "true"/"false" e literais VERDADEIRO/SIM/FALSO/NÃO digitados).
function normStr(v: string): string {
  const s = v.trim().toLocaleLowerCase("pt-BR");
  if (s === "verdadeiro" || s === "sim" || s === "true") return "true";
  if (s === "falso" || s === "não" || s === "nao" || s === "false") return "false";
  return s;
}

function asComparableString(v: number | string | boolean): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return normStr(v);
}

// Verdade de um valor (condição do SE, argumentos de E/OU). null = FALSO
// (comportamento do Sheets para célula vazia).
function truthy(val: Val): boolean {
  const v = val.v;
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return val.date ? true : v !== 0;
  const s = normStr(v);
  if (s === "true") return true;
  if (s === "false" || s === "") return false;
  const n = Number(s.replace(",", "."));
  if (Number.isFinite(n)) return n !== 0;
  return false;
}

// Igualdade tolerante a tipos: null ≡ "" ; números comparados numericamente
// (aceita string numérica); texto case-insensitive (pt-BR); booleanos
// canonicalizados ("true"/"false"). Datas comparam por ms.
function valEquals(a: Val, b: Val): boolean {
  const av = a.v === "" ? null : a.v;
  const bv = b.v === "" ? null : b.v;
  if (av == null || bv == null) return av == null && bv == null;
  if (a.date && b.date) return av === bv;
  const an = a.date ? null : toNum(av);
  const bn = b.date ? null : toNum(bv);
  if (an != null && bn != null && typeof av !== "boolean" && typeof bv !== "boolean") {
    return an === bn;
  }
  return asComparableString(av) === asComparableString(bv);
}

// Ordenação: null → null (condição falsa); datas por ms; números numericamente;
// texto por localeCompare pt-BR. Retorna negativo/zero/positivo ou null.
function valCompare(a: Val, b: Val): number | null {
  if (a.v == null || b.v == null) return null;
  if (a.date && b.date) return Number(a.v) - Number(b.v);
  const an = a.date ? null : toNum(a.v);
  const bn = b.date ? null : toNum(b.v);
  if (an != null && bn != null) return an - bn;
  return asComparableString(a.v).localeCompare(asComparableString(b.v), "pt-BR");
}

function evalNode(
  node: FormulaNode,
  ctx: Record<string, unknown>,
  dateCtx?: Record<string, number | null>
): Val {
  switch (node.k) {
    case "lit":
      return { v: node.v, date: false };
    case "ref": {
      if (dateCtx && Object.prototype.hasOwnProperty.call(dateCtx, node.ref)) {
        return { v: dateCtx[node.ref] ?? null, date: true };
      }
      const raw = ctx[node.ref];
      if (raw == null || raw === "") return NULL_VAL;
      if (
        typeof raw === "number" ||
        typeof raw === "string" ||
        typeof raw === "boolean"
      ) {
        return { v: raw, date: false };
      }
      return NULL_VAL;
    }
    case "neg": {
      const n = toNumVal(evalNode(node.a, ctx, dateCtx));
      return { v: n == null ? null : -n, date: false };
    }
    case "bin": {
      const a = evalNode(node.a, ctx, dateCtx);
      const b = evalNode(node.b, ctx, dateCtx);
      if (a.v == null || b.v == null) return NULL_VAL;
      // data − data → dias
      if (node.op === "-" && a.date && b.date) {
        const r = Math.round((Number(a.v) - Number(b.v)) / DAY_MS);
        return { v: Number.isFinite(r) ? r : null, date: false };
      }
      // Qualquer outra operação envolvendo data é inválida → null.
      if (a.date || b.date) return NULL_VAL;
      const an = toNum(a.v);
      const bn = toNum(b.v);
      if (an == null || bn == null) return NULL_VAL;
      let r: number | null;
      switch (node.op) {
        case "+": r = an + bn; break;
        case "-": r = an - bn; break;
        case "*": r = an * bn; break;
        case "/": r = bn === 0 ? null : an / bn; break;
        default: r = null;
      }
      return { v: r != null && Number.isFinite(r) ? r : null, date: false };
    }
    case "cmp": {
      const a = evalNode(node.a, ctx, dateCtx);
      const b = evalNode(node.b, ctx, dateCtx);
      if (node.op === "=") return { v: valEquals(a, b), date: false };
      if (node.op === "<>") return { v: !valEquals(a, b), date: false };
      const c = valCompare(a, b);
      if (c == null) return NULL_VAL;
      switch (node.op) {
        case "<": return { v: c < 0, date: false };
        case ">": return { v: c > 0, date: false };
        case "<=": return { v: c <= 0, date: false };
        case ">=": return { v: c >= 0, date: false };
        default: return NULL_VAL;
      }
    }
    case "call": {
      if (node.name === "SE") {
        const cond = evalNode(node.args[0], ctx, dateCtx);
        if (truthy(cond)) return evalNode(node.args[1], ctx, dateCtx);
        return node.args[2] ? evalNode(node.args[2], ctx, dateCtx) : NULL_VAL;
      }
      if (node.name === "E") {
        for (const arg of node.args) {
          if (!truthy(evalNode(arg, ctx, dateCtx))) return { v: false, date: false };
        }
        return { v: true, date: false };
      }
      // OU
      for (const arg of node.args) {
        if (truthy(evalNode(arg, ctx, dateCtx))) return { v: true, date: false };
      }
      return { v: false, date: false };
    }
  }
}

/**
 * Avalia a fórmula contra um contexto ref→valor (número, texto, booleano ou
 * null). `dateCtx` (ref → epoch ms) marca operandos de DATA: `data − data`
 * resulta em DIAS; datas comparam cronologicamente; qualquer outra aritmética
 * com data resulta em null. Operando null/NaN em aritmética ou divisão por zero
 * propaga null. Fórmula estruturalmente inválida → null (a validação forte roda
 * no salvamento via validateFormula). Retrocompatível: fórmulas legadas (só
 * + − × ÷ com números) avaliam de forma idêntica à v1.
 */
export function evaluateFormula(
  formula: Formula,
  ctx: Record<string, unknown>,
  dateCtx?: Record<string, number | null>
): FormulaResult {
  let node: FormulaNode;
  try {
    node = parseTokens(formula.tokens);
  } catch {
    return null;
  }
  const res = evalNode(node, ctx, dateCtx);
  if (res.date) return null; // resultado "cru" de data não é exibível
  if (typeof res.v === "number" && !Number.isFinite(res.v)) return null;
  return res.v;
}

export interface FormulaValidation {
  ok: boolean;
  error?: string;
}

/**
 * Valida a fórmula: estrutura (mesmo parser da avaliação, com mensagens em PT)
 * e refs conhecidas. `allowedRefs` deve conter APENAS colunas numéricas que NÃO
 * sejam campos calculados (evita dependência circular); `allowedDateRefs` as
 * datas; `allowedCondRefs` as colunas de texto/seleção/booleano permitidas em
 * condicionais (SE/E/OU e comparações).
 */
export function validateFormula(
  formula: Formula,
  allowedRefs: Set<string>,
  allowedDateRefs?: Set<string>,
  allowedCondRefs?: Set<string>
): FormulaValidation {
  try {
    parseTokens(formula.tokens);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof FormulaParseError ? e.message : "Fórmula inválida.",
    };
  }
  for (const ref of formulaRefs(formula)) {
    if (
      !allowedRefs.has(ref) &&
      !allowedDateRefs?.has(ref) &&
      !allowedCondRefs?.has(ref)
    ) {
      return { ok: false, error: `Coluna inválida na fórmula: ${ref}` };
    }
  }
  return { ok: true };
}

export interface FormulaFieldDef {
  field_key: string;
  formula: Formula | null;
  // Moeda do resultado (12/07/2026): 'inherit' = moeda do registro; 'fixed' =
  // currency_code; ausente = número puro (sem conversão).
  currency_mode?: string | null;
  currency_code?: string | null;
  // Quando false, resultado negativo é grampeado em 0 (13/07/2026).
  allow_negative?: boolean | null;
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
    .select("field_key, formula, currency_mode, currency_code, allow_negative")
    .eq("data_type", "calculado");
  return (data ?? [])
    .map((r) => ({
      field_key: r.field_key as string,
      formula: (r.formula as Formula | null) ?? null,
      currency_mode: (r.currency_mode as string | null) ?? null,
      currency_code: (r.currency_code as string | null) ?? null,
      allow_negative: (r.allow_negative as boolean | null) ?? true,
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
 * partir das colunas do núcleo (números e, para condicionais, textos/booleanos)
 * + dos custom_fields já resolvidos (valores BRUTOS — a coerção é feita por
 * operação no avaliador) e avalia cada def. Retorna um mapa field_key →
 * número|texto|booleano|null para mesclar em custom_fields. Campos calculados
 * não entram no contexto como operandos. Valores de `match:<fonte>:<ref>` não
 * datados podem vir dentro de `coreValues` chaveados pelo ref completo (ver
 * lib/records/recalc.ts).
 */
export function computeFormulaFields(
  coreValues: Record<string, unknown>,
  customFields: Record<string, unknown>,
  formulaDefs: FormulaFieldDef[],
  conv?: FormulaCurrencyContext,
  dateCtx?: Record<string, number | null>
): Record<string, FormulaResult> {
  const baseCtx: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(coreValues)) baseCtx[k] = v;
  for (const [k, v] of Object.entries(customFields)) baseCtx[`custom:${k}`] = v;

  const out: Record<string, FormulaResult> = {};
  for (const def of formulaDefs) {
    if (!def.formula) continue;
    // Fórmula que usa um operando `match:` ainda não resolvido (nem no dateCtx
    // nem no contexto de valores) é PULADA (não entra em `out`) — deixa o valor
    // anterior intacto. Assim o sync incremental não zera campos baseados em
    // registro casado; eles são materializados no recalc em lote
    // (lib/records/recalc.ts).
    const hasUnresolvedMatch = formulaRefs(def.formula).some(
      (r) =>
        r.startsWith("match:") &&
        !(dateCtx && Object.prototype.hasOwnProperty.call(dateCtx, r)) &&
        !Object.prototype.hasOwnProperty.call(baseCtx, r)
    );
    if (hasUnresolvedMatch) continue;
    // Campo calculado monetário:
    //  - 'fixed'   → converte cada operando monetário para a moeda fixa antes de
    //                avaliar (conversão explícita; a moeda de exibição vem de
    //                currency_code, sem carimbo).
    //  - 'inherit' → moeda AUTOMÁTICA dos operandos: quando todos os operandos
    //                monetários presentes têm a MESMA moeda, avalia os valores
    //                crus e carimba essa moeda (custom_fields "<key>__cur");
    //                quando misturam moedas, converte cada operando para Real
    //                pela taxa do período do registro e carimba BRL.
    const isMoney = def.currency_mode === "inherit" || def.currency_mode === "fixed";
    let raw: FormulaResult;
    let stamp: string | null = null;
    if (conv && isMoney) {
      if (def.currency_mode === "fixed") {
        const target = def.currency_code ?? "BRL";
        raw = evaluateFormula(
          def.formula,
          convertOperands(baseCtx, target, conv),
          dateCtx
        );
      } else {
        // Moedas dos operandos monetários COM valor numérico presente (operando
        // null não "envolve" sua moeda no cálculo).
        const codes = new Set<string>();
        for (const ref of formulaRefs(def.formula)) {
          const cur = conv.operandCurrency[ref];
          if (!cur) continue;
          if (toNum(baseCtx[ref]) == null) continue;
          codes.add(cur);
        }
        if (codes.size <= 1) {
          raw = evaluateFormula(def.formula, baseCtx, dateCtx);
          stamp = codes.size === 1 ? [...codes][0] : null;
        } else {
          raw = evaluateFormula(
            def.formula,
            convertOperands(baseCtx, BASE_CURRENCY, conv),
            dateCtx
          );
          stamp = BASE_CURRENCY;
        }
      }
    } else {
      raw = evaluateFormula(def.formula, baseCtx, dateCtx);
    }
    // "Aceitar número negativo" desmarcado: resultado negativo vira 0 (null
    // permanece null — traço na exibição).
    const val =
      typeof raw === "number" && raw < 0 && def.allow_negative === false ? 0 : raw;
    out[def.field_key] = val;
    // Carimbo de moeda por valor: só p/ resultado numérico do modo automático.
    // Se a chave já existe em custom_fields e não há carimbo novo (mudança de
    // modo, resultado não numérico, fórmula sem operando monetário), emite null
    // para limpar o carimbo obsoleto.
    const curKey = calcCurrencyKey(def.field_key);
    if (stamp != null && typeof val === "number") {
      out[curKey] = stamp;
    } else if (
      customFields &&
      Object.prototype.hasOwnProperty.call(customFields, curKey)
    ) {
      out[curKey] = null;
    }
  }
  return out;
}

// Converte os operandos monetários do contexto para a moeda `target` (ponte via
// Real). Operandos não-monetários (sem entrada em operandCurrency) e valores
// não numéricos passam iguais.
function convertOperands(
  baseCtx: Record<string, unknown>,
  target: string,
  conv: FormulaCurrencyContext
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const [ref, v] of Object.entries(baseCtx)) {
    const cur = conv.operandCurrency[ref];
    const n = toNum(v);
    if (n == null || !cur) {
      ctx[ref] = v;
      continue;
    }
    ctx[ref] = convertCurrency(n, cur, target, conv.rates, conv.year, conv.quarter);
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
        case "str": return `"${t.value}"`;
        case "bool": return t.value ? "VERDADEIRO" : "FALSO";
        case "op": return t.op === "*" ? "×" : t.op === "/" ? "÷" : t.op;
        case "cmp": return t.op;
        case "func": return t.name;
        case "argsep": return ";";
        case "lparen": return "(";
        case "rparen": return ")";
      }
    })
    .join(" ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/ ;/g, ";");
}
