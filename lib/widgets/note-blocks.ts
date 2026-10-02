// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): MARKDOWN LEVE do bloco de texto (widget Nota). Camada de
//   BLOCOS sobre parseNoteTemplate: a nota deixa de ser um único parágrafo e
//   ganha hierarquia — que é o que faltava para texto de apresentação (capa,
//   fontes e critérios, notas laterais).
//
// Sintaxe, por LINHA:
//   ^^ TEXTO        kicker (rótulo pequeno em caixa-alta, acima do título)
//   # / ## / ###    títulos (exibição / título / subtítulo)
//   - item / * item lista; "1. item" lista numerada
//   > texto         citação / comentário
//   ---             filete divisório
//   (( texto ))     comentário do AUTOR — só aparece no modo edição; é o que
//                   impede um "(cole aqui os links…)" de vazar no slide
//   linha vazia     separa parágrafos
// Inline: **negrito**, *itálico*, [rótulo](https://…) (link externo — só
//   http/https/mailto; nunca HTML cru). {=fórmula} e [rótulo](@widget) seguem
//   do parseNoteTemplate, com o MESMO índice global de expressão (o servidor
//   avalia as exprs na ordem do texto inteiro — quebrar em linhas não pode
//   renumerá-las).
//
// Compatibilidade: texto sem marcação (hasNoteMarkup = false) é renderizado
// pelo caminho antigo, byte-idêntico. Ênfase só vale com par fechado na mesma
// linha e colado ao texto ("R$ 10 * 2 * 3" continua literal).
//
// Puro (sem IO), testado em note-blocks.test.ts.
import type { NotePart } from "./note-template";

export type NoteRun =
  | ({ kind: "text"; text: string } & NoteEmphasis)
  | ({ kind: "expr"; index: number; source: string } & NoteEmphasis)
  | ({ kind: "link"; label: string; target: Extract<NotePart, { kind: "link" }>["target"] } & NoteEmphasis)
  | ({ kind: "url"; label: string; href: string } & NoteEmphasis);

export interface NoteEmphasis {
  bold?: boolean;
  italic?: boolean;
}

export type NoteBlockType =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "kicker"
  | "li"
  | "oli"
  | "quote"
  | "rule"
  | "blank"
  | "comment";

export interface NoteBlock {
  type: NoteBlockType;
  runs: NoteRun[];
  /** Número do item em lista numerada. */
  n?: number;
}

const URL_RE =
  /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/;
const SAFE_HREF = /^(?:https?:\/\/|mailto:)/i;

const BLOCK_RES: Array<[NoteBlockType, RegExp]> = [
  ["kicker", /^\^\^\s+/],
  ["h3", /^###\s+/],
  ["h2", /^##\s+/],
  ["h1", /^#\s+/],
  ["oli", /^\d{1,3}[.)]\s+/],
  ["li", /^[-*•]\s+/],
  ["quote", /^>\s?/],
];

/** Há alguma marcação? Sem ela, o render antigo (um parágrafo) é mantido. */
export function hasNoteMarkup(text: string): boolean {
  if (!text) return false;
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.trimStart();
    if (/^-{3,}\s*$/.test(line)) return true;
    if (/^\(\(.*\)\)\s*$/.test(line)) return true;
    if (BLOCK_RES.some(([, re]) => re.test(line))) return true;
  }
  if (URL_RE.test(text)) return true;
  if (/\*\*\S[^\n]*?\S?\*\*/.test(text)) return true;
  if (/(^|[^*])\*\S[^*\n]*?\*(?!\*)/.test(text)) return true;
  return false;
}

/** Quebra as partes do template em LINHAS (só texto contém "\n"). */
function splitLines(parts: NotePart[]): NotePart[][] {
  const lines: NotePart[][] = [[]];
  for (const part of parts) {
    if (part.kind !== "text") {
      lines[lines.length - 1].push(part);
      continue;
    }
    const pieces = part.text.split("\n");
    pieces.forEach((piece, i) => {
      if (i > 0) lines.push([]);
      if (piece) lines[lines.length - 1].push({ kind: "text", text: piece });
    });
  }
  return lines;
}

/** Monta os blocos a partir das partes de parseNoteTemplate(text). */
export function buildNoteBlocks(parts: NotePart[]): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let olCounter = 0;
  for (const lineParts of splitLines(parts)) {
    const first = lineParts[0];
    const onlyText = lineParts.every((p) => p.kind === "text");
    const lineText = onlyText
      ? lineParts.map((p) => (p as { text: string }).text).join("")
      : null;

    if (lineParts.length === 0 || (lineText !== null && lineText.trim() === "")) {
      blocks.push({ type: "blank", runs: [] });
      olCounter = 0;
      continue;
    }
    if (lineText !== null && /^\s*-{3,}\s*$/.test(lineText)) {
      blocks.push({ type: "rule", runs: [] });
      olCounter = 0;
      continue;
    }
    if (lineText !== null && /^\s*\(\(.*\)\)\s*$/.test(lineText)) {
      const inner = lineText.trim().slice(2, -2).trim();
      blocks.push({ type: "comment", runs: [{ kind: "text", text: inner }] });
      continue;
    }

    let type: NoteBlockType = "p";
    let rest = lineParts;
    if (first && first.kind === "text") {
      const lead = first.text.trimStart();
      for (const [t, re] of BLOCK_RES) {
        const m = re.exec(lead);
        if (m) {
          type = t;
          const stripped = lead.slice(m[0].length);
          rest = [
            ...(stripped ? [{ kind: "text", text: stripped } as NotePart] : []),
            ...lineParts.slice(1),
          ];
          break;
        }
      }
    }
    olCounter = type === "oli" ? olCounter + 1 : 0;
    blocks.push({
      type,
      runs: inlineRuns(rest),
      ...(type === "oli" ? { n: olCounter } : {}),
    });
  }
  // Linhas vazias nas pontas não viram espaço.
  while (blocks[0]?.type === "blank") blocks.shift();
  while (blocks[blocks.length - 1]?.type === "blank") blocks.pop();
  return blocks;
}

type Tok =
  | { t: "text"; text: string }
  | { t: "mark"; v: "**" | "*"; paired?: boolean }
  | { t: "url"; label: string; href: string }
  | { t: "part"; part: NotePart };

/** Ênfase e link externo dentro de uma linha. */
export function inlineRuns(parts: NotePart[]): NoteRun[] {
  const toks: Tok[] = [];
  for (const part of parts) {
    if (part.kind !== "text") {
      toks.push({ t: "part", part });
      continue;
    }
    let src = part.text;
    while (src.length > 0) {
      const url = URL_RE.exec(src);
      const mark = /\*\*|\*/.exec(src);
      const urlAt = url ? url.index : Infinity;
      const markAt = mark ? mark.index : Infinity;
      if (urlAt === Infinity && markAt === Infinity) {
        toks.push({ t: "text", text: src });
        break;
      }
      if (urlAt <= markAt && url) {
        if (url.index > 0) toks.push({ t: "text", text: src.slice(0, url.index) });
        const href = url[2];
        if (SAFE_HREF.test(href)) toks.push({ t: "url", label: url[1], href });
        else toks.push({ t: "text", text: url[0] });
        src = src.slice(url.index + url[0].length);
      } else if (mark) {
        if (mark.index > 0) toks.push({ t: "text", text: src.slice(0, mark.index) });
        toks.push({ t: "mark", v: mark[0] as "**" | "*" });
        src = src.slice(mark.index + mark[0].length);
      }
    }
  }

  // Pareia marcadores: abertura colada ao texto seguinte, fechamento colado ao
  // anterior (regra do markdown — evita "R$ 10 * 2 * 3" virar itálico).
  const charAfter = (i: number): string => {
    const n = toks[i + 1];
    if (!n) return "";
    if (n.t === "text") return n.text[0] ?? "";
    return "x";
  };
  const charBefore = (i: number): string => {
    const p = toks[i - 1];
    if (!p) return "";
    if (p.t === "text") return p.text[p.text.length - 1] ?? "";
    return "x";
  };
  for (const v of ["**", "*"] as const) {
    let open: number | null = null;
    toks.forEach((tok, i) => {
      if (tok.t !== "mark" || tok.v !== v) return;
      const after = charAfter(i);
      const before = charBefore(i);
      if (open === null) {
        if (after && !/\s/.test(after)) open = i;
      } else if (before && !/\s/.test(before)) {
        (toks[open] as { paired?: boolean }).paired = true;
        tok.paired = true;
        open = null;
      }
    });
  }

  const runs: NoteRun[] = [];
  let bold = false;
  let italic = false;
  const emph = (): NoteEmphasis => ({
    ...(bold ? { bold: true } : {}),
    ...(italic ? { italic: true } : {}),
  });
  const pushText = (text: string) => {
    const last = runs[runs.length - 1];
    if (
      last &&
      last.kind === "text" &&
      !!last.bold === bold &&
      !!last.italic === italic
    ) {
      last.text += text;
    } else {
      runs.push({ kind: "text", text, ...emph() });
    }
  };
  for (const tok of toks) {
    if (tok.t === "text") pushText(tok.text);
    else if (tok.t === "mark") {
      if (!tok.paired) pushText(tok.v);
      else if (tok.v === "**") bold = !bold;
      else italic = !italic;
    } else if (tok.t === "url") {
      runs.push({ kind: "url", label: tok.label, href: tok.href, ...emph() });
    } else {
      const p = tok.part;
      if (p.kind === "expr") runs.push({ ...p, ...emph() });
      else if (p.kind === "link") runs.push({ ...p, ...emph() });
      else pushText(p.text);
    }
  }
  return runs;
}
