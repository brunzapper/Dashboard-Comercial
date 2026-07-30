// Versão: 1.0 | Data: 30/07/2026
// Testes dos helpers puros da assistência do editor de fórmulas: função
// envolvente do caret (assinatura viva), intervalo da ref em edição (o fix do
// `]` órfão), gatilho do autocomplete de funções e a busca sem acentos.
import { describe, expect, it } from "vitest";

import {
  activeCall,
  bracketRangeAt,
  funcWordAt,
  matchFunctions,
  normalizeSearch,
} from "@/lib/records/formula-assist";

// Caret na posição do "|" do template (removido do texto).
function at(template: string): { text: string; caret: number } {
  const caret = template.indexOf("|");
  if (caret < 0) throw new Error("template sem |");
  return { text: template.replace("|", ""), caret };
}

describe("activeCall", () => {
  it("função simples, primeiro argumento", () => {
    const { text, caret } = at("SOMASE(|");
    expect(activeCall(text, caret)).toEqual({ name: "SOMASE", argIndex: 0 });
  });

  it("`;` avança o índice do argumento", () => {
    const { text, caret } = at('SE([Etapa] = "Ganho"; [Valor]; |');
    expect(activeCall(text, caret)).toEqual({ name: "SE", argIndex: 2 });
  });

  it("chamada aninhada devolve a função MAIS interna", () => {
    const { text, caret } = at("SE(E([Valor] > 0; |); 1; 0)");
    expect(activeCall(text, caret)).toEqual({ name: "E", argIndex: 1 });
  });

  it("grupo de parênteses sem função é transparente", () => {
    const { text, caret } = at("SOMASE([Valor]; ([Valor] > |0))");
    expect(activeCall(text, caret)).toEqual({ name: "SOMASE", argIndex: 1 });
  });

  it("`;` dentro de string ou de colchete não conta argumento", () => {
    const { text, caret } = at('SE([Etapa] = "a;b"; [x;y]; |');
    expect(activeCall(text, caret)).toEqual({ name: "SE", argIndex: 2 });
  });

  it("caret fora de chamada → null", () => {
    const { text, caret } = at("[Valor] + 1|");
    expect(activeCall(text, caret)).toBeNull();
  });

  it("caret após fechar a chamada → null", () => {
    const { text, caret } = at("CONT.SE([Etapa] = 1)|");
    expect(activeCall(text, caret)).toBeNull();
  });

  it("string não fechada mantém o frame da função", () => {
    const { text, caret } = at('SOMASE([Valor]; [Etapa] = "Ga|');
    expect(activeCall(text, caret)).toEqual({ name: "SOMASE", argIndex: 1 });
  });

  it("alias em minúsculas resolve a função canônica", () => {
    const { text, caret } = at("somase([Valor]; |");
    expect(activeCall(text, caret)).toEqual({ name: "SOMASE", argIndex: 1 });
  });

  it("função com ponto (CONT.SE) é reconhecida", () => {
    const { text, caret } = at("CONT.SE(|");
    expect(activeCall(text, caret)).toEqual({ name: "CONT.SE", argIndex: 0 });
  });
});

describe("bracketRangeAt", () => {
  it("colchete aberto: intervalo até o caret, query parcial", () => {
    const { text, caret } = at("1 + [Val|");
    expect(bracketRangeAt(text, caret)).toEqual({
      start: 4,
      end: caret,
      query: "Val",
    });
  });

  it("caret DENTRO de ref completa cobre o `]` (sem órfão)", () => {
    const { text, caret } = at("[Val|or] + 1");
    const r = bracketRangeAt(text, caret);
    expect(r).toEqual({ start: 0, end: 7, query: "Val" });
    // Substituir [start,end) por outra ref não deixa resto: "[Valor] + 1" →
    // "[MRR] + 1".
    expect(text.slice(0, r!.start) + "[MRR]" + text.slice(r!.end)).toBe(
      "[MRR] + 1"
    );
  });

  it("fora de colchete → null; dentro de string → null", () => {
    expect(bracketRangeAt("[Valor] + 1", 11)).toBeNull();
    const { text, caret } = at('[Etapa] = "a[b|');
    expect(bracketRangeAt(text, caret)).toBeNull();
  });
});

describe("funcWordAt", () => {
  it("palavra parcial fora de colchete dispara", () => {
    const { text, caret } = at("1 + som|");
    expect(funcWordAt(text, caret)).toEqual({ start: 4, word: "som" });
  });

  it("dentro de colchete/string ou número puro → null", () => {
    expect(funcWordAt("[som", 4)).toBeNull();
    expect(funcWordAt('"som', 4)).toBeNull();
    expect(funcWordAt("123", 3)).toBeNull();
  });

  it("não dispara colado num `(` já digitado", () => {
    const { text, caret } = at("SOMASE|(x)");
    expect(funcWordAt(text, caret)).toBeNull();
  });
});

describe("matchFunctions / normalizeSearch", () => {
  it("prefixo sem acento encontra MÉDIA e MÍN", () => {
    const names = matchFunctions("me", "record").map((f) => f.name);
    expect(names).toContain("MÉDIA");
    const min = matchFunctions("min", "record").map((f) => f.name);
    expect(min).toContain("MÍN");
  });

  it("alias em inglês encontra a canônica (count → CONT.NÚM)", () => {
    const names = matchFunctions("count", "aggregate").map((f) => f.name);
    expect(names).toContain("CONT.NÚM");
  });

  it("contexto record esconde as aggOnly", () => {
    const names = matchFunctions("s", "record").map((f) => f.name);
    expect(names).toContain("SE");
    expect(names).toContain("SOMA");
    expect(names).not.toContain("SOMASE");
  });

  it("normalizeSearch tira acento e caixa", () => {
    expect(normalizeSearch("MÉDIA")).toBe("media");
    expect(normalizeSearch("  Média  ")).toBe("media");
  });
});
