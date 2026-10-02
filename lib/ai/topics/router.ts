// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): o ROTEADOR da orquestração por tópicos — a 1ª fase do
// turno. Uma chamada curta: o modelo lê o PEDIDO e o ÍNDICE (título + resumo de
// cada tópico, e a lista de itens do estado quando houver) e devolve quais
// tópicos/itens precisa. A 2ª fase (a geração de verdade) recebe só isso.
//
// Postura FAIL-OPEN, sempre: erro, timeout, JSON inválido ou modelo confuso ⇒
// prompt INTEIRO. O roteador só pode tirar peso do turno, nunca capacidade.
// E a escolha dele nunca SUBTRAI: palavras-chave do pedido e itens citados
// SOMAM tópicos (o modelo leve às vezes esquece o óbvio).
//
// Módulo sem I/O próprio: o cliente de IA é injetado (teste usa um fake).
import type { AiMessage, AiTextClient } from "@/lib/ai/types";
import {
  keywordTopics,
  normalizeForMatch,
  selectableTopics,
  topicIndexText,
  type PromptChunk,
  type TopicCatalog,
  type TopicSelection,
} from "./split";

/** Teto da chamada do roteador — o resto do orçamento é da geração. */
export const ROUTER_TIMEOUT_MS = 25_000;

export interface RouterItem {
  /** Identidade (key do widget, `mapa:<mapKey>`…). */
  id: string;
  /** Linha legível: título, tipo, aba. */
  label: string;
  /** Tópicos que este item puxa quando escolhido (ex.: tipo do widget). */
  topics?: readonly string[];
}

export interface RouteResult extends TopicSelection {
  /** false = fail-open (tudo). */
  routed: boolean;
  /** Por que caiu no fail-open (diagnóstico). */
  reason?: string;
}

function stripFence(raw: string): string {
  const t = raw.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1] : t;
}

/**
 * Lê a resposta do roteador. Chave desconhecida é ignorada; formato inválido ⇒
 * null (o chamador cai no tudo).
 */
export function parseRouterAnswer(
  raw: string,
  known: { topics: ReadonlySet<string>; items: ReadonlySet<string> }
): { topics: Set<string>; items: Set<string> | "all" } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const rawTopics = obj.topicos ?? obj.topics;
  if (rawTopics !== "todos" && !Array.isArray(rawTopics)) return null;
  const topics = new Set<string>();
  if (rawTopics === "todos") known.topics.forEach((t) => topics.add(t));
  else {
    for (const t of rawTopics) {
      if (typeof t === "string" && known.topics.has(t.trim())) topics.add(t.trim());
    }
  }
  const rawItems = obj.itens ?? obj.items;
  let items: Set<string> | "all" = "all";
  if (Array.isArray(rawItems) && known.items.size > 0) {
    items = new Set(
      rawItems
        .filter((i): i is string => typeof i === "string")
        .map((i) => i.trim())
        .filter((i) => known.items.has(i))
    );
  }
  return { topics, items };
}

function routerSystem(
  domain: string,
  topics: string,
  items: RouterItem[]
): string {
  const parts = [
    `Você é o ROTEADOR de contexto do assistente "${domain}".`,
    "Não resolva o pedido. Sua única tarefa: escolher QUAIS tópicos da",
    "especificação o assistente precisa ler para atender o pedido do usuário.",
    "O contrato básico, o envelope e as regras gerais já vão sempre — escolha só",
    "entre os tópicos abaixo. Na dúvida entre incluir ou não, INCLUA (faltar",
    "custa mais caro que sobrar).",
    "",
    "TÓPICOS DISPONÍVEIS (chave — título: o que contém):",
    topics,
  ];
  if (items.length > 0) {
    parts.push(
      "",
      "ITENS DO ESTADO ATUAL (o assistente recebe o conteúdo completo só dos itens",
      "escolhidos; os demais aparecem apenas listados). Escolha os que o pedido",
      'cita, afeta ou usa como modelo; se o pedido vale para "todos"/"cada" ou não',
      'dá para saber, responda "todos":',
      ...items.map((i) => `- ${i.id} — ${i.label}`)
    );
  }
  parts.push(
    "",
    "Responda SÓ com um JSON:",
    items.length > 0
      ? '{ "topicos": ["<chave>", ...], "itens": ["<id>", ...] | "todos" }'
      : '{ "topicos": ["<chave>", ...] }',
    'Use "topicos": [] se nenhum tópico extra for necessário.'
  );
  return parts.join("\n");
}

/**
 * Escolhe os tópicos (e itens) do turno. Nunca lança: qualquer falha devolve o
 * prompt inteiro (`routed: false`).
 */
export async function routeTopics(opts: {
  client: AiTextClient;
  catalog: TopicCatalog;
  chunks: PromptChunk[];
  description: string;
  priorTurns?: string[];
  items?: RouterItem[];
  signal?: AbortSignal;
}): Promise<RouteResult> {
  const all: RouteResult = { topics: "all", items: "all", routed: false };
  const selectable = selectableTopics(opts.chunks, opts.catalog);
  const items = opts.items ?? [];
  if (selectable.length === 0 && items.length === 0) {
    return { ...all, reason: "nada a escolher" };
  }
  const known = {
    topics: new Set(selectable.map((t) => t.key)),
    items: new Set(items.map((i) => i.id)),
  };
  const messages: AiMessage[] = [
    ...(opts.priorTurns ?? []).map((t): AiMessage => ({ role: "user", content: t })),
    { role: "user", content: opts.description },
  ];
  let raw: string;
  try {
    const timeout = AbortSignal.timeout(ROUTER_TIMEOUT_MS);
    raw = await opts.client.generateText({
      system: routerSystem(opts.catalog.domain, topicIndexText(selectable), items),
      messages,
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
  } catch (err) {
    return { ...all, reason: err instanceof Error ? err.message : String(err) };
  }
  const answer = parseRouterAnswer(raw, known);
  if (!answer) return { ...all, reason: "resposta do roteador inválida" };

  // Nunca subtrai: palavras do pedido e tópicos dos itens escolhidos SOMAM.
  const said = [opts.description, ...(opts.priorTurns ?? [])].join("\n");
  const topics = new Set(answer.topics);
  for (const k of keywordTopics(opts.catalog, said)) {
    if (known.topics.has(k)) topics.add(k);
  }
  // Item citado pelo NOME no pedido entra mesmo que o roteador o esqueça.
  let chosenItems = answer.items;
  if (chosenItems !== "all") {
    const norm = normalizeForMatch(said);
    for (const it of items) {
      const title = normalizeForMatch(it.label.split(" — ")[0] ?? "");
      if (title.length >= 4 && norm.includes(title)) chosenItems.add(it.id);
    }
    if (chosenItems.size === 0 && items.length > 0) chosenItems = "all";
  }
  const pulled = chosenItems === "all" ? items : items.filter((i) => (chosenItems as Set<string>).has(i.id));
  for (const it of pulled) {
    for (const t of it.topics ?? []) if (known.topics.has(t)) topics.add(t);
  }
  return { topics, items: chosenItems, routed: true };
}

/** Frase do aviso ("Contexto: …") exibido no chat durante o turno. */
export function routeNotice(
  route: RouteResult,
  catalog: TopicCatalog,
  chunks: PromptChunk[],
  itemCount = 0
): string | null {
  if (!route.routed || route.topics === "all") return null;
  const selectable = selectableTopics(chunks, catalog);
  const chosen = selectable.filter((t) => (route.topics as ReadonlySet<string>).has(t.key));
  const names = chosen.map((t) => t.title);
  const topicPart =
    chosen.length === 0
      ? "só o essencial"
      : `${names.join(", ")} (${chosen.length} de ${selectable.length} tópicos)`;
  const itemPart =
    itemCount > 0 && route.items !== "all"
      ? ` · ${route.items.size} de ${itemCount} itens do estado`
      : "";
  return `Contexto carregado: ${topicPart}${itemPart}.`;
}
