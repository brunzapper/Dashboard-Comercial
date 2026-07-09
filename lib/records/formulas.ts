// Versão: 1.0 | Data: 09/07/2026
// Campos calculados (Fase 7): modelo de fórmula estruturada + avaliador puro
// (shunting-yard → RPN, SEM eval) usado para materializar o valor por registro.
// Operandos são referências a colunas numéricas ('value','mrr','lead_time_days')
// ou campos personalizados numéricos ('custom:<key>') e constantes. Operadores
// + − × ÷ com precedência e parênteses. Null-safe: operando ausente/não-numérico
// ou divisão por zero => resultado null (não engana com zero).

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

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Referências (refs) usadas por uma fórmula — útil para validação/recompute. */
export function formulaRefs(formula: Formula): string[] {
  return formula.tokens
    .filter((t): t is { kind: "field"; ref: string } => t.kind === "field")
    .map((t) => t.ref);
}

/**
 * Avalia a fórmula contra um contexto ref→valor. Qualquer operando null/NaN ou
 * divisão por zero propaga null. Fórmula estruturalmente inválida também => null
 * (a validação forte acontece no save, aqui só protegemos a execução).
 */
export function evaluateFormula(
  formula: Formula,
  ctx: Record<string, number | null>
): number | null {
  const output: (number | null)[] = [];
  const ops: (FormulaOp | "(")[] = [];

  const applyTop = () => {
    const op = ops.pop();
    if (op === "(" || op === undefined) return;
    const b = output.pop();
    const a = output.pop();
    if (a == null || b == null) {
      output.push(null);
      return;
    }
    let r: number | null;
    switch (op) {
      case "+": r = a + b; break;
      case "-": r = a - b; break;
      case "*": r = a * b; break;
      case "/": r = b === 0 ? null : a / b; break;
      default: r = null;
    }
    output.push(r != null && Number.isFinite(r) ? r : null);
  };

  for (const t of formula.tokens) {
    if (t.kind === "field") {
      output.push(ctx[t.ref] ?? null);
    } else if (t.kind === "const") {
      output.push(Number.isFinite(t.value) ? t.value : null);
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
  return output[0];
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
  allowedRefs: Set<string>
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
        if (!allowedRefs.has(t.ref)) {
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
}

/** Carrega as definições de campos calculados (data_type='calculado'). */
export async function loadFormulaDefs(
  db: import("@supabase/supabase-js").SupabaseClient
): Promise<FormulaFieldDef[]> {
  const { data } = await db
    .from("field_definitions")
    .select("field_key, formula")
    .eq("data_type", "calculado");
  return (data ?? [])
    .map((r) => ({
      field_key: r.field_key as string,
      formula: (r.formula as Formula | null) ?? null,
    }))
    .filter((d) => d.formula != null);
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
  formulaDefs: FormulaFieldDef[]
): Record<string, number | null> {
  const ctx: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(coreValues)) ctx[k] = v;
  for (const [k, v] of Object.entries(customFields)) ctx[`custom:${k}`] = toNum(v);

  const out: Record<string, number | null> = {};
  for (const def of formulaDefs) {
    if (!def.formula) continue;
    out[def.field_key] = evaluateFormula(def.formula, ctx);
  }
  return out;
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
