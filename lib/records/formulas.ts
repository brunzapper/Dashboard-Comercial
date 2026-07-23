// Versão: 2.4 | Data: 19/07/2026
// v2.4 (19/07/2026): aninhamento de campos calculados — computeFormulaFields
//   avalia em ORDEM TOPOLÓGICA (lib/records/formula-deps.orderFormulaDefs) e
//   injeta cada resultado no contexto como operando `custom:<key>` (com a
//   moeda do resultado registrada em operandCurrency). Ciclos são rejeitados
//   no salvamento (findFormulaCycle); ciclo residual no banco materializa
//   null, nunca loop.
// v2.3 (18/07/2026): builders PUROS *FromRows (CalcFieldRow) — quem já leu
//   field_definitions inteira deriva defs de fórmula/chaves de data/moedas em
//   memória em vez de 3 consultas extras (updateRecord/createRecord). Os
//   loaders load* mantêm assinatura e delegam o mapeamento aos builders.
// v2.2 (15/07/2026): funções PURAS estilo Google Sheets — SOMA, MÉDIA, MÍN,
//   MÁX, CONT.NÚM, CONT.VALORES, ARRED, ABS, CONCATENAR. Variádicas sobre os
//   argumentos (não tocam em basis/SQL — diferente de SOMASE etc.), null-safe:
//   agregadoras numéricas ignoram não-números; ARRED/ABS propagam null;
//   CONCATENAR trata null como "". Adição estritamente aditiva: nenhuma
//   mudança de comportamento nos ramos existentes. Usadas primeiro pelas
//   fórmulas de célula da Tabela Livre (refs cell:<c>:<r>).
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
// v2.1 (15/07/2026): agregações condicionais SOMASE/SOMASES/CONT.SE/CONT.SES/
//   MÉDIASE. Só valem no contexto AGREGADO (calculado_agg / métricas de
//   widget): cada chamada compila para uma chave de basis condicional
//   ("aggif:...") resolvida por consulta SQL extra com os filtros da condição
//   (ver lib/widgets/calc-metrics.ts); o avaliador apenas lê ctx[chave].

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
import { isCoreDef } from "@/lib/records/core-defs";
// Import circular seguro com formula-deps (que importa formulaRefs/
// isCondAggFunc daqui): ambos só chamam funções um do outro em tempo de
// avaliação de fórmula, nunca no top-level do módulo.
import {
  formulaDependencyKeys,
  orderFormulaDefs,
} from "@/lib/records/formula-deps";

export type FormulaOp = "+" | "-" | "*" | "/";
export type FormulaCmpOp = "=" | "<>" | "<" | ">" | "<=" | ">=";
export type FormulaFuncName =
  | "SE"
  | "E"
  | "OU"
  | "SOMASE"
  | "SOMASES"
  | "CONT.SE"
  | "CONT.SES"
  | "MÉDIASE"
  // Funções puras variádicas (v2.2) — avaliadas direto sobre os argumentos.
  | "SOMA"
  | "MÉDIA"
  | "MÍN"
  | "MÁX"
  | "CONT.NÚM"
  | "CONT.VALORES"
  | "ARRED"
  | "ABS"
  | "CONCATENAR"
  // Comparação com período anterior (17/07/2026) — só fazem sentido no contexto
  // AGREGADO do dashboard (nota/métrica calculada/calculadora): o runtime
  // (formula-metric.ts) resolve a MESMA basis sob os filtros do período de
  // comparação e a passa como contexto alternativo ao avaliador. Fora desse
  // contexto (campo calculado por registro), avaliam para null.
  | "ANTERIOR"
  | "VARPCT"
  | "VARABS";

// Funções puras variádicas sobre os argumentos (nenhuma consulta/basis).
const PURE_FUNCS = new Set<FormulaFuncName>([
  "SOMA",
  "MÉDIA",
  "MÍN",
  "MÁX",
  "CONT.NÚM",
  "CONT.VALORES",
  "ARRED",
  "ABS",
  "CONCATENAR",
]);

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

// Funções de comparação com período anterior (ver FormulaFuncName acima).
export const COMPARISON_FUNCS = new Set<FormulaFuncName>([
  "ANTERIOR",
  "VARPCT",
  "VARABS",
]);

/** Bases de comparação usadas pelas funções ANTERIOR/VARPCT/VARABS. */
export type ComparisonFuncBase = "anterior" | "ano";

export function formulaUsesComparison(
  formula: Formula | null | undefined
): boolean {
  if (!formula) return false;
  return formula.tokens.some(
    (t) => t.kind === "func" && COMPARISON_FUNCS.has(t.name)
  );
}

/**
 * Bases de comparação referenciadas pela fórmula (2º argumento literal de
 * ANTERIOR/VARPCT/VARABS; ausente = "anterior"). Fórmula inválida → [].
 */
export function formulaComparisonBases(
  formula: Formula | null | undefined
): ComparisonFuncBase[] {
  if (!formula || !formulaUsesComparison(formula)) return [];
  let root: FormulaNode;
  try {
    root = parseTokens(formula.tokens);
  } catch {
    return [];
  }
  const bases = new Set<ComparisonFuncBase>();
  const walk = (n: FormulaNode): void => {
    switch (n.k) {
      case "call":
        if (COMPARISON_FUNCS.has(n.name)) {
          const b = n.args[1];
          bases.add(b && b.k === "lit" && b.v === "ano" ? "ano" : "anterior");
        }
        n.args.forEach(walk);
        return;
      case "bin":
      case "cmp":
        walk(n.a);
        walk(n.b);
        return;
      case "neg":
        walk(n.a);
        return;
      default:
        return;
    }
  };
  walk(root);
  return [...bases];
}

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
      if (name === "SOMASE" || name === "SOMASES" || name === "MÉDIASE") {
        if (args.length < 2) {
          throw new FormulaParseError(
            `${name} espera pelo menos 2 argumentos: ${name}([Campo]; [Coluna] = valor).`
          );
        }
        if (args[0].k !== "ref") {
          throw new FormulaParseError(
            `O 1º argumento de ${name} deve ser uma coluna, ex.: ${name}([Valor]; [Etapa] = "Ganho").`
          );
        }
        for (const arg of args.slice(1)) assertCondArg(name, arg);
      }
      if (name === "CONT.SE" || name === "CONT.SES") {
        if (args.length < 1) {
          throw new FormulaParseError(
            `${name} espera pelo menos 1 condição: ${name}([Coluna] = valor).`
          );
        }
        for (const arg of args) assertCondArg(name, arg);
      }
      // Funções puras (v2.2): só aridade — os argumentos são expressões livres.
      if (
        (name === "SOMA" ||
          name === "MÉDIA" ||
          name === "MÍN" ||
          name === "MÁX" ||
          name === "CONT.NÚM" ||
          name === "CONT.VALORES" ||
          name === "CONCATENAR") &&
        args.length < 1
      ) {
        throw new FormulaParseError(`${name} espera pelo menos 1 argumento.`);
      }
      if (name === "ABS" && args.length !== 1) {
        throw new FormulaParseError("ABS espera exatamente 1 argumento.");
      }
      if (COMPARISON_FUNCS.has(name)) {
        if (args.length < 1 || args.length > 2) {
          throw new FormulaParseError(
            `${name} espera 1 ou 2 argumentos: ${name}(expressão; "anterior" | "ano").`
          );
        }
        const b = args[1];
        if (b && !(b.k === "lit" && (b.v === "anterior" || b.v === "ano"))) {
          throw new FormulaParseError(
            `O 2º argumento de ${name} deve ser "anterior" ou "ano".`
          );
        }
      }
      if (name === "ARRED" && (args.length < 1 || args.length > 2)) {
        throw new FormulaParseError(
          "ARRED espera 1 ou 2 argumentos: ARRED(valor; casas)."
        );
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

// --- Agregações condicionais (SOMASE/CONT.SE/MÉDIASE) -------------------------
// Cada condição deve ser exatamente `[Coluna] <op> literal`, porque compila
// para UM WidgetFilter que o RPC de agregação já entende. Multi-critério =
// argumentos extras (E implícito). O avaliador não agrega nada: lê do contexto
// o valor pré-computado sob a chave canônica `condAggKey(spec)`.

export interface AggCondition {
  ref: string;
  // Ops "estendidos" (20/07/2026): `in` (lista), `is_null`/`not_null` (sem
  // valor). O PARSER de SOMASE/CONT.SE segue emitindo só FormulaCmpOp — os
  // estendidos são produzidos exclusivamente pelo abaixamento de operandos
  // com escopo de fonte (lowerSourceScopedOperands, predicado da sub-fonte).
  op: FormulaCmpOp | "in" | "is_null" | "not_null";
  value?: number | string | boolean | (number | string | boolean)[] | null;
}

export interface CondAggSpec {
  agg: "sum" | "count";
  // Ref do campo alvo (soma/contagem por campo) ou "*" (contagem de registros).
  field: string;
  conds: AggCondition[];
  // Escopo de FONTE (20/07/2026): source-key do operando escopado
  // (`agg:…@<fonte>`), preenchido SÓ pelo lowering. A consulta auxiliar de um
  // spec com scope aplica o período pela coluna de DATA da própria fonte do
  // escopo e usa o mapa de correspondências dela (ver engine/formula-metric).
  scope?: string;
}

const COND_AGG_FUNCS = new Set<FormulaFuncName>([
  "SOMASE",
  "SOMASES",
  "CONT.SE",
  "CONT.SES",
  "MÉDIASE",
]);

export function isCondAggFunc(name: FormulaFuncName): boolean {
  return COND_AGG_FUNCS.has(name);
}

/** True quando a fórmula chama SOMASE/CONT.SE/MÉDIASE (scan de tokens — vale
 * mesmo para fórmula estruturalmente inválida). */
export function formulaUsesCondAgg(formula: Formula | null | undefined): boolean {
  if (!formula) return false;
  return formula.tokens.some((t) => t.kind === "func" && isCondAggFunc(t.name));
}

/** Chave de basis canônica e determinística de uma agregação condicional.
 * O 4º elemento (scope) SÓ entra quando presente — chaves de specs sem escopo
 * (SOMASE/CONT.SE e escopos antigos eq-only) seguem byte-idênticas. */
export function condAggKey(spec: CondAggSpec): string {
  const triples = spec.conds.map((c) => [c.ref, c.op, c.value ?? null]);
  return (
    "aggif:" +
    JSON.stringify(
      spec.scope != null
        ? [spec.agg, spec.field, triples, spec.scope]
        : [spec.agg, spec.field, triples]
    )
  );
}

const FLIP_CMP: Record<FormulaCmpOp, FormulaCmpOp> = {
  "=": "=",
  "<>": "<>",
  "<": ">",
  ">": "<",
  "<=": ">=",
  ">=": "<=",
};

// Extrai `[Coluna] <op> literal` de um nó de comparação (literal à esquerda é
// normalizado invertendo o operador). Null quando o nó não tem essa forma.
function condOf(node: FormulaNode): AggCondition | null {
  if (node.k !== "cmp") return null;
  if (node.a.k === "ref" && node.b.k === "lit") {
    return { ref: node.a.ref, op: node.op, value: node.b.v };
  }
  if (node.a.k === "lit" && node.b.k === "ref") {
    return { ref: node.b.ref, op: FLIP_CMP[node.op], value: node.a.v };
  }
  return null;
}

function assertCondArg(name: FormulaFuncName, node: FormulaNode): void {
  if (condOf(node)) return;
  if (node.k === "call" && (node.name === "E" || node.name === "OU")) {
    throw new FormulaParseError(
      `Não use ${node.name}(...) dentro de ${name} — passe várias condições ` +
        `separadas por ';', ex.: SOMASES([Valor]; cond1; cond2).`
    );
  }
  if (node.k === "cmp" && node.a.k === "ref" && node.b.k === "ref") {
    throw new FormulaParseError(
      `Cada condição de ${name} compara uma coluna com um valor fixo, ` +
        `ex.: [Etapa] = "Ganho".`
    );
  }
  throw new FormulaParseError(
    `Cada condição de ${name} deve ter a forma [Coluna] operador valor, ` +
      `ex.: [Etapa] = "Ganho".`
  );
}

// Specs de basis de uma chamada já validada pelo parser. MÉDIASE precisa de
// soma E contagem do mesmo campo/condições (média = soma ÷ contagem).
function condAggSpecsOf(node: Extract<FormulaNode, { k: "call" }>): CondAggSpec[] {
  const isCount = node.name === "CONT.SE" || node.name === "CONT.SES";
  const conds = node.args
    .slice(isCount ? 0 : 1)
    .map((a) => condOf(a))
    .filter((c): c is AggCondition => c != null);
  if (isCount) return [{ agg: "count", field: "*", conds }];
  const target = node.args[0];
  if (target?.k !== "ref") return [];
  if (node.name === "MÉDIASE") {
    return [
      { agg: "sum", field: target.ref, conds },
      { agg: "count", field: target.ref, conds },
    ];
  }
  return [{ agg: "sum", field: target.ref, conds }];
}

export interface CondAggInfo {
  specs: CondAggSpec[]; // agregações condicionais que o basis precisa computar
  targetRefs: string[]; // 1º argumento (campo alvo) de SOMASE/SOMASES/MÉDIASE
  condRefs: string[]; // colunas usadas nas condições
  plainRefs: string[]; // refs FORA de chamadas condicionais (para validação)
}

/** Inventário das agregações condicionais de uma fórmula (walk do AST).
 * Fórmula estruturalmente inválida → tudo vazio (a validação forte acusa). */
export function formulaCondAggInfo(formula: Formula): CondAggInfo {
  const info: CondAggInfo = { specs: [], targetRefs: [], condRefs: [], plainRefs: [] };
  let root: FormulaNode;
  try {
    root = parseTokens(formula.tokens);
  } catch {
    return info;
  }
  const seen = new Set<string>();
  const walk = (node: FormulaNode): void => {
    switch (node.k) {
      case "ref":
        info.plainRefs.push(node.ref);
        return;
      case "neg":
        walk(node.a);
        return;
      case "bin":
      case "cmp":
        walk(node.a);
        walk(node.b);
        return;
      case "call": {
        if (!isCondAggFunc(node.name)) {
          for (const arg of node.args) walk(arg);
          return;
        }
        // Refs internos (alvo + condições) não entram em plainRefs.
        const isCount = node.name === "CONT.SE" || node.name === "CONT.SES";
        if (!isCount && node.args[0]?.k === "ref") {
          info.targetRefs.push(node.args[0].ref);
        }
        for (const arg of node.args.slice(isCount ? 0 : 1)) {
          const c = condOf(arg);
          if (c) info.condRefs.push(c.ref);
        }
        for (const spec of condAggSpecsOf(node)) {
          const key = condAggKey(spec);
          if (!seen.has(key)) {
            seen.add(key);
            info.specs.push(spec);
          }
        }
        return;
      }
      default:
        return;
    }
  };
  walk(root);
  return info;
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

/**
 * Compara um valor BRUTO de registro com o literal de uma condição de
 * SOMASE/CONT.SE/MÉDIASE usando o MESMO maquinário do SE (valEquals/
 * valCompare): trim + minúsculas pt-BR, booleanos canonizados
 * (VERDADEIRO/SIM ≡ true), null ≡ '' e números comparados numericamente.
 * Fonte única da semântica das condições nos caminhos client-side
 * (lib/widgets/calc-metrics.recordMatchesConds); o SQL espelha via os
 * operadores normalizados da migração 0050 (eq_ci/neq_ci e *_num).
 */
export function evalCondition(
  raw: unknown,
  op: FormulaCmpOp,
  value: number | string | boolean
): boolean {
  // Mesmo tratamento do `case "ref"` do avaliador: ausente/vazio/não primitivo
  // vira null tipado.
  const a: Val =
    raw == null ||
    raw === "" ||
    (typeof raw !== "number" && typeof raw !== "string" && typeof raw !== "boolean")
      ? NULL_VAL
      : { v: raw, date: false };
  const b: Val = { v: value, date: false };
  if (op === "=") return valEquals(a, b);
  if (op === "<>") return !valEquals(a, b);
  // Ordenação com literal NUMÉRICO: sem o fallback textual do valCompare
  // ("abc" > 10 seria true por localeCompare) — espelha os ops *_num do SQL
  // (valor que não parseia → não casa), para o modo registros e a consulta
  // agregada SEMPRE concordarem. Única divergência (documentada) do SE.
  let c: number | null;
  if (typeof value === "number") {
    const n = toNum(a.v);
    c = n == null ? null : n - value;
  } else {
    c = valCompare(a, b);
  }
  if (c == null) return false;
  switch (op) {
    case "<":
      return c < 0;
    case ">":
      return c > 0;
    case "<=":
      return c <= 0;
    case ">=":
      return c >= 0;
    default:
      return false;
  }
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
      if (COMPARISON_FUNCS.has(node.name)) {
        // Avalia a MESMA expressão contra o contexto do período de comparação
        // (CMP_ENV, injetado por evaluateFormula). Sem contexto (fora do
        // dashboard, sem período ativo ou base indisponível) → null.
        const baseArg = node.args[1];
        const baseName: ComparisonFuncBase =
          baseArg && baseArg.k === "lit" && baseArg.v === "ano"
            ? "ano"
            : "anterior";
        const cmpCtx = CMP_ENV?.[baseName];
        if (!node.args[0] || !cmpCtx) return NULL_VAL;
        const prev = evalNode(node.args[0], cmpCtx, dateCtx);
        if (node.name === "ANTERIOR") return prev.date ? NULL_VAL : prev;
        const cur = evalNode(node.args[0], ctx, dateCtx);
        const curN = toNumVal(cur);
        const prevN = toNumVal(prev);
        if (curN == null || prevN == null) return NULL_VAL;
        if (node.name === "VARABS") return { v: curN - prevN, date: false };
        // VARPCT já sai ×100 ("cresceu {=VARPCT([MRR])}%" lê natural na nota).
        if (prevN === 0) return NULL_VAL;
        return { v: ((curN - prevN) / Math.abs(prevN)) * 100, date: false };
      }
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
      if (isCondAggFunc(node.name)) {
        // Agregações condicionais: o valor vem pré-computado no contexto sob a
        // chave canônica (basis agregado). Fora do contexto agregado a chave
        // não existe → null.
        const specs = condAggSpecsOf(node);
        if (specs.length === 0) return NULL_VAL;
        if (node.name === "MÉDIASE") {
          const sum = toNum(ctx[condAggKey(specs[0])]);
          const count = toNum(ctx[condAggKey(specs[1])]);
          if (sum == null || count == null || count === 0) return NULL_VAL;
          return { v: sum / count, date: false };
        }
        return { v: toNum(ctx[condAggKey(specs[0])]), date: false };
      }
      if (PURE_FUNCS.has(node.name)) {
        const vals = node.args.map((a) => evalNode(a, ctx, dateCtx));
        // Números presentes entre os argumentos (datas/textos não numéricos e
        // nulls são ignorados — semântica das agregadoras do Sheets).
        const nums = vals
          .map(toNumVal)
          .filter((n): n is number => n != null);
        switch (node.name) {
          case "SOMA":
            return { v: nums.reduce((s, n) => s + n, 0), date: false };
          case "MÉDIA":
            return {
              v: nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null,
              date: false,
            };
          case "MÍN":
            return { v: nums.length ? Math.min(...nums) : null, date: false };
          case "MÁX":
            return { v: nums.length ? Math.max(...nums) : null, date: false };
          case "CONT.NÚM":
            return { v: nums.length, date: false };
          case "CONT.VALORES":
            return {
              v: vals.filter((x) => x.v != null && x.v !== "").length,
              date: false,
            };
          case "ABS": {
            const n = toNumVal(vals[0]);
            return { v: n == null ? null : Math.abs(n), date: false };
          }
          case "ARRED": {
            const n = toNumVal(vals[0]);
            if (n == null) return NULL_VAL;
            const places = vals[1] ? (toNumVal(vals[1]) ?? 0) : 0;
            const f = Math.pow(10, Math.trunc(places));
            const r = Math.round(n * f) / f;
            return { v: Number.isFinite(r) ? r : null, date: false };
          }
          case "CONCATENAR": {
            const out = vals
              .map((x) => {
                if (x.v == null || x.date) return "";
                if (typeof x.v === "boolean")
                  return x.v ? "VERDADEIRO" : "FALSO";
                return String(x.v);
              })
              .join("");
            return { v: out, date: false };
          }
          default:
            return NULL_VAL;
        }
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
// Contextos do período de comparação (ANTERIOR/VARPCT/VARABS), por base. A
// avaliação é 100% síncrona, então uma variável de módulo com try/finally é
// segura e evita enfiar mais um parâmetro em toda a recursão de evalNode.
export type ComparisonContexts = Partial<
  Record<ComparisonFuncBase, Record<string, unknown>>
>;
let CMP_ENV: ComparisonContexts | undefined;

export function evaluateFormula(
  formula: Formula,
  ctx: Record<string, unknown>,
  dateCtx?: Record<string, number | null>,
  cmpCtxs?: ComparisonContexts
): FormulaResult {
  let node: FormulaNode;
  try {
    node = parseTokens(formula.tokens);
  } catch {
    return null;
  }
  const prevEnv = CMP_ENV;
  CMP_ENV = cmpCtxs;
  try {
    const res = evalNode(node, ctx, dateCtx);
    if (res.date) return null; // resultado "cru" de data não é exibível
    if (typeof res.v === "number" && !Number.isFinite(res.v)) return null;
    return res.v;
  } finally {
    CMP_ENV = prevEnv;
  }
}

export interface FormulaValidation {
  ok: boolean;
  error?: string;
}

/**
 * Valida a fórmula: estrutura (mesmo parser da avaliação, com mensagens em PT)
 * e refs conhecidas. `allowedRefs` contém as colunas numéricas permitidas —
 * inclusive campos calculados (aninhamento, 19/07/2026), EXCETO os que criariam
 * dependência circular com o campo em edição (o chamador monta o conjunto; a
 * trava de ciclo com mensagem própria é findFormulaCycle em
 * lib/records/formula-deps.ts). `allowedDateRefs` as datas; `allowedCondRefs`
 * as colunas de texto/seleção/booleano permitidas em condicionais (SE/E/OU e
 * comparações).
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

// Linha de `field_definitions` com as colunas necessárias para derivar EM
// MEMÓRIA os insumos de calc-fields (defs de fórmula, chaves de data, moedas
// por campo). Quem já leu a tabela inteira (updateRecord/createRecord leem
// todas as defs de qualquer forma) passa as linhas aos builders *FromRows
// abaixo e evita 3 consultas extras na mesma tabela por edição.
export interface CalcFieldRow {
  field_key: string;
  data_type: string;
  formula?: unknown;
  currency_mode?: string | null;
  currency_code?: string | null;
  allow_negative?: boolean | null;
  // Linhas core (0086) chegam junto quando o chamador leu a tabela inteira —
  // os builders as filtram (colunas núcleo não são chaves de custom_fields).
  source_system?: string | null;
}

/** Deriva as chaves dos campos `data` de linhas já carregadas. */
export function customDateKeysFromRows(rows: CalcFieldRow[]): string[] {
  return rows
    .filter((r) => !isCoreDef(r) && r.data_type === "data")
    .map((r) => r.field_key);
}

/** Deriva as defs de campos calculados de linhas já carregadas. */
export function formulaDefsFromRows(rows: CalcFieldRow[]): FormulaFieldDef[] {
  return rows
    .filter((r) => !isCoreDef(r) && r.data_type === "calculado")
    .map((r) => ({
      field_key: r.field_key,
      formula: (r.formula as Formula | null) ?? null,
      currency_mode: r.currency_mode ?? null,
      currency_code: r.currency_code ?? null,
      allow_negative: r.allow_negative ?? true,
    }))
    .filter((d) => d.formula != null);
}

/** Chaves dos campos personalizados do tipo `data` (para o contexto de datas). */
export async function loadCustomDateKeys(
  db: import("@supabase/supabase-js").SupabaseClient
): Promise<string[]> {
  const { data } = await db
    .from("field_definitions")
    .select("field_key, source_system")
    .eq("data_type", "data");
  // Linhas core (0086) fora: closed_at/opened_at/... são colunas núcleo, não
  // chaves de custom_fields. Filtro em JS — `.neq` derrubaria source_system
  // NULL (campos locais/app).
  return customDateKeysFromRows(
    (data ?? [])
      .filter((r) => !isCoreDef(r))
      .map((r) => ({
        field_key: r.field_key as string,
        data_type: "data",
      }))
  );
}

/** Carrega as definições de campos calculados (data_type='calculado'). */
export async function loadFormulaDefs(
  db: import("@supabase/supabase-js").SupabaseClient
): Promise<FormulaFieldDef[]> {
  const { data } = await db
    .from("field_definitions")
    .select(
      "field_key, formula, currency_mode, currency_code, allow_negative, source_system"
    )
    .eq("data_type", "calculado");
  return formulaDefsFromRows(
    (data ?? [])
      .filter((r) => !isCoreDef(r))
      .map((r) => ({
      field_key: r.field_key as string,
      data_type: "calculado",
      formula: r.formula,
      currency_mode: (r.currency_mode as string | null) ?? null,
      currency_code: (r.currency_code as string | null) ?? null,
      allow_negative: (r.allow_negative as boolean | null) ?? null,
    }))
  );
}

/**
 * Como loadFormulaDefs, mas AGRUPADO por organização. ISOLAMENTO multi-org
 * (0090): `field_definitions.field_key` é único POR-ORG, então duas orgs podem
 * ter a mesma chave com fórmulas diferentes. O recalc global (recalcAllFormula
 * Fields, que varre registros de todas as orgs) precisa aplicar a CADA registro
 * apenas as fórmulas da SUA org — senão a fórmula da org B seria gravada no
 * custom_fields de um registro da org A. A chave do Map é o `organization_id`.
 */
export async function loadFormulaDefsByOrg(
  db: import("@supabase/supabase-js").SupabaseClient
): Promise<Map<string, FormulaFieldDef[]>> {
  const { data } = await db
    .from("field_definitions")
    .select(
      "field_key, formula, currency_mode, currency_code, allow_negative, source_system, organization_id"
    )
    .eq("data_type", "calculado");
  const rowsByOrg = new Map<
    string,
    Array<{
      field_key: string;
      data_type: "calculado";
      formula: unknown;
      currency_mode: string | null;
      currency_code: string | null;
      allow_negative: boolean | null;
    }>
  >();
  for (const r of data ?? []) {
    if (isCoreDef(r)) continue;
    const org = (r.organization_id as string | null) ?? "";
    const list = rowsByOrg.get(org) ?? [];
    list.push({
      field_key: r.field_key as string,
      data_type: "calculado",
      formula: r.formula,
      currency_mode: (r.currency_mode as string | null) ?? null,
      currency_code: (r.currency_code as string | null) ?? null,
      allow_negative: (r.allow_negative as boolean | null) ?? null,
    });
    rowsByOrg.set(org, list);
  }
  const byOrg = new Map<string, FormulaFieldDef[]>();
  for (const [org, rows] of rowsByOrg) byOrg.set(org, formulaDefsFromRows(rows));
  return byOrg;
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

// Moeda de cada campo personalizado 'moeda' (derivável de linhas já lidas).
export interface CurrencyFieldMaps {
  moedaCurrency: Record<string, string>; // fixos: 'custom:<key>' → ISO
  inheritMoedaRefs: string[]; // 'custom:<key>' que herdam a moeda do registro
}

// Insumos de câmbio compartilhados: taxas + moeda de cada campo 'moeda'.
export interface CurrencyMaterials extends CurrencyFieldMaps {
  rates: CurrencyRates;
}

/** Deriva os mapas de moeda dos campos 'moeda' de linhas já carregadas. */
export function currencyFieldMapsFromRows(rows: CalcFieldRow[]): CurrencyFieldMaps {
  const moedaCurrency: Record<string, string> = {};
  const inheritMoedaRefs: string[] = [];
  for (const f of rows) {
    if (isCoreDef(f) || f.data_type !== "moeda") continue;
    const ref = `custom:${f.field_key}`;
    if ((f.currency_mode ?? null) === "inherit") {
      inheritMoedaRefs.push(ref);
    } else {
      moedaCurrency[ref] = resolveCurrencyCode(f.currency_code ?? null);
    }
  }
  return { moedaCurrency, inheritMoedaRefs };
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
    .select("field_key, currency_code, currency_mode, source_system")
    .eq("data_type", "moeda");
  // Linhas core (0086: value/mrr são 'moeda') fora — não são campos custom.
  return {
    rates,
    ...currencyFieldMapsFromRows(
      (data ?? [])
        .filter((r) => !isCoreDef(r))
        .map((r) => ({
        field_key: r.field_key as string,
        data_type: "moeda",
        currency_mode: (r.currency_mode as string | null) ?? null,
        currency_code: (r.currency_code as string | null) ?? null,
      }))
    ),
  };
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
    operandCurrency: {
      value: recCur,
      mrr: recCur,
      ...mats.moedaCurrency,
      ...Object.fromEntries(mats.inheritMoedaRefs.map((r) => [r, recCur])),
    },
  };
}

/**
 * Materializa todos os campos calculados de um registro. Monta o contexto a
 * partir das colunas do núcleo (números e, para condicionais, textos/booleanos)
 * + dos custom_fields já resolvidos (valores BRUTOS — a coerção é feita por
 * operação no avaliador) e avalia cada def. Retorna um mapa field_key →
 * número|texto|booleano|null para mesclar em custom_fields. Aninhamento
 * (19/07/2026): os defs são avaliados em ordem topológica de dependência e
 * cada resultado (pós-clamp) é injetado no contexto como operando
 * `custom:<key>` — com a moeda do resultado registrada em operandCurrency —
 * para que um calculado use outro. Não pré-ordene os defs no chamador: a
 * ordem é interna. Membros de ciclo residual no banco (o salvamento rejeita
 * ciclos via findFormulaCycle) materializam null, nunca loop. Valores de
 * `match:<fonte>:<ref>` não datados podem vir dentro de `coreValues` chaveados
 * pelo ref completo (ver lib/records/recalc.ts).
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

  const { ordered, cyclic } = orderFormulaDefs(formulaDefs);
  // Ciclo residual materializa null — e é null que os dependentes fora do
  // ciclo devem enxergar (não o valor materializado obsoleto do banco).
  for (const key of cyclic) baseCtx[`custom:${key}`] = null;
  // Cópia local mutável do mapa de moedas por operando: os calculados
  // intermediários entram aqui à medida que são avaliados.
  const effConv: FormulaCurrencyContext | undefined = conv
    ? { ...conv, operandCurrency: { ...conv.operandCurrency } }
    : undefined;
  const defKeys = new Set(formulaDefs.map((d) => d.field_key));
  // Defs pulados nesta passada (match não resolvido) — dependentes diretos ou
  // indiretos também são pulados, para A e B permanecerem consistentes entre
  // si até o recalc em lote.
  const skipped = new Set<string>();

  const out: Record<string, FormulaResult> = {};
  for (const def of ordered) {
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
    const dependsOnSkipped =
      skipped.size > 0 &&
      formulaDependencyKeys(def.formula, (k) => defKeys.has(k)).some((k) =>
        skipped.has(k)
      );
    if (hasUnresolvedMatch || dependsOnSkipped) {
      skipped.add(def.field_key);
      continue;
    }
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
    if (effConv && isMoney) {
      if (def.currency_mode === "fixed") {
        const target = def.currency_code ?? "BRL";
        raw = evaluateFormula(
          def.formula,
          convertOperands(baseCtx, target, effConv),
          dateCtx
        );
      } else {
        // Moedas dos operandos monetários COM valor numérico presente (operando
        // null não "envolve" sua moeda no cálculo).
        const codes = new Set<string>();
        for (const ref of formulaRefs(def.formula)) {
          const cur = effConv.operandCurrency[ref];
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
            convertOperands(baseCtx, BASE_CURRENCY, effConv),
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
    // Injeção do aninhamento: o resultado (pós-clamp) vira operando dos defs
    // seguintes na ordem topológica, com a moeda do resultado (fixa ou o
    // carimbo do modo automático; sem moeda = número puro) registrada para a
    // herança/conversão em cadeia funcionar.
    baseCtx[`custom:${def.field_key}`] = val;
    if (effConv && isMoney) {
      const opCur =
        def.currency_mode === "fixed"
          ? resolveCurrencyCode(def.currency_code ?? null)
          : stamp;
      if (opCur != null) {
        effConv.operandCurrency[`custom:${def.field_key}`] = opCur;
      }
    }
  }
  // Ciclo residual no banco: materializa null (e limpa carimbo obsoleto) — o
  // topo-sort os deixou fora de `ordered`, então nunca há loop.
  for (const def of formulaDefs) {
    if (!cyclic.has(def.field_key)) continue;
    out[def.field_key] = null;
    const curKey = calcCurrencyKey(def.field_key);
    if (Object.prototype.hasOwnProperty.call(customFields, curKey)) {
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
