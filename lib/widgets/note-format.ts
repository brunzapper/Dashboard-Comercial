// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): FORMATAÇÃO da Nota pelo editor. O markdown leve da Nota
//   (lib/widgets/note-blocks.ts — kicker ^^, títulos #/##, listas, filete ---,
//   **negrito**, *itálico* e o comentário de autor (( … ))) só era conhecido
//   por quem lia o preset ou o parágrafo da folha de Aparência. Este módulo
//   PURO aplica cada formato ao texto (na linha do cursor ou na seleção) e
//   devolve o texto novo + a posição do cursor: o editor só oferece os botões.
//   Gera EXATAMENTE a sintaxe que `buildNoteBlocks` interpreta — nada novo.

export type NoteFormatKind =
  | "titulo"
  | "subtitulo"
  | "kicker"
  | "lista"
  | "negrito"
  | "italico"
  | "filete"
  | "autor";

export const NOTE_FORMATS: { kind: NoteFormatKind; label: string; hint: string }[] = [
  { kind: "titulo", label: "Título", hint: "# no início da linha" },
  { kind: "subtitulo", label: "Subtítulo", hint: "## no início da linha" },
  { kind: "kicker", label: "Rótulo de seção (kicker)", hint: "^^ no início da linha" },
  { kind: "lista", label: "Item de lista", hint: "- no início da linha" },
  { kind: "negrito", label: "Negrito", hint: "**texto**" },
  { kind: "italico", label: "Itálico", hint: "*texto*" },
  { kind: "filete", label: "Filete (linha divisória)", hint: "--- numa linha" },
  { kind: "autor", label: "Comentário de autor", hint: "(( … )) — só aparece no modo edição" },
];

const LINE_PREFIX: Partial<Record<NoteFormatKind, string>> = {
  titulo: "# ",
  subtitulo: "## ",
  kicker: "^^ ",
  lista: "- ",
};
const BLOCK_PREFIX_RE = /^(#{1,3} |\^\^ |- )/;

const WRAP: Partial<Record<NoteFormatKind, [string, string, string]>> = {
  negrito: ["**", "**", "texto"],
  italico: ["*", "*", "texto"],
  autor: ["(( ", " ))", "nota para quem edita"],
};

/**
 * Aplica um formato. Formatos de LINHA trocam o prefixo das linhas tocadas
 * pela seleção (aplicar o mesmo de novo remove — alterna); de TRECHO envolvem
 * a seleção (sem seleção, um texto-modelo selecionável); o filete entra numa
 * linha própria.
 */
export function applyNoteFormat(
  text: string,
  selStart: number,
  selEnd: number,
  kind: NoteFormatKind
): { text: string; selStart: number; selEnd: number } {
  const start = Math.max(0, Math.min(selStart, text.length));
  const end = Math.max(start, Math.min(selEnd, text.length));

  const prefix = LINE_PREFIX[kind];
  if (prefix) {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nl = text.indexOf("\n", end);
    const lineEnd = nl < 0 ? text.length : nl;
    const lines = text.slice(lineStart, lineEnd).split("\n");
    const allHave = lines.every((l) => l.startsWith(prefix));
    const next = lines
      .map((l) => {
        const bare = l.replace(BLOCK_PREFIX_RE, "");
        return allHave ? bare : prefix + bare;
      })
      .join("\n");
    const out = text.slice(0, lineStart) + next + text.slice(lineEnd);
    return { text: out, selStart: lineStart, selEnd: lineStart + next.length };
  }

  const wrap = WRAP[kind];
  if (wrap) {
    const [open, close, placeholder] = wrap;
    const inner = end > start ? text.slice(start, end) : placeholder;
    const out = text.slice(0, start) + open + inner + close + text.slice(end);
    return {
      text: out,
      selStart: start + open.length,
      selEnd: start + open.length + inner.length,
    };
  }

  // filete: sempre numa linha própria.
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before === "" || before.endsWith("\n") ? "" : "\n";
  const trail = after.startsWith("\n") ? "" : "\n";
  const insert = `${lead}---${trail}`;
  const pos = start + insert.length;
  return { text: before + insert + after, selStart: pos, selEnd: pos };
}
