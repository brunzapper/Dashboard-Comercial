// Versão: 1.0 | Data: 19/07/2026
// Dependências entre campos calculados (aninhamento, 19/07/2026): grafo de
// referências `custom:<key>` entre defs com fórmula (calculado e
// calculado_agg), com detecção de ciclo no salvamento, dependentes transitivos
// (exclusão de operandos na UI/servidor), ordenação topológica da
// materialização por registro e expansão de tokens do aninhamento de
// agregados. Módulo PURO (client+server): a página /campos usa os dependentes
// transitivos no browser e as server actions usam o resto.
//
// Arestas possíveis do grafo unificado: calculado→calculado, agg→calculado e
// agg→agg. Um `calculado` por registro nunca referencia um `calculado_agg`
// (catálogos não oferecem), e refs `match:<fonte>:<ref>` não geram aresta —
// os operandos de registro casado são só datas/condições, nunca calculados.

import {
  isCondAggFunc,
  formulaRefs,
  type Formula,
  type FormulaFieldDef,
  type FormulaToken,
} from "@/lib/records/formulas";

/**
 * Chave do campo personalizado referenciado por um ref de OPERANDO da fórmula:
 * `custom:<k>` e `agg:sum|avg|count:custom:<k>` → k; demais refs (colunas do
 * núcleo, `match:`, `agg:*:<core>`, `cell:`) → null. Refs `match:` ficam de
 * fora de propósito: apontam para OUTRO registro (sem aresta de dependência
 * ordenável) — para saber se uma fórmula usa um campo em qualquer forma
 * (inclusive match), use formulaReferencesField.
 */
export function refCustomKey(ref: string): string | null {
  if (ref.startsWith("custom:")) return ref.slice("custom:".length);
  if (ref.startsWith("agg:")) {
    const rest = ref.slice("agg:".length);
    const idx = rest.indexOf(":");
    if (idx === -1) return null;
    const field = rest.slice(idx + 1);
    return field.startsWith("custom:") ? field.slice("custom:".length) : null;
  }
  return null;
}

/**
 * A fórmula referencia o campo `fieldKey` em QUALQUER forma? Cobre operandos
 * (`custom:`), agregações (`agg:*:custom:`, inclusive alvos/condições de
 * SOMASE — formulaRefs é scan de tokens) e o registro casado
 * (`match:<fonte>:custom:<k>`). Usada pela guarda de exclusão de campo.
 */
export function formulaReferencesField(
  formula: Formula | null | undefined,
  fieldKey: string
): boolean {
  if (!formula) return false;
  const suffix = `custom:${fieldKey}`;
  return formulaRefs(formula).some((ref) => {
    if (refCustomKey(ref) === fieldKey) return true;
    return ref.startsWith("match:") && ref.endsWith(`:${suffix}`);
  });
}

/**
 * Arestas diretas de dependência de uma fórmula: chaves de campos
 * personalizados referenciadas para as quais `isFormulaKey` responde true
 * (i.e., a chave é de um def com fórmula). Deduplicadas.
 */
export function formulaDependencyKeys(
  formula: Formula | null | undefined,
  isFormulaKey: (key: string) => boolean
): string[] {
  if (!formula) return [];
  const out = new Set<string>();
  for (const ref of formulaRefs(formula)) {
    const key = refCustomKey(ref);
    if (key != null && isFormulaKey(key)) out.add(key);
  }
  return [...out];
}

/** Linha mínima de field_definitions para montar o grafo de dependências. */
export interface FormulaDepDef {
  field_key: string;
  data_type: string;
  formula?: Formula | null;
}

// Mapa chave → fórmula SÓ dos defs com fórmula (calculado/calculado_agg com
// tokens) — os nós do grafo. Campos sem fórmula não propagam dependência.
function formulaNodesOf(defs: FormulaDepDef[]): Map<string, Formula> {
  const nodes = new Map<string, Formula>();
  for (const d of defs) {
    if (
      (d.data_type === "calculado" || d.data_type === "calculado_agg") &&
      d.formula &&
      Array.isArray(d.formula.tokens) &&
      d.formula.tokens.length > 0
    ) {
      nodes.set(d.field_key, d.formula);
    }
  }
  return nodes;
}

/**
 * Ciclo que a fórmula `candidate` do campo `fieldKey` criaria sobre o grafo
 * unificado. Como só as arestas de `fieldKey` mudam, qualquer ciclo novo passa
 * por ele: DFS a partir da candidata; retorna o caminho de chaves
 * ["a","b","a"] (para exibir com rótulos) ou null. Roda no salvamento
 * (create/updateField) — é a única trava de ciclo do sistema.
 */
export function findFormulaCycle(
  fieldKey: string,
  candidate: Formula,
  defs: FormulaDepDef[]
): string[] | null {
  const nodes = formulaNodesOf(defs);
  nodes.set(fieldKey, candidate);
  const isNode = (k: string) => nodes.has(k);
  const path: string[] = [fieldKey];
  const visited = new Set<string>();
  const dfs = (key: string): string[] | null => {
    const formula = nodes.get(key);
    if (!formula) return null;
    for (const dep of formulaDependencyKeys(formula, isNode)) {
      if (dep === fieldKey) return [...path, fieldKey];
      if (visited.has(dep)) continue;
      visited.add(dep);
      path.push(dep);
      const found = dfs(dep);
      if (found) return found;
      path.pop();
    }
    return null;
  };
  return dfs(fieldKey);
}

/**
 * Dependentes transitivos de `fieldKey`: chaves de defs cuja fórmula o
 * referencia direta ou indiretamente. São os campos PROIBIDOS como operando ao
 * editar `fieldKey` (o próprio campo não entra — o chamador o inclui).
 */
export function transitiveFormulaDependents(
  fieldKey: string,
  defs: FormulaDepDef[]
): Set<string> {
  const nodes = formulaNodesOf(defs);
  const isNode = (k: string) => nodes.has(k) || k === fieldKey;
  // Adjacência reversa: dependência → dependentes diretos.
  const dependents = new Map<string, string[]>();
  for (const [key, formula] of nodes) {
    for (const dep of formulaDependencyKeys(formula, isNode)) {
      if (dep === key) continue;
      const list = dependents.get(dep);
      if (list) list.push(key);
      else dependents.set(dep, [key]);
    }
  }
  const out = new Set<string>();
  const queue = [fieldKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    for (const dep of dependents.get(key) ?? []) {
      if (out.has(dep)) continue;
      out.add(dep);
      queue.push(dep);
    }
  }
  return out;
}

/**
 * Ordena defs de materialização (calculado por registro) por dependência
 * (Kahn), preservando a ordem original entre independentes. Membros de ciclo
 * residual no banco (estado legado — o salvamento rejeita ciclos) saem em
 * `cyclic` e devem materializar null. Sem arestas, `ordered` é a lista
 * original (fast path das fórmulas legadas).
 */
export function orderFormulaDefs(defs: FormulaFieldDef[]): {
  ordered: FormulaFieldDef[];
  cyclic: Set<string>;
} {
  const byKey = new Map(defs.map((d) => [d.field_key, d]));
  const isNode = (k: string) => byKey.has(k);
  const depsOf = new Map<string, string[]>();
  let hasEdges = false;
  for (const d of defs) {
    const deps = formulaDependencyKeys(d.formula, isNode).filter(
      (k) => k !== d.field_key
    );
    depsOf.set(d.field_key, deps);
    if (deps.length > 0) hasEdges = true;
  }
  if (!hasEdges) return { ordered: defs, cyclic: new Set() };

  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const d of defs) indegree.set(d.field_key, 0);
  for (const [key, deps] of depsOf) {
    for (const dep of deps) {
      indegree.set(key, (indegree.get(key) ?? 0) + 1);
      const list = dependents.get(dep);
      if (list) list.push(key);
      else dependents.set(dep, [key]);
    }
  }
  const ordered: FormulaFieldDef[] = [];
  const queue = defs
    .filter((d) => (indegree.get(d.field_key) ?? 0) === 0)
    .map((d) => d.field_key);
  while (queue.length > 0) {
    const key = queue.shift()!;
    ordered.push(byKey.get(key)!);
    for (const dep of dependents.get(key) ?? []) {
      const n = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, n);
      if (n === 0) queue.push(dep);
    }
  }
  const cyclic = new Set<string>();
  if (ordered.length < defs.length) {
    for (const d of defs) {
      if (!ordered.includes(d)) cyclic.add(d.field_key);
    }
  }
  return { ordered, cyclic };
}

// Teto de tokens da fórmula expandida: aninhamento em "diamante" (X usado N
// vezes por Y, que é usado N vezes por Z...) cresce multiplicativo — acima do
// teto a expansão é abortada e a fórmula ORIGINAL é devolvida (refs aninhados
// não expandidos avaliam para null, mesma degradação do ciclo residual).
const MAX_EXPANDED_TOKENS = 2000;

class ExpansionOverflow extends Error {}

/**
 * Expansão do aninhamento de AGREGADOS: substitui cada token
 * `{kind:"field", ref:"custom:<k>"}` cuja def é `calculado_agg` com fórmula
 * pela fórmula aninhada entre parênteses (recursivamente). Aplicada em runtime
 * nos choke points do engine (resolveCalcMetric / runCalculatedWidget) — a
 * fórmula persistida continua referenciando o campo, então editar o campo
 * aninhado propaga. Regras:
 *  - regiões de SOMASE/CONT.SE/MÉDIASE são copiadas VERBATIM (os argumentos
 *    são estruturais — alvo deve ser ref cru e condição `[Coluna] op literal`;
 *    a validação de save já rejeita refs aninhados ali);
 *  - ciclo residual no banco: o ref fica sem expandir e avalia para null em
 *    evalCalcMoney ("—"), nunca loop;
 *  - fórmula sem ref aninhado retorna o MESMO objeto (fast path);
 *  - `source` é descartado na expandida (transiente de runtime — o round-trip
 *    do editor usa a fórmula persistida).
 */
export function expandAggFormula(
  formula: Formula,
  getDef: (
    key: string
  ) => { data_type?: string; formula?: Formula | null } | undefined
): Formula {
  const nestedFormulaOf = (ref: string): Formula | null => {
    if (!ref.startsWith("custom:")) return null;
    const def = getDef(ref.slice("custom:".length));
    if (!def || def.data_type !== "calculado_agg") return null;
    const f = def.formula;
    return f && Array.isArray(f.tokens) && f.tokens.length > 0 ? f : null;
  };
  if (
    !formula.tokens.some((t) => t.kind === "field" && nestedFormulaOf(t.ref))
  ) {
    return formula;
  }

  let count = 0;
  const push = (out: FormulaToken[], t: FormulaToken): void => {
    if (++count > MAX_EXPANDED_TOKENS) throw new ExpansionOverflow();
    out.push(t);
  };
  const expand = (
    tokens: FormulaToken[],
    visited: Set<string>
  ): FormulaToken[] => {
    const out: FormulaToken[] = [];
    // Região de chamada cond-agg em aberto: profundidade de parênteses (>0) ou
    // aguardando o '(' logo após o nome da função.
    let condParens = 0;
    let awaitingCondParen = false;
    for (const t of tokens) {
      if (condParens > 0 || awaitingCondParen) {
        push(out, t);
        if (awaitingCondParen) {
          if (t.kind === "lparen") {
            condParens += 1;
            awaitingCondParen = false;
          } else if (t.kind !== "func" || !isCondAggFunc(t.name)) {
            awaitingCondParen = false; // fórmula malformada: sai da região
          }
        } else if (t.kind === "lparen") condParens += 1;
        else if (t.kind === "rparen") condParens -= 1;
        continue;
      }
      if (t.kind === "func" && isCondAggFunc(t.name)) {
        push(out, t);
        awaitingCondParen = true;
        continue;
      }
      if (t.kind === "field") {
        const nested = nestedFormulaOf(t.ref);
        const key = t.ref.slice("custom:".length);
        if (nested && !visited.has(key)) {
          push(out, { kind: "lparen" });
          const sub = expand(nested.tokens, new Set(visited).add(key));
          for (const s of sub) out.push(s); // já contados no expand interno
          push(out, { kind: "rparen" });
          continue;
        }
      }
      push(out, t);
    }
    return out;
  };
  try {
    return { tokens: expand(formula.tokens, new Set()) };
  } catch (e) {
    if (e instanceof ExpansionOverflow) return formula;
    throw e;
  }
}
