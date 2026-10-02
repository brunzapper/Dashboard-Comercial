// Versão: 1.0 | Data: 02/10/2026
// Formatação da Nota pelo editor (lib/widgets/note-format.ts): a sintaxe gerada
// é a mesma que buildNoteBlocks interpreta.
import { describe, expect, it } from "vitest";

import { applyNoteFormat } from "./note-format";
import { buildNoteBlocks } from "./note-blocks";
import { parseNoteTemplate } from "./note-template";

describe("applyNoteFormat", () => {
  it("título na linha do cursor e alterna ao repetir", () => {
    const a = applyNoteFormat("Metas\nTexto", 2, 2, "titulo");
    expect(a.text).toBe("# Metas\nTexto");
    const b = applyNoteFormat(a.text, 3, 3, "titulo");
    expect(b.text).toBe("Metas\nTexto");
  });

  it("troca um prefixo de bloco por outro", () => {
    expect(applyNoteFormat("# Metas", 0, 0, "kicker").text).toBe("^^ Metas");
  });

  it("lista em várias linhas selecionadas", () => {
    const t = "um\ndois\ntrês";
    expect(applyNoteFormat(t, 0, t.length, "lista").text).toBe("- um\n- dois\n- três");
  });

  it("negrito envolve a seleção; sem seleção, um texto-modelo selecionado", () => {
    expect(applyNoteFormat("o MRR sobe", 2, 5, "negrito").text).toBe("o **MRR** sobe");
    const r = applyNoteFormat("x", 1, 1, "negrito");
    expect(r.text).toBe("x**texto**");
    expect(r.text.slice(r.selStart, r.selEnd)).toBe("texto");
  });

  it("filete numa linha própria e comentário de autor", () => {
    expect(applyNoteFormat("a", 1, 1, "filete").text).toBe("a\n---\n");
    expect(applyNoteFormat("", 0, 0, "autor").text).toBe("(( nota para quem edita ))");
  });

  it("o texto gerado vira os blocos que a Nota renderiza", () => {
    let t = "Seção\nTítulo\nitem";
    t = applyNoteFormat(t, 0, 0, "kicker").text;
    t = applyNoteFormat(t, t.indexOf("Título"), t.indexOf("Título"), "titulo").text;
    t = applyNoteFormat(t, t.length, t.length, "lista").text;
    const types = buildNoteBlocks(parseNoteTemplate(t).parts).map((b) => b.type);
    expect(types).toEqual(["kicker", "h1", "li"]);
  });
});
