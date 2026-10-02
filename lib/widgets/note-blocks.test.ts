// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): markdown leve do bloco de texto — blocos, ênfase, link
//   externo seguro, comentário de autor e o índice GLOBAL das expressões.
import { describe, expect, it } from "vitest";

import { buildNoteBlocks, hasNoteMarkup } from "./note-blocks";
import { parseNoteTemplate } from "./note-template";

const blocks = (text: string) => buildNoteBlocks(parseNoteTemplate(text).parts);

describe("markdown leve da nota", () => {
  it("texto sem marcação segue no caminho antigo", () => {
    expect(hasNoteMarkup("Cálculos auditáveis.\nMetas: slide 9.")).toBe(false);
    expect(hasNoteMarkup("R$ 10 * 2 * 3")).toBe(false);
    expect(hasNoteMarkup("")).toBe(false);
  });

  it("reconhece os blocos por linha", () => {
    const b = blocks("^^ COMERCIAL\n# Metas\n## Sub\n- um\n- dois\n1. a\n> nota\n---\nfim");
    expect(b.map((x) => x.type)).toEqual([
      "kicker", "h1", "h2", "li", "li", "oli", "quote", "rule", "p",
    ]);
    expect(b[1].runs).toEqual([{ kind: "text", text: "Metas" }]);
  });

  it("comentário do autor vira bloco próprio (o render o esconde fora da edição)", () => {
    const b = blocks("Texto\n(( Cole aqui os links ))");
    expect(b[1]).toEqual({ type: "comment", runs: [{ kind: "text", text: "Cole aqui os links" }] });
    expect(hasNoteMarkup("(( rascunho ))")).toBe(true);
  });

  it("ênfase só com par fechado e colado ao texto", () => {
    const [p] = blocks("um **dois** e *três* fim");
    expect(p.runs).toEqual([
      { kind: "text", text: "um " },
      { kind: "text", text: "dois", bold: true },
      { kind: "text", text: " e " },
      { kind: "text", text: "três", italic: true },
      { kind: "text", text: " fim" },
    ]);
    const [lit] = blocks("R$ 10 * 2 * 3 **");
    expect(lit.runs).toEqual([{ kind: "text", text: "R$ 10 * 2 * 3 **" }]);
  });

  it("link externo só http/https/mailto; javascript: fica literal", () => {
    const [ok] = blocks("[Planilha](https://docs.google.com/x)");
    expect(ok.runs).toEqual([
      { kind: "url", label: "Planilha", href: "https://docs.google.com/x" },
    ]);
    const [bad] = blocks("[x](javascript:alert(1))");
    expect(bad.runs.every((r) => r.kind === "text")).toBe(true);
  });

  it("expressões mantêm o índice global através das linhas", () => {
    const b = blocks("# Total {=SOMA([A])}\n- **{=SOMA([B])}** clientes");
    expect(b[0].runs[1]).toMatchObject({ kind: "expr", index: 0 });
    expect(b[1].runs[0]).toMatchObject({ kind: "expr", index: 1, bold: true });
  });

  it("lista numerada conta e reinicia após outro bloco", () => {
    const b = blocks("1. a\n2. b\n\n1. c");
    expect(b.filter((x) => x.type === "oli").map((x) => x.n)).toEqual([1, 2, 1]);
  });
});
