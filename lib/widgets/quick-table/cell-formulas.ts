// Versão: 1.0 | Data: 15/07/2026
// Tabela rápida — fórmulas DE CÉLULA estilo Google Sheets ("=SOMA(A1:B3)+C2"),
// avaliadas 100% no cliente sobre os VALORES exibidos na grade (nunca o banco;
// uma célula com {=…} entra pelo seu valor já resolvido). Reusa o parser/
// avaliador central (lib/records/formulas.ts + formula-text.ts): um
// pré-processador troca refs A1/ranges por refs brutas [cell:<col>:<lin>]
// (0-based) e o tokenizador central faz o resto. O endereçamento A1 é
// POSICIONAL sobre a grade renderizada (linha 1 = primeira abaixo do
// cabeçalho; colunas na ordem exibida, incluindo as gerada por pivot) —
// expansão de dados BI desloca posições; prefira ranges em linhas livres.
import {
  evaluateFormula,
  formulaRefs,
  validateFormula,
  type Formula,
  type FormulaResult,
} from "@/lib/records/formulas";
import {
  tokenizeFormulaText,
  type TokenizeResult,
} from "@/lib/records/formula-text";

// Teto de células expandidas por range (evita "=SOMA(A1:Z1000)" explosivo).
const MAX_RANGE_CELLS = 512;

/** 0 → "A", 25 → "Z", 26 → "AA" … */
export function colLetter(i: number): string {
  let n = i;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** "A" → 0, "Z" → 25, "AA" → 26 … */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** "B3" → { c: 1, r: 2 } (0-based); null quando não é um endereço A1. */
export function parseA1(ref: string): { c: number; r: number } | null {
  const m = /^([A-Za-z]{1,3})([0-9]{1,4})$/.exec(ref.trim());
  if (!m) return null;
  const r = Number(m[2]) - 1;
  if (r < 0) return null;
  return { c: colIndex(m[1]), r };
}

export const cellRef = (c: number, r: number) => `cell:${c}:${r}`;

/** Inverso de cellRef. */
export function parseCellRef(ref: string): { c: number; r: number } | null {
  const m = /^cell:(\d+):(\d+)$/.exec(ref);
  if (!m) return null;
  return { c: Number(m[1]), r: Number(m[2]) };
}

// Pré-processa a fonte: refs A1 → [cell:c:r]; ranges A1:B3 (e abertos A2:A /
// A:A) → lista de refs separada por ';' (válida como argumentos de função — o
// parser central acusa range solto fora de função). Ignora trechos entre
// aspas. Devolve erro amigável p/ range grande demais.
function preprocessA1(
  source: string,
  dims: { rows: number; cols: number }
): { ok: true; text: string } | { ok: false; error: string } {
  const src = source;
  let out = "";
  let i = 0;
  const RANGE_RE = /^([A-Za-z]{1,3})([0-9]{0,4}):([A-Za-z]{1,3})([0-9]{0,4})/;
  const CELL_RE = /^([A-Za-z]{1,3})([0-9]{1,4})/;
  // Não confundir função com ref: "SOMA(" tem letras mas sem dígitos.
  const before = () => (out.length ? out[out.length - 1] : "");

  while (i < src.length) {
    const ch = src[i];
    // pula strings entre aspas
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === quote) {
          if (quote === '"' && src[j + 1] === '"') {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    // pula refs já entre colchetes
    if (ch === "[") {
      const end = src.indexOf("]", i + 1);
      const j = end < 0 ? src.length : end + 1;
      out += src.slice(i, j);
      i = j;
      continue;
    }
    // um identificador colado ao anterior (ex.: "CONT" de "CONT.SE") não é A1
    if (/[A-Za-z]/.test(ch) && !/[\p{L}\p{N}_.]/u.test(before())) {
      const rest = src.slice(i);
      const rm = RANGE_RE.exec(rest);
      if (rm && (rm[2] !== "" || rm[4] !== "")) {
        // Range: A1:B3, A2:A (aberto até a última linha), A:A (coluna inteira).
        const c0 = colIndex(rm[1]);
        const c1 = colIndex(rm[3]);
        const r0 = rm[2] === "" ? 0 : Number(rm[2]) - 1;
        const r1 = rm[4] === "" ? dims.rows - 1 : Number(rm[4]) - 1;
        const cA = Math.min(c0, c1);
        const cB = Math.max(c0, c1);
        const rA = Math.max(0, Math.min(r0, r1));
        const rB = Math.min(dims.rows - 1, Math.max(r0, r1));
        const refs: string[] = [];
        for (let r = rA; r <= rB; r += 1) {
          for (let c = cA; c <= cB; c += 1) {
            refs.push(`[${cellRef(c, r)}]`);
            if (refs.length > MAX_RANGE_CELLS) {
              return {
                ok: false,
                error: `Intervalo grande demais (máx. ${MAX_RANGE_CELLS} células).`,
              };
            }
          }
        }
        // Range vazio (fora da grade) vira 0 — SOMA() exige 1 argumento.
        out += refs.length > 0 ? refs.join(";") : "0";
        i += rm[0].length;
        continue;
      }
      const cm = CELL_RE.exec(rest);
      // Ref A1 só quando não continua com caractere de identificador
      // ("A1B" não é ref; "SOMA" não casa por não ter dígitos).
      if (cm && !/[\p{L}\p{N}_.]/u.test(rest.slice(cm[0].length, cm[0].length + 1))) {
        const pos = parseA1(cm[0])!;
        out += `[${cellRef(pos.c, pos.r)}]`;
        i += cm[0].length;
        continue;
      }
      // identificador comum (função/booleano): copia a palavra inteira
      let j = i;
      while (j < src.length && /[\p{L}\p{N}_.]/u.test(src[j])) j += 1;
      out += src.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return { ok: true, text: out };
}

/** Compila "=SOMA(A1:B2)+C3" para uma Formula com refs cell:<c>:<r>. */
export function compileCellFormula(
  source: string,
  dims: { rows: number; cols: number }
): TokenizeResult {
  const body = source.trim().replace(/^=/, "");
  const pre = preprocessA1(body, dims);
  if (!pre.ok) return pre;
  // Catálogo: todas as células da grade atual (ref bruta cell:<c>:<r>). O
  // tokenizador resolve [cell:…] por ref exata; rótulos A1 não entram (a
  // tradução A1→ref já aconteceu no pré-processador).
  const catalog: { ref: string; label: string }[] = [];
  for (let r = 0; r < dims.rows; r += 1) {
    for (let c = 0; c < dims.cols; c += 1) {
      catalog.push({ ref: cellRef(c, r), label: `${colLetter(c)}${r + 1}` });
    }
  }
  return tokenizeFormulaText(pre.text, catalog);
}

export interface CellFormulaInput {
  // Fonte crua ("=…") por chave de célula ("rowKey:colKey").
  formulas: Map<string, string>;
  // chave da célula na posição (c,r) da grade renderizada; null fora dela.
  keyAt: (c: number, r: number) => string | null;
  // Valor base (não-fórmula) de uma célula: número/texto/booleano/null.
  baseValue: (key: string) => FormulaResult;
  dims: { rows: number; cols: number };
}

export interface CellFormulaOutput {
  values: Map<string, FormulaResult>;
  errors: Map<string, string>; // mensagem por célula (sintaxe, ciclo…)
}

// Avalia todas as fórmulas de célula: resolve dependências sob demanda
// (memoizado); ciclo marca as células envolvidas com "#CICLO!"; ref fora da
// grade vale null. Nunca lança.
export function computeCellFormulas(input: CellFormulaInput): CellFormulaOutput {
  const { formulas, keyAt, baseValue, dims } = input;
  const values = new Map<string, FormulaResult>();
  const errors = new Map<string, string>();

  const compiled = new Map<
    string,
    { ok: true; formula: Formula } | { ok: false; error: string }
  >();
  for (const [key, src] of formulas) {
    const comp = compileCellFormula(src, dims);
    if (!comp.ok) {
      compiled.set(key, comp);
      continue;
    }
    // A tokenização é léxica; a checagem ESTRUTURAL (parênteses, aridade das
    // funções…) vem do mesmo parser da avaliação. Refs já foram resolvidas
    // pelo pré-processador, então entram todas como permitidas.
    const val = validateFormula(
      comp.formula,
      new Set(formulaRefs(comp.formula))
    );
    compiled.set(
      key,
      val.ok ? comp : { ok: false, error: val.error ?? "Fórmula inválida." }
    );
  }

  const stack: string[] = [];
  const inStack = new Set<string>();

  const valueOf = (key: string): FormulaResult => {
    if (!formulas.has(key)) return baseValue(key);
    if (values.has(key)) return values.get(key) ?? null;
    if (inStack.has(key)) {
      // Ciclo: marca toda a corrente a partir da primeira ocorrência.
      for (let i = stack.indexOf(key); i < stack.length; i += 1) {
        errors.set(stack[i], "#CICLO!");
        values.set(stack[i], null);
      }
      return null;
    }
    const comp = compiled.get(key)!;
    if (!comp.ok) {
      errors.set(key, comp.error);
      values.set(key, null);
      return null;
    }
    stack.push(key);
    inStack.add(key);
    const ctx: Record<string, unknown> = {};
    for (const ref of formulaRefs(comp.formula)) {
      const pos = parseCellRef(ref);
      const k2 = pos ? keyAt(pos.c, pos.r) : null;
      ctx[ref] = k2 ? valueOf(k2) : null;
    }
    stack.pop();
    inStack.delete(key);
    if (values.has(key)) return values.get(key) ?? null; // marcada por ciclo
    const v = evaluateFormula(comp.formula, ctx);
    values.set(key, v);
    return v;
  };

  for (const key of formulas.keys()) valueOf(key);
  return { values, errors };
}

/** Exibição pt-BR de um resultado de fórmula de célula. */
export function formatFormulaResult(v: FormulaResult): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "VERDADEIRO" : "FALSO";
  if (typeof v === "number")
    return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return v;
}
