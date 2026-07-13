// Versão: 1.0 | Data: 13/07/2026
// Fórmulas por TEXTO estilo Google Sheets (pt-BR) para campos calculados:
//   SE(E([Valor] > 10; [Etapa] = "Ganho"); [Valor] * 2; 0)
// Este módulo converte texto ⇄ tokens (lib/records/formulas.ts):
//  - tokenizeFormulaText: texto → Formula { tokens, source } com erros
//    amigáveis em PT. Colunas são referenciadas por [Rótulo] (resolvidas contra
//    o catálogo de operandos) ou [ref] bruta (ex.: [custom:forecast]).
//  - formulaToSource: Formula → texto (prefere formula.source; senão serializa
//    os tokens), para o round-trip do editor.
// Funções aceitas (case-insensitive): SE, E, OU. Separador de argumentos ';'.
// Literais: números (1.5 ou 1,5), "texto" ou 'texto', VERDADEIRO/FALSO.
// Operadores: + − × ÷ * / , comparações = <> != < > <= >=.
// Puro (sem IO): usável no cliente (validação ao vivo) e no servidor (submit).
import type { OperandRef } from "./date-operands";
import {
  type Formula,
  type FormulaCmpOp,
  type FormulaFuncName,
  type FormulaToken,
} from "./formulas";

export type TokenizeResult =
  | { ok: true; formula: Formula }
  | { ok: false; error: string };

const FUNC_NAMES: Record<string, FormulaFuncName> = {
  se: "SE",
  e: "E",
  ou: "OU",
};

const BOOL_NAMES: Record<string, boolean> = {
  verdadeiro: true,
  true: true,
  falso: false,
  false: false,
};

function isIdentChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Converte o texto de uma fórmula em tokens. `catalog` são os operandos
 * permitidos (numéricos + datas + condicionais), usados para resolver [Rótulo]
 * → ref. Rótulo ambíguo (dois campos com o mesmo nome) → erro pedindo a ref.
 */
export function tokenizeFormulaText(
  text: string,
  catalog: OperandRef[]
): TokenizeResult {
  const src = text ?? "";
  if (!src.trim()) return { ok: false, error: "A fórmula está vazia." };

  // Índices de resolução: ref exata e rótulo (case-insensitive, sem espaços nas
  // pontas). Um rótulo pode apontar p/ mais de uma ref → ambíguo.
  const byRef = new Set(catalog.map((o) => o.ref));
  const byLabel = new Map<string, Set<string>>();
  for (const o of catalog) {
    const key = o.label.trim().toLocaleLowerCase("pt-BR");
    const set = byLabel.get(key) ?? new Set<string>();
    set.add(o.ref);
    byLabel.set(key, set);
  }

  const tokens: FormulaToken[] = [];
  let i = 0;
  const fail = (msg: string): TokenizeResult => ({
    ok: false,
    error: `${msg} (posição ${i + 1})`,
  });

  while (i < src.length) {
    const ch = src[i];

    // espaço
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // [Coluna] — rótulo ou ref bruta
    if (ch === "[") {
      const end = src.indexOf("]", i + 1);
      if (end < 0) return fail("Faltou fechar ']' na referência de coluna");
      const inner = src.slice(i + 1, end).trim();
      if (!inner) return fail("Referência de coluna vazia: []");
      let ref: string | null = null;
      if (byRef.has(inner)) {
        ref = inner;
      } else {
        const matches = byLabel.get(inner.toLocaleLowerCase("pt-BR"));
        if (matches && matches.size === 1) ref = [...matches][0];
        else if (matches && matches.size > 1) {
          return {
            ok: false,
            error: `Coluna ambígua: [${inner}] corresponde a mais de um campo (${[...matches].join(", ")}). Use a referência entre colchetes, ex.: [${[...matches][0]}].`,
          };
        }
      }
      if (!ref) return { ok: false, error: `Coluna desconhecida: [${inner}]` };
      tokens.push({ kind: "field", ref });
      i = end + 1;
      continue;
    }

    // "texto" ou 'texto' ("" escapa aspas dentro de "…")
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < src.length) {
        const c = src[j];
        if (c === quote) {
          if (quote === '"' && src[j + 1] === '"') {
            out += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        out += c;
        j += 1;
      }
      if (!closed) return fail(`Faltou fechar as aspas (${quote})`);
      tokens.push({ kind: "str", value: out });
      i = j;
      continue;
    }

    // número: 12, 1.5, 1,5
    if (/[0-9]/.test(ch)) {
      const m = src.slice(i).match(/^\d+(?:[.,]\d+)?/);
      if (!m) return fail("Número inválido");
      const value = Number(m[0].replace(",", "."));
      if (!Number.isFinite(value)) return fail(`Número inválido: ${m[0]}`);
      tokens.push({ kind: "const", value });
      i += m[0].length;
      continue;
    }

    // operadores de comparação (2 chars primeiro)
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "!=") {
      tokens.push({ kind: "cmp", op: "<>" });
      i += 2;
      continue;
    }
    if (two === "<=" || two === ">=") {
      tokens.push({ kind: "cmp", op: two as FormulaCmpOp });
      i += 2;
      continue;
    }
    if (two === "==") {
      tokens.push({ kind: "cmp", op: "=" });
      i += 2;
      continue;
    }
    if (ch === "=" || ch === "<" || ch === ">") {
      tokens.push({ kind: "cmp", op: ch as FormulaCmpOp });
      i += 1;
      continue;
    }

    // aritmética / pontuação
    if (ch === "+" || ch === "-") {
      tokens.push({ kind: "op", op: ch });
      i += 1;
      continue;
    }
    if (ch === "*" || ch === "×") {
      tokens.push({ kind: "op", op: "*" });
      i += 1;
      continue;
    }
    if (ch === "/" || ch === "÷") {
      tokens.push({ kind: "op", op: "/" });
      i += 1;
      continue;
    }
    if (ch === "−") {
      tokens.push({ kind: "op", op: "-" });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }
    if (ch === ";") {
      tokens.push({ kind: "argsep" });
      i += 1;
      continue;
    }
    if (ch === ",") {
      return fail(
        "Use ';' para separar argumentos (a vírgula é reservada para decimais)"
      );
    }

    // identificador: função (SE/E/OU) ou literal booleano
    if (isIdentChar(ch)) {
      let j = i;
      while (j < src.length && isIdentChar(src[j])) j += 1;
      const word = src.slice(i, j);
      const lower = word.toLocaleLowerCase("pt-BR");
      const func = FUNC_NAMES[lower];
      if (func) {
        tokens.push({ kind: "func", name: func });
        i = j;
        continue;
      }
      if (lower in BOOL_NAMES) {
        tokens.push({ kind: "bool", value: BOOL_NAMES[lower] });
        i = j;
        continue;
      }
      return {
        ok: false,
        error: `"${word}" não é uma função conhecida (SE, E, OU). Para usar uma coluna, escreva entre colchetes: [${word}].`,
      };
    }

    return fail(`Símbolo inválido: ${ch}`);
  }

  return { ok: true, formula: { tokens, source: src } };
}

/**
 * Texto de uma fórmula para o editor: prefere o `source` gravado; senão
 * serializa os tokens (fórmulas montadas no construtor de botões).
 */
export function formulaToSource(
  formula: Formula | null | undefined,
  labelForRef: (ref: string) => string
): string {
  if (!formula) return "";
  if (formula.source) return formula.source;
  const parts: string[] = [];
  for (const t of formula.tokens) {
    switch (t.kind) {
      case "field": parts.push(`[${labelForRef(t.ref)}]`); break;
      case "const": parts.push(String(t.value).replace(".", ",")); break;
      case "str": parts.push(`"${t.value.replace(/"/g, '""')}"`); break;
      case "bool": parts.push(t.value ? "VERDADEIRO" : "FALSO"); break;
      case "op": parts.push(t.op); break;
      case "cmp": parts.push(t.op); break;
      case "func": parts.push(t.name); break;
      case "argsep": parts.push(";"); break;
      case "lparen": parts.push("("); break;
      case "rparen": parts.push(")"); break;
    }
  }
  return parts
    .join(" ")
    .replace(/(SE|E|OU) \(/g, "$1(")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/ ;/g, ";");
}
