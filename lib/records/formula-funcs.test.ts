// Versão: 1.0 | Data: 30/07/2026
// Guarda do catálogo de metadados de função: cada `example` precisa TOKENIZAR
// (mesmo tokenizador dos editores) e PARSEAR (aridade/forma dos argumentos no
// parser real) — se a assinatura de uma função mudar no parser sem atualizar o
// catálogo, este teste quebra. Também trava a derivação do FORMULA_FUNC_GROUPS
// (SPEC da IA) sobre o mesmo catálogo.
import { describe, expect, it } from "vitest";

import {
  FORMULA_FUNC_LIST,
  FORMULA_FUNCS,
  funcSignature,
} from "@/lib/records/formula-funcs";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import { validateFormula } from "@/lib/records/formulas";
import { FORMULA_FUNC_GROUPS } from "@/lib/import/dashboard/settings-docs";
import type { OperandRef } from "@/lib/records/date-operands";

// Catálogo sintético cobrindo os rótulos usados nos exemplos.
const CATALOG: OperandRef[] = [
  { ref: "value", label: "Valor" },
  { ref: "custom:meta", label: "Meta" },
  { ref: "stage", label: "Etapa" },
  { ref: "agg:sum:value", label: "Σ Valor" },
];
const REFS = new Set(CATALOG.map((o) => o.ref));

describe("FORMULA_FUNCS", () => {
  for (const spec of FORMULA_FUNC_LIST) {
    it(`exemplo de ${spec.name} tokeniza e parseia`, () => {
      const tok = tokenizeFormulaText(spec.example, CATALOG);
      expect(tok.ok, !tok.ok ? tok.error : undefined).toBe(true);
      if (!tok.ok) return;
      const v = validateFormula(tok.formula, REFS);
      expect(v.ok, v.ok ? undefined : v.error).toBe(true);
    });
  }

  it("exemplo menciona a própria função (exceto operandos puros)", () => {
    for (const spec of FORMULA_FUNC_LIST) {
      expect(spec.example).toContain(spec.name);
    }
  });

  it("assinaturas variádicas ganham reticências", () => {
    expect(funcSignature(FORMULA_FUNCS.E)).toBe("E(cond1; cond2; …)");
    expect(funcSignature(FORMULA_FUNCS.SE)).toBe("SE(condição; então; senão)");
    expect(funcSignature(FORMULA_FUNCS.ABS)).toBe("ABS(valor)");
  });

  it("FORMULA_FUNC_GROUPS (SPEC da IA) deriva do catálogo, mesma ordem", () => {
    expect(Object.keys(FORMULA_FUNC_GROUPS)).toEqual(
      FORMULA_FUNC_LIST.map((f) => f.name)
    );
    for (const f of FORMULA_FUNC_LIST) {
      expect(FORMULA_FUNC_GROUPS[f.name]).toBe(f.group);
    }
  });
});
