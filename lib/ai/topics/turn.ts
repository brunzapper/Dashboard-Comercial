// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): as DUAS fases de um turno com tópicos, num lugar só — o
// laço genérico (lib/ai/json-loop.ts) e o laço próprio de dashboards
// (lib/ai/generate-dashboard.ts) chamam isto, e nenhum dos dois reimplementa a
// regra:
//   1ª fase — roteia (`routeTopics`, fail-open);
//   2ª fase — `first` é o prompt recortado; `full` é o prompt INTEIRO, usado
//             pela tentativa de ESCALONAMENTO quando a resposta recortada não
//             passa no validador (o modelo pode ter precisado do que ficou de
//             fora — a correção nunca é feita no escuro).
// O cliente é injetado: sem I/O próprio.
import type { AiTextClient } from "@/lib/ai/types";
import {
  renderChunks,
  splitPrompt,
  stripTopicMarkers,
  type PromptChunk,
  type TopicCatalog,
} from "./split";
import { routeNotice, routeTopics, type RouteResult, type RouterItem } from "./router";

export interface TopicTurnPlan {
  /** Prompt da 1ª tentativa (recortado quando o roteador decidiu). */
  first: string;
  /** Prompt inteiro (tentativas de escalonamento; igual ao da IA externa). */
  full: string;
  route: RouteResult;
  chunks: PromptChunk[];
}

export async function planTopicTurn(opts: {
  client: AiTextClient;
  system: string;
  catalog?: TopicCatalog;
  description: string;
  priorTurns?: string[];
  items?: RouterItem[];
  onNotice?: (text: string) => void;
}): Promise<TopicTurnPlan> {
  if (!opts.catalog) {
    const full = stripTopicMarkers(opts.system);
    return {
      first: full,
      full,
      route: { topics: "all", items: "all", routed: false, reason: "sem catálogo" },
      chunks: [],
    };
  }
  const chunks = splitPrompt(opts.system, opts.catalog);
  const full = renderChunks(chunks, "all");
  const route = await routeTopics({
    client: opts.client,
    catalog: opts.catalog,
    chunks,
    description: opts.description,
    priorTurns: opts.priorTurns,
    items: opts.items,
  });
  const first = route.routed ? renderChunks(chunks, route.topics, opts.catalog) : full;
  const notice = routeNotice(route, opts.catalog, chunks, opts.items?.length ?? 0);
  if (notice) opts.onNotice?.(notice);
  return { first, full, route, chunks };
}

/** Recorta um prompt JÁ roteado (ex.: dashboards remonta o estado e re-fatia). */
export function renderRouted(
  system: string,
  catalog: TopicCatalog,
  route: RouteResult
): string {
  const chunks = splitPrompt(system, catalog);
  return route.routed ? renderChunks(chunks, route.topics, catalog) : renderChunks(chunks, "all");
}
