// Versão: 1.0 | Data: 01/10/2026
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

export const INDICATOR_LEVELS = ["N0", "N1", "N2", "N3"] as const;
export type IndicatorLevel = (typeof INDICATOR_LEVELS)[number];

export interface IndicatorNodePayload {
  indicator: string;
  level?: IndicatorLevel;
  /** Meta/realizado de UM responsável (nome) em vez do global. */
  responsible?: string;
  /** Como os FILHOS indicadores compõem este nó. */
  childrenOp?: ChildrenOp;
  /** Frase curta sob o rótulo ("SQL realizados × conversão"). */
  hint?: string;
}

export const PLAN_FIELDS = [
  ["oQue", "O quê"],
  ["porQue", "Por quê"],
  ["resultado", "Resultado esperado"],
  ["comoMedir", "Como medir"],
  ["prazo", "Prazo"],
  ["comoAcontecer", "Como acontecer"],
] as const;
export type PlanFieldKey = (typeof PLAN_FIELDS)[number][0];

export interface PlanNodePayload {
  oQue?: string;
  porQue?: string;
  resultado?: string;
  comoMedir?: string;
  prazo?: string;
  comoAcontecer?: string;
  /** Responsável pelo plano (nome). */
  responsible?: string;
  /** Indicadores que o plano move (status vivo no card). */
  indicators?: string[];
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

export function parseIndicatorPayload(raw: unknown): IndicatorNodePayload | null {
  if (!isRecord(raw) || !isIndicatorKey(raw.indicator)) return null;
  const out: IndicatorNodePayload = { indicator: raw.indicator };
  if (typeof raw.level === "string" && (INDICATOR_LEVELS as readonly string[]).includes(raw.level))
    out.level = raw.level as IndicatorLevel;
  const responsible = text(raw.responsible, 120);
  if (responsible) out.responsible = responsible;
  if (typeof raw.childrenOp === "string" && (CHILDREN_OPS as readonly string[]).includes(raw.childrenOp))
    out.childrenOp = raw.childrenOp as ChildrenOp;
  const hint = text(raw.hint, 200);
  if (hint) out.hint = hint;
  return out;
}

export function parsePlanPayload(raw: unknown): PlanNodePayload | null {
  if (!isRecord(raw)) return null;
  const out: PlanNodePayload = {};
  for (const [key] of PLAN_FIELDS) {
    const v = text(raw[key]);
    if (v) out[key] = v;
  }
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

/** Indicadores citados por uma lista de nós (o que o widget pede ao servidor). */
export function indicatorRequestsOf(
  nodes: { kind: string; payload?: unknown; children: unknown[] }[]
): { key: string; responsible: string | null }[] {
  const out = new Map<string, { key: string; responsible: string | null }>();
  const walk = (list: { kind: string; payload?: unknown; children: unknown[] }[]) => {
    for (const n of list) {
      if (n.kind === "indicator") {
        const p = parseIndicatorPayload(n.payload);
        if (p) {
          const r = p.responsible ?? null;
          out.set(`${p.indicator}|${r ?? ""}`, { key: p.indicator, responsible: r });
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

/** Chave de série usada para casar a resposta do servidor com o nó. */
export function seriesKey(key: string, responsible: string | null | undefined): string {
  return `${key}|${responsible ?? ""}`;
}
