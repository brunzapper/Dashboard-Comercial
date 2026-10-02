// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): ORQUESTRAÇÃO POR TÓPICOS dos assistentes de IA — a parte
// PURA (sem I/O, testável).
//
// O problema: o prompt de cada assistente (sobretudo o de dashboards: SPEC,
// dicionários de settings, modelo das Bases, amostras e o estado do board)
// cresceu a ponto de um modelo leve (Gemini Flash) se perder no meio dele. A
// IA EXTERNA, geralmente mais potente, segue recebendo TUDO; a interna passa a
// receber um ÍNDICE, escolher os tópicos e só então ganhar o conteúdo deles.
//
// A regra que segura a feature: há UM texto de prompt por assistente, e os
// tópicos são uma PARTIÇÃO dele — nunca uma segunda redação. O mesmo texto
// fatiado serve os dois caminhos:
//   - IA externa ("Copiar prompt") e escalonamento → `renderChunks(.., "all")`,
//     que devolve o texto inteiro (só sem os marcadores);
//   - IA interna → `renderChunks(.., seleção)`.
// Por isso conteúdo novo de prompt nunca fica "fora" da IA interna em silêncio:
// sem classificação ele cai no núcleo (sempre enviado), e o teste de paridade
// por domínio (lib/ai/topics/catalogs.test.ts) acusa cabeçalho de seção sem
// tópico declarado.
//
// Como o texto é fatiado:
//   - CABEÇALHO markdown (`#`…`####`) cujo texto casa (prefixo, sem acento,
//     minúsculo) com `headings` de um tópico abre um pedaço desse tópico;
//   - cabeçalho de nível 1–2 SEM tópico volta ao núcleo (fail-safe: nunca some);
//   - cabeçalho de nível 3–4 sem tópico HERDA o tópico do pai;
//   - MARCADOR `@@topic:<chave>@@` numa linha sozinha troca o tópico ali mesmo
//     (para recortar DENTRO de uma seção — ex.: grupos de settings, regras
//     numeradas). O marcador nunca chega a modelo nenhum.

export const CORE_TOPIC = "__core__";
/** Prefixo dos pedaços de ITEM (widgets/mapas do estado) — seleção à parte. */
export const ITEM_TOPIC_PREFIX = "item:";

export interface TopicMeta {
  key: string;
  title: string;
  /** 1–2 linhas: "o que você encontrará aqui" — é isto que o roteador lê. */
  summary: string;
  /** Sempre enviado (contrato, envelope, regras de edição…). */
  always?: boolean;
  /** Palavras (sem acento, minúsculas) que, no pedido, puxam o tópico. */
  keywords?: readonly string[];
  /** Prefixos de cabeçalho que abrem este tópico. */
  headings?: readonly string[];
}

export interface TopicCatalog {
  /** Nome do assistente (aparece no índice e nos testes). */
  domain: string;
  topics: readonly TopicMeta[];
}

export interface PromptChunk {
  topic: string;
  /** Cabeçalho que abriu o pedaço (quando houver). */
  heading?: string;
  text: string;
}

const MARKER_RE = /^@@topic:([a-z0-9_:.-]+)@@$/i;
const HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/;
const RULE_RE = /^=+$/;

export function topicMarker(key: string): string {
  return `@@topic:${key}@@`;
}

/** Remove os marcadores (o texto que a IA EXTERNA recebe). */
export function stripTopicMarkers(text: string): string {
  return text
    .split("\n")
    .filter((l) => !MARKER_RE.test(l.trim()))
    .join("\n");
}

/** Minúsculas sem acento — base de toda comparação de cabeçalho/palavra. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["“”«»`*]/g, "")
    .trim();
}

function topicForHeading(catalog: TopicCatalog, heading: string): string | null {
  const h = normalizeForMatch(heading);
  for (const t of catalog.topics) {
    for (const p of t.headings ?? []) {
      if (h.startsWith(normalizeForMatch(p))) return t.key;
    }
  }
  return null;
}

/** Fatia o texto em pedaços por tópico, preservando a ordem. */
export function splitPrompt(text: string, catalog: TopicCatalog): PromptChunk[] {
  const chunks: PromptChunk[] = [];
  let cur: PromptChunk = { topic: CORE_TOPIC, text: "" };
  let buf: string[] = [];
  const flush = (carry: string[] = []) => {
    if (buf.length > 0) chunks.push({ ...cur, text: buf.join("\n") });
    buf = carry;
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = MARKER_RE.exec(line.trim());
    if (marker) {
      flush();
      cur = { topic: marker[1] === "core" ? CORE_TOPIC : marker[1], text: "" };
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      const level = h[1].length;
      const mapped = topicForHeading(catalog, h[2]);
      if (mapped || level <= 2) {
        // A moldura "=====\n# TÍTULO\n=====" (aiSection) acompanha o título.
        const carry =
          buf.length > 0 && RULE_RE.test(buf[buf.length - 1]) ? [buf.pop() as string] : [];
        flush(carry);
        cur = { topic: mapped ?? CORE_TOPIC, heading: h[2], text: "" };
      }
    }
    buf.push(line);
  }
  flush();
  return chunks;
}

/** Os tópicos ESCOLHÍVEIS presentes nos pedaços (fora o núcleo e os `always`). */
export function selectableTopics(chunks: PromptChunk[], catalog: TopicCatalog): TopicMeta[] {
  const present = new Set(chunks.map((c) => c.topic));
  return catalog.topics.filter((t) => !t.always && present.has(t.key));
}

export interface TopicSelection {
  /** Tópicos escolhidos (os `always` e o núcleo entram de qualquer forma). */
  topics: ReadonlySet<string> | "all";
  /** Itens do estado (widgets/mapas) — "all" = estado inteiro. */
  items: ReadonlySet<string> | "all";
}

/**
 * Remonta o prompt. `"all"` devolve o texto inteiro (sem marcadores) — é o que
 * a IA externa e a tentativa de escalonamento recebem. Com seleção, os tópicos
 * de fora viram uma lista curta ao final, para a IA saber que existem.
 */
export function renderChunks(
  chunks: PromptChunk[],
  selection: TopicSelection["topics"],
  catalog?: TopicCatalog
): string {
  if (selection === "all") return chunks.map((c) => c.text).join("\n");
  const always = new Set((catalog?.topics ?? []).filter((t) => t.always).map((t) => t.key));
  const kept: string[] = [];
  const omitted = new Set<string>();
  for (const c of chunks) {
    if (c.topic === CORE_TOPIC || always.has(c.topic) || selection.has(c.topic)) {
      kept.push(c.text);
    } else {
      omitted.add(c.topic);
    }
  }
  if (catalog && omitted.size > 0) {
    const lines = catalog.topics
      .filter((t) => omitted.has(t.key))
      .map((t) => `- ${t.title}: ${t.summary}`);
    if (lines.length > 0) {
      kept.push(
        [
          "",
          "============================================================",
          "# TÓPICOS NÃO CARREGADOS NESTE TURNO",
          "============================================================",
          "",
          "O sistema também tem os tópicos abaixo; a especificação deles ficou de fora",
          "para este pedido. Se o pedido depender de um deles, responda mesmo assim com",
          "o que conseguir — o validador apontará o que faltar e você receberá a",
          "especificação COMPLETA na tentativa seguinte.",
          ...lines,
        ].join("\n")
      );
    }
  }
  return kept.join("\n");
}

/** Tópicos cujas palavras-chave aparecem no texto (pedido + turnos). */
export function keywordTopics(catalog: TopicCatalog, text: string): Set<string> {
  const norm = ` ${normalizeForMatch(text).replace(/[^a-z0-9]+/g, " ")} `;
  const out = new Set<string>();
  for (const t of catalog.topics) {
    for (const k of t.keywords ?? []) {
      const kw = normalizeForMatch(k).replace(/[^a-z0-9]+/g, " ").trim();
      if (kw && norm.includes(` ${kw}`)) {
        out.add(t.key);
        break;
      }
    }
  }
  return out;
}

/** Cabeçalhos de nível 1–2 SEM tópico declarado (guarda dos testes). */
export function unmappedTopHeadings(text: string, catalog: TopicCatalog): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const h = HEADING_RE.exec(line);
    if (!h || h[1].length > 2) continue;
    if (!topicForHeading(catalog, h[2])) out.push(h[2]);
  }
  return out;
}

/** Texto do índice que o roteador lê. */
export function topicIndexText(topics: readonly TopicMeta[]): string {
  return topics.map((t) => `- ${t.key} — ${t.title}: ${t.summary}`).join("\n");
}
