// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): o que o preset Metas 4T26 deixou FIXO vira dado do nó.
//   * INDICADOR: o nível N0–N3 (enum do preset) vira ETIQUETA livre (`tag`;
//     o `level` legado é lido como etiqueta); as linhas do cartão
//     (meta/realizado/projetado/atingimento/composição) são configuráveis —
//     rótulo, ordem, ocultar; o projetado pode combinar metas OU realizados
//     dos filhos; o realizado tem FONTE própria (RealizedSource — fórmula do
//     catálogo, métrica calculada própria, recortes e quebra); `indicator`
//     fica opcional quando há métrica própria.
//   * PLANO → MULTI-FATORES: lista livre de fatores (título opcional +
//     descrição). O 5W2H gravado vira fatores com aqueles títulos NA LEITURA
//     (nada se perde e nada precisa migrar); o molde segue disponível só como
//     atalho do editor (`PLAN_FIELDS`).
//   * `indicatorRequestsOf` pede POR NÓ (id do nó) — o servidor lê o payload
//     no banco; a fórmula própria nunca vem do navegador.
// PAYLOAD dos nós OPERACIONAIS da Tree (0149) — módulo PURO e client-safe.
//
// A Tree passou a desdobrar METAS, não só acompanhar registros. Três nós novos,
// todos linhas PRÓPRIAS de `tree_nodes` no mapa livre (endereçadas como
// `note:<uuid>`, igual à anotação — é o que deixa arrastar, re-pendurar,
// geometria e excluir funcionarem sem roteamento novo):
//
//  - INDICADOR: uma chave do catálogo de Indicadores. O nó mostra meta ×
//    realizado × atingimento por mês (lib/indicators/values.ts) e, quando tem
//    filhos indicadores e um operador ("vendas × ticket"), o PROJETADO que os
//    filhos dão contra a meta oficial do nó. Nível (N0–N3) é rótulo do
//    desdobramento, não derivado da profundidade — um galho pode ser exibido
//    sozinho noutro slide (rootRef).
//  - PLANO de ação: o 5W2H do pedido (o quê, por quê, resultado esperado, como
//    medir, prazo, como acontecer) + responsável + os indicadores que ele move.
//    As etapas são anotações-etapa filhas (convertíveis em tarefa).
//  - RITUAL: rotina de acompanhamento sem registro (lib/rituals/cadence.ts),
//    com "Agendar próxima" e o modo automático opt-in.
//
// Parse FAIL-CLOSED: jsonb adulterado degrada o nó para "sem payload" (o card
// diz o que falta), nunca derruba a árvore.
import {
  CHILDREN_OPS,
  isIndicatorKey,
  type ChildrenOp,
} from "@/lib/indicators/model";
import { parseRitualSchedule, type RitualSchedule } from "@/lib/rituals/cadence";
import {
  isDefaultRealized,
  parseRealizedSource,
  type RealizedSource,
} from "@/lib/indicators/realized-source";

/** v1.1: linhas do cartão de indicador (ordem = a da lista). */
export type IndicatorRowKind = "meta" | "realizado" | "projetado" | "atingimento" | "composicao";

export const INDICATOR_ROW_LABELS: Record<IndicatorRowKind, string> = {
  meta: "Meta",
  realizado: "Realizado",
  projetado: "Projetado",
  atingimento: "Atingimento",
  composicao: "Composição dos filhos",
};

/** Rótulo curto padrão de cada linha no cartão. */
export const INDICATOR_ROW_DEFAULT_TEXT: Record<IndicatorRowKind, string> = {
  meta: "Meta",
  realizado: "Realizado",
  projetado: "Proj.",
  atingimento: "Ating.",
  composicao: "Filhos",
};

export interface IndicatorRow {
  kind: IndicatorRowKind;
  /** Texto do rótulo no cartão (ausente = o padrão). */
  label?: string;
  hidden?: boolean;
}

/** As linhas de sempre (o que o cartão mostrava antes da v1.1). */
export const DEFAULT_INDICATOR_ROWS: readonly IndicatorRow[] = [
  { kind: "composicao" },
  { kind: "meta" },
  { kind: "realizado" },
  { kind: "projetado" },
  { kind: "atingimento", hidden: true },
];

/** Linhas efetivas: as configuradas + as que faltarem (ocultas), sem repetir. */
export function indicatorRows(p: Pick<IndicatorNodePayload, "rows">): IndicatorRow[] {
  const base = p.rows && p.rows.length > 0 ? p.rows : DEFAULT_INDICATOR_ROWS;
  const seen = new Set<IndicatorRowKind>();
  const out: IndicatorRow[] = [];
  for (const r of base) {
    if (seen.has(r.kind)) continue;
    seen.add(r.kind);
    out.push({ ...r });
  }
  for (const r of DEFAULT_INDICATOR_ROWS) {
    if (!seen.has(r.kind)) out.push({ kind: r.kind, hidden: true });
  }
  return out;
}

export interface IndicatorNodePayload {
  /** Chave do indicador/meta. Ausente só com métrica própria (sem meta). */
  indicator?: string;
  /** v1.1: etiqueta livre (ex.: "N1", "Estratégico"). Legado: `level`. */
  tag?: string;
  /** Meta/realizado de UM responsável (nome) em vez do global. */
  responsible?: string;
  /** Como os FILHOS indicadores compõem este nó. */
  childrenOp?: ChildrenOp;
  /** v1.1: o projetado combina as METAS (padrão) ou os REALIZADOS dos filhos. */
  projectFrom?: "meta" | "realizado";
  /** Frase curta sob o rótulo ("SQL realizados × conversão"). */
  hint?: string;
  /** v1.1: linhas do cartão (ausente = o padrão). */
  rows?: IndicatorRow[];
  /** v1.1: fonte do realizado (ausente = a fórmula do indicador). */
  realized?: RealizedSource;
  /** v1.1: unidade (R$, %) em cada célula (padrão) ou omitida. */
  unitInCell?: boolean;
}

/**
 * O molde 5W2H — v1.1: só o ATALHO "Adicionar molde 5W2H" do editor e a
 * leitura do legado. Um Multi-fatores não é obrigado a segui-lo.
 */
export const PLAN_FIELDS = [
  ["oQue", "O quê"],
  ["porQue", "Por quê"],
  ["resultado", "Resultado esperado"],
  ["comoMedir", "Como medir"],
  ["prazo", "Prazo"],
  ["comoAcontecer", "Como acontecer"],
] as const;
export type PlanFieldKey = (typeof PLAN_FIELDS)[number][0];

export const MAX_PLAN_FACTORS = 20;

/** v1.1: um fator do Multi-fatores — título opcional + descrição. */
export interface PlanFactor {
  id: string;
  title?: string;
  text: string;
}

export interface PlanNodePayload {
  /** v1.1: os fatores, em ordem. */
  factors: PlanFactor[];
  /** Responsável (nome). */
  responsible?: string;
  /** Indicadores que o nó move (status vivo no card). */
  indicators?: string[];
  /** v1.1: mostrar "Etapas: x/y" (branches filhas checáveis). Padrão: sim. */
  hideSteps?: boolean;
}

export interface RitualNodePayload {
  schedule: RitualSchedule;
  /** Responsável das tarefas geradas (nome). */
  responsible?: string;
  /** "Leitura e decisão" — vira a descrição da tarefa. */
  reading?: string;
  /** Gerar sozinho pelo tick (padrão false = "Agendar próxima"). */
  auto?: boolean;
  /** Modo automático: quantas ocorrências futuras manter abertas (1–5). */
  lookahead?: number;
}

export type OperationalKind = "indicator" | "plan" | "ritual";

export const OPERATIONAL_KINDS: readonly OperationalKind[] = [
  "indicator",
  "plan",
  "ritual",
];

const TEXT_MAX = 2000;

function text(v: unknown, max = TEXT_MAX): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const ROW_KINDS = Object.keys(INDICATOR_ROW_LABELS) as IndicatorRowKind[];

export function parseIndicatorPayload(raw: unknown): IndicatorNodePayload | null {
  if (!isRecord(raw)) return null;
  // v1.1: fonte do realizado (fail-closed: inválida ⇒ volta ao padrão).
  const realized = raw.realized !== undefined ? parseRealizedSource(raw.realized) : null;
  const hasIndicator = isIndicatorKey(raw.indicator);
  // Sem indicador só vale com métrica própria (senão o nó não tem número).
  if (!hasIndicator && !realized?.override) return null;
  const out: IndicatorNodePayload = {};
  if (hasIndicator) out.indicator = raw.indicator as string;
  // v1.1: etiqueta livre; o `level` legado (N0–N3) vira etiqueta.
  const tag = text(raw.tag, 24) ?? text(raw.level, 24);
  if (tag) out.tag = tag;
  const responsible = text(raw.responsible, 120);
  if (responsible) out.responsible = responsible;
  if (typeof raw.childrenOp === "string" && (CHILDREN_OPS as readonly string[]).includes(raw.childrenOp))
    out.childrenOp = raw.childrenOp as ChildrenOp;
  if (raw.projectFrom === "realizado") out.projectFrom = "realizado";
  const hint = text(raw.hint, 200);
  if (hint) out.hint = hint;
  if (Array.isArray(raw.rows)) {
    const rows: IndicatorRow[] = [];
    for (const r of raw.rows.slice(0, ROW_KINDS.length)) {
      if (!isRecord(r) || !(ROW_KINDS as string[]).includes(r.kind as string)) continue;
      const row: IndicatorRow = { kind: r.kind as IndicatorRowKind };
      const label = text(r.label, 24);
      if (label) row.label = label;
      if (r.hidden === true) row.hidden = true;
      rows.push(row);
    }
    if (rows.length > 0) out.rows = rows;
  }
  if (realized && !isDefaultRealized(realized)) out.realized = realized;
  if (raw.unitInCell === false) out.unitInCell = false;
  return out;
}

export function parsePlanPayload(raw: unknown): PlanNodePayload | null {
  if (!isRecord(raw)) return null;
  const factors: PlanFactor[] = [];
  if (Array.isArray(raw.factors)) {
    for (const [i, f] of raw.factors.entries()) {
      if (!isRecord(f)) continue;
      const body = text(f.text) ?? "";
      const title = text(f.title, 120);
      if (!body && !title) continue;
      const id = typeof f.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(f.id) ? f.id : `f${i + 1}`;
      factors.push({ id, ...(title ? { title } : {}), text: body });
      if (factors.length >= MAX_PLAN_FACTORS) break;
    }
  } else {
    // v1.1: LEGADO 5W2H — cada campo preenchido vira um fator com o título
    // dele, na mesma ordem. Leitura apenas: gravar de novo já sai em fatores.
    for (const [key, title] of PLAN_FIELDS) {
      const v = text(raw[key]);
      if (v) factors.push({ id: key, title, text: v });
    }
  }
  const out: PlanNodePayload = { factors };
  if (raw.hideSteps === true) out.hideSteps = true;
  const responsible = text(raw.responsible, 120);
  if (responsible) out.responsible = responsible;
  if (Array.isArray(raw.indicators)) {
    const keys = raw.indicators.filter(isIndicatorKey).slice(0, 12);
    if (keys.length > 0) out.indicators = [...new Set(keys)];
  }
  return out;
}

export function parseRitualPayload(raw: unknown): RitualNodePayload | null {
  if (!isRecord(raw)) return null;
  const schedule = parseRitualSchedule(raw.schedule);
  if (!schedule) return null;
  const out: RitualNodePayload = { schedule };
  const responsible = text(raw.responsible, 120);
  if (responsible) out.responsible = responsible;
  const reading = text(raw.reading);
  if (reading) out.reading = reading;
  if (raw.auto === true) out.auto = true;
  const la = Number(raw.lookahead);
  if (Number.isInteger(la) && la >= 1 && la <= 5) out.lookahead = la;
  return out;
}

/** Parse pelo tipo do nó. Tipo sem payload (anotação etc.) ⇒ null. */
export function parseNodePayload(
  kind: string,
  raw: unknown
): IndicatorNodePayload | PlanNodePayload | RitualNodePayload | null {
  switch (kind) {
    case "indicator":
      return parseIndicatorPayload(raw);
    case "plan":
      return parsePlanPayload(raw);
    case "ritual":
      return parseRitualPayload(raw);
    default:
      return null;
  }
}

/**
 * O que o widget pede ao servidor. v1.1: nó de indicador pede POR NÓ (`nodeId`
 * — o servidor lê o payload dele no banco: recorte e métrica própria NUNCA
 * vêm do navegador); os indicadores citados por um Multi-fatores pedem pela
 * chave (global).
 */
export interface IndicatorValueRequest {
  key: string;
  responsible: string | null;
  /** id lógico do nó (`note:<uuid>`) — presente nos nós de indicador. */
  nodeId?: string;
}

export function indicatorRequestsOf(
  nodes: { id?: string; kind: string; payload?: unknown; children: unknown[] }[]
): IndicatorValueRequest[] {
  const out = new Map<string, IndicatorValueRequest>();
  const walk = (list: { id?: string; kind: string; payload?: unknown; children: unknown[] }[]) => {
    for (const n of list) {
      if (n.kind === "indicator") {
        const p = parseIndicatorPayload(n.payload);
        if (p && n.id) {
          out.set(`node:${n.id}`, {
            key: p.indicator ?? "",
            responsible: p.responsible ?? null,
            nodeId: n.id,
          });
        }
      } else if (n.kind === "plan") {
        for (const k of parsePlanPayload(n.payload)?.indicators ?? []) {
          out.set(`${k}|`, { key: k, responsible: null });
        }
      }
      walk(n.children as typeof list);
    }
  };
  walk(nodes);
  return [...out.values()];
}

/** v1.1: chave da série de um NÓ de indicador. */
export function nodeSeriesKey(nodeId: string): string {
  return `node:${nodeId}`;
}

/** Chave de série usada para casar a resposta do servidor com o nó. */
export function seriesKey(key: string, responsible: string | null | undefined): string {
  return `${key}|${responsible ?? ""}`;
}
