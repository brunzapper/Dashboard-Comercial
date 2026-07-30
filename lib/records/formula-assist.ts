// Versão: 1.0 | Data: 30/07/2026
// Helpers PUROS da assistência do editor de fórmulas (texto + caret):
//  - activeCall: função envolvente do caret + índice do argumento atual —
//    alimenta a assinatura viva (SignatureHelp).
//  - bracketRangeAt: intervalo da referência [Coluna] em edição no caret —
//    inclui o `]` quando o caret está DENTRO de uma ref completa, para o
//    autocomplete substituir a ref inteira (nunca deixar `]` órfão).
//  - funcWordAt: identificador parcial no caret (fora de colchete/aspas) —
//    alimenta o autocomplete de funções.
//  - matchFunctions: prefixo → funções candidatas (nomes canônicos + aliases
//    do tokenizador), respeitando o contexto (aggOnly).
//  - normalizeSearch: busca sem acentos/caixa (pt-BR).
// Tudo espelha o LÉXICO do tokenizador (formula-text.ts): strings com "" de
// escape, refs [..] sem aninhamento, identificadores com '.' interno.
import {
  FORMULA_FUNC_LIST,
  type FormulaFuncSpec,
} from "@/lib/records/formula-funcs";
import { FUNC_NAMES } from "@/lib/records/formula-text";
import type { FormulaFuncName } from "@/lib/records/formulas";

const IDENT = /[\p{L}\p{N}_]/u;

export interface AssistFrame {
  /** null = grupo de parênteses sem função (agrupamento aritmético). */
  name: FormulaFuncName | null;
  /** Argumento corrente (0-based), contado pelos `;` no nível deste frame. */
  argIndex: number;
}

export interface AssistContext {
  /** Pilha de parênteses abertos até o caret (topo = mais interno). */
  frames: AssistFrame[];
  /** Início do `[` aberto que contém o caret (null = fora de ref). */
  bracketStart: number | null;
  /** Caret dentro de uma string literal não fechada. */
  inString: boolean;
}

/** Varre text[0..caret) uma vez e devolve o contexto léxico do caret. */
export function scanContext(text: string, caret: number): AssistContext {
  const frames: AssistFrame[] = [];
  let bracketStart: number | null = null;
  let inString = false;
  let i = 0;
  while (i < caret) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      // String literal; aspas duplicadas escapam ("" → ").
      let j = i + 1;
      let closed = false;
      while (j < caret) {
        if (text[j] === ch) {
          if (j + 1 < caret && text[j + 1] === ch) {
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (!closed) {
        inString = true;
        break;
      }
      i = j;
      continue;
    }
    if (ch === "[") {
      const end = text.indexOf("]", i + 1);
      if (end < 0 || end >= caret) {
        bracketStart = i;
        break;
      }
      i = end + 1;
      continue;
    }
    if (ch === "(") {
      frames.push({ name: null, argIndex: 0 });
      i += 1;
      continue;
    }
    if (ch === ")") {
      frames.pop();
      i += 1;
      continue;
    }
    if (ch === ";") {
      const top = frames[frames.length - 1];
      if (top) top.argIndex += 1;
      i += 1;
      continue;
    }
    if (IDENT.test(ch)) {
      // Identificador com '.' interno (CONT.SE) — mesma regra do tokenizador.
      let j = i;
      while (j < caret && IDENT.test(text[j])) j += 1;
      while (text[j] === "." && j + 1 < caret && IDENT.test(text[j + 1])) {
        j += 1;
        while (j < caret && IDENT.test(text[j])) j += 1;
      }
      const word = text.slice(i, j);
      let k = j;
      while (k < caret && /\s/.test(text[k])) k += 1;
      if (k < caret && text[k] === "(") {
        frames.push({
          name: FUNC_NAMES[word.toLocaleLowerCase("pt-BR")] ?? null,
          argIndex: 0,
        });
        i = k + 1;
      } else {
        i = j;
      }
      continue;
    }
    i += 1;
  }
  return { frames, bracketStart, inString };
}

export interface ActiveCall {
  name: FormulaFuncName;
  argIndex: number;
}

/**
 * Função mais interna que envolve o caret + índice do argumento corrente.
 * Grupos de parênteses sem função são transparentes: em
 * `SOMASE([Valor]; ([Valor] > |0))` a resposta é SOMASE, argumento 1.
 */
export function activeCall(text: string, caret: number): ActiveCall | null {
  const { frames } = scanContext(text, caret);
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    if (f.name) return { name: f.name, argIndex: f.argIndex };
  }
  return null;
}

export interface BracketRange {
  /** Índice do `[`. */
  start: number;
  /** Fim EXCLUSIVO da substituição (cobre o `]` de uma ref completa). */
  end: number;
  /** O que o usuário digitou entre `[` e o caret (filtro da lista). */
  query: string;
}

/** Ref de coluna em edição no caret (null = caret fora de `[…`/dentro de string). */
export function bracketRangeAt(
  text: string,
  caret: number
): BracketRange | null {
  const { bracketStart, inString } = scanContext(text, caret);
  if (inString || bracketStart == null) return null;
  // Caret DENTRO de uma ref já fechada ([Val|or]): substituir até o `]`.
  let end = caret;
  for (let i = caret; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "]") {
      end = i + 1;
      break;
    }
    if (ch === "[" || ch === "\n") break;
  }
  return { start: bracketStart, end, query: text.slice(bracketStart + 1, caret) };
}

export interface FuncWord {
  start: number;
  word: string;
}

/**
 * Identificador parcial imediatamente antes do caret, fora de colchete/aspas —
 * gatilho do autocomplete de funções. Exige ao menos uma letra (números puros
 * são literais) e não dispara colado num `(` já digitado (edição no meio de
 * `SOMASE(` não deve reabrir a lista).
 */
export function funcWordAt(text: string, caret: number): FuncWord | null {
  const { bracketStart, inString } = scanContext(text, caret);
  if (inString || bracketStart != null) return null;
  if (text[caret] === "(") return null;
  let start = caret;
  while (start > 0 && (IDENT.test(text[start - 1]) || text[start - 1] === "."))
    start -= 1;
  const word = text.slice(start, caret);
  if (!word || !/\p{L}/u.test(word)) return null;
  return { start, word };
}

/** Busca sem acentos e sem caixa (pt-BR), para filtro de sugestões. */
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

// alias normalizado → apelidos por função canônica (uma vez, no módulo).
const ALIASES_BY_FUNC = new Map<FormulaFuncName, string[]>();
for (const [alias, name] of Object.entries(FUNC_NAMES)) {
  const list = ALIASES_BY_FUNC.get(name) ?? [];
  list.push(normalizeSearch(alias));
  ALIASES_BY_FUNC.set(name, list);
}

/** Funções candidatas para o prefixo digitado, respeitando o contexto. */
export function matchFunctions(
  word: string,
  context: "record" | "aggregate"
): FormulaFuncSpec[] {
  const q = normalizeSearch(word);
  if (!q) return [];
  return FORMULA_FUNC_LIST.filter(
    (f) => context === "aggregate" || !f.aggOnly
  ).filter((f) =>
    (ALIASES_BY_FUNC.get(f.name) ?? [normalizeSearch(f.name)]).some((a) =>
      a.startsWith(q)
    )
  );
}
