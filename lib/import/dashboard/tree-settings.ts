// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): `settings.tree` deixa de ser PASSTHROUGH no import.
//
// Até aqui o validador copiava `settings.tree` como viesse — e foi assim que o
// pedido "desmarque Realizado nas linhas do cartão" virou uma chave inventada
// (`settings.tree.rows`) gravada em silêncio, sem efeito nenhum na tela: as
// linhas do cartão são do NÓ (`mapas[].nodes[].payload.rows`, ver
// tree-maps.ts), não do widget. Agora cada chave é conferida contra os enums
// reais de lib/tree/model.ts e lib/tree/display.ts; chave desconhecida vira
// AVISO + descarte (a mesma postura do kanban — nunca erro duro).
//
// PURO (sem I/O).
import {
  TREE_DIRECTION_LABELS,
  TREE_FILTERABLE_KINDS,
  TREE_LAYOUT_LABELS,
  TREE_VIEW_LABELS,
} from "@/lib/tree/model";
import { TREE_PRESENTATION_LABELS } from "@/lib/tree/display";
import { normalizeHexColor } from "@/lib/theme";
import type { TreeSettings } from "@/lib/widgets/types";

export const TREE_CANVAS_PATTERNS = ["pontos", "linhas", "nenhum"] as const;

/** As chaves que o import aceita (exaustivo por construção). */
const TREE_SETTINGS_KEYS = {
  source: true,
  layout: true,
  recordId: true,
  mapKey: true,
  showKinds: true,
  view: true,
  rootDirection: true,
  rootRef: true,
  months: true,
  canvas: true,
  presentation: true,
} satisfies Record<keyof TreeSettings, true>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function sanitizeTreeSettings(
  raw: unknown,
  deps: { where: string; warnings: string[] }
): TreeSettings | null {
  const { where, warnings } = deps;
  if (!isRecord(raw)) {
    warnings.push(`${where}: "settings.tree" precisa ser um objeto — descartado.`);
    return null;
  }
  const drop = (key: string, why: string) =>
    warnings.push(`${where}: "settings.tree.${key}" ${why} — descartado.`);
  for (const k of Object.keys(raw)) {
    if (!(k in TREE_SETTINGS_KEYS)) {
      drop(
        k,
        'não existe (as linhas do cartão — Meta/Realizado/Projetado… — e a fonte do realizado são de CADA NÓ: edite em "mapas[].nodes[].payload")'
      );
    }
  }
  const source = raw.source === "registro" ? "registro" : raw.source === "livre" ? "livre" : null;
  if (!source) {
    if (raw.source !== undefined) drop("source", 'deve ser "registro" | "livre"');
  }
  const out: TreeSettings = {
    source: source ?? "livre",
    layout:
      typeof raw.layout === "string" && raw.layout in TREE_LAYOUT_LABELS
        ? (raw.layout as TreeSettings["layout"])
        : source === "registro"
          ? "por_ocorrencia"
          : "livre",
  };
  if (raw.layout !== undefined && out.layout !== raw.layout) {
    drop("layout", `deve ser ${Object.keys(TREE_LAYOUT_LABELS).join(" | ")}`);
  }
  if (raw.recordId !== undefined) {
    if (typeof raw.recordId === "string" && UUID_RE.test(raw.recordId)) out.recordId = raw.recordId;
    else drop("recordId", "precisa ser o id de um registro");
  }
  if (raw.mapKey !== undefined) {
    if (typeof raw.mapKey === "string" && raw.mapKey.trim()) out.mapKey = raw.mapKey.trim().slice(0, 80);
    else drop("mapKey", "precisa ser texto");
  }
  if (raw.showKinds !== undefined) {
    const list = Array.isArray(raw.showKinds)
      ? raw.showKinds.filter((k): k is (typeof TREE_FILTERABLE_KINDS)[number] =>
          (TREE_FILTERABLE_KINDS as readonly string[]).includes(k as string)
        )
      : [];
    if (list.length > 0) out.showKinds = [...new Set(list)];
    else drop("showKinds", `aceita ${TREE_FILTERABLE_KINDS.join(", ")}`);
  }
  if (raw.view !== undefined) {
    if (typeof raw.view === "string" && raw.view in TREE_VIEW_LABELS) out.view = raw.view as TreeSettings["view"];
    else drop("view", `deve ser ${Object.keys(TREE_VIEW_LABELS).join(" | ")}`);
  }
  if (raw.rootDirection !== undefined) {
    if (typeof raw.rootDirection === "string" && raw.rootDirection in TREE_DIRECTION_LABELS)
      out.rootDirection = raw.rootDirection as TreeSettings["rootDirection"];
    else drop("rootDirection", `deve ser ${Object.keys(TREE_DIRECTION_LABELS).join(" | ")}`);
  }
  if (raw.rootRef !== undefined) {
    if (typeof raw.rootRef === "string" && raw.rootRef.trim()) out.rootRef = raw.rootRef.trim().slice(0, 200);
    else drop("rootRef", "precisa ser texto");
  }
  if (raw.months !== undefined) {
    const months = Array.isArray(raw.months)
      ? raw.months.filter((m): m is string => typeof m === "string" && MONTH_RE.test(m))
      : [];
    if (months.length > 0) out.months = [...new Set(months)].sort().slice(0, 24);
    else drop("months", "precisa ser uma lista de AAAA-MM");
  }
  if (raw.canvas !== undefined) {
    if (isRecord(raw.canvas)) {
      const canvas: NonNullable<TreeSettings["canvas"]> = {};
      const bg = normalizeHexColor(raw.canvas.bg);
      if (bg) canvas.bg = bg;
      else if (raw.canvas.bg !== undefined) drop("canvas.bg", "precisa ser #RRGGBB");
      if ((TREE_CANVAS_PATTERNS as readonly unknown[]).includes(raw.canvas.pattern))
        canvas.pattern = raw.canvas.pattern as NonNullable<TreeSettings["canvas"]>["pattern"];
      else if (raw.canvas.pattern !== undefined)
        drop("canvas.pattern", `deve ser ${TREE_CANVAS_PATTERNS.join(" | ")}`);
      if (Object.keys(canvas).length > 0) out.canvas = canvas;
    } else drop("canvas", "precisa ser um objeto");
  }
  if (raw.presentation !== undefined) {
    if (isRecord(raw.presentation)) {
      const pres: NonNullable<TreeSettings["presentation"]> = {};
      for (const [k, v] of Object.entries(raw.presentation)) {
        if (!(k in TREE_PRESENTATION_LABELS)) {
          drop(`presentation.${k}`, `não existe (aceita ${Object.keys(TREE_PRESENTATION_LABELS).join(", ")})`);
          continue;
        }
        if (typeof v === "boolean") pres[k as keyof typeof pres] = v;
      }
      if (Object.keys(pres).length > 0) out.presentation = pres;
    } else drop("presentation", "precisa ser um objeto");
  }
  return out;
}
