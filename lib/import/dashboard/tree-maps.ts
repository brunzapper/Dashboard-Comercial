// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): MAPAS DA TREE no contrato `dashboard-import` — a IA passa
//   a enxergar e editar os NÓS do mapa livre (indicador, Multi-fatores, ritual,
//   anotação), não só o widget.
//
// Por que existe: o pedido "desmarque Realizado em todas as Linhas do cartão"
// voltou com "8 widgets atualizados" e nada mudou. As linhas do cartão moram em
// `tree_nodes.payload.rows` de CADA nó (lib/tree/payload.ts); a IA só lia e
// escrevia `widgets.settings`, e o validador aceitava em silêncio a chave que
// ela inventou dentro de `settings.tree`. Este módulo fecha o buraco:
//
//  - EXPORT: as linhas próprias de cada mapa usado por um widget Tree (modo
//    livre) saem no vocabulário do `PresetMapNode` (key/parentKey/kind/label/
//    payload). Ids NUNCA no JSON — o mapa key→uuid fica no servidor.
//  - MERGE (delta por nó): a IA manda a `key` + só o que muda, como nos
//    widgets. `payload.rows` mescla POR `kind` — "ocultar o Realizado" é
//    `[{"kind":"realizado","hidden":true}]`, sem re-emitir as cinco linhas.
//  - VALIDAÇÃO: o payload passa pelo MESMO `parseNodePayload` do editor do nó;
//    a escrita real é dos choke points de `tree-actions.ts` (updateTreeNode/
//    updateTreeNote/createTreeNode/createTreeNote/setTreeNodeParent), que
//    re-parseiam e validam a fonte do realizado de novo. NUNCA exclui: omitir
//    um nó não o apaga (mesma regra dos widgets).
//
// Módulo PURO (sem I/O): testável e importável pelo `check.ts`.
import {
  indicatorRows,
  parseNodePayload,
  type IndicatorRow,
} from "@/lib/tree/payload";

export const TREE_MAP_NODE_KINDS = ["note", "indicator", "plan", "ritual"] as const;
export type TreeMapNodeKind = (typeof TREE_MAP_NODE_KINDS)[number];

export const TREE_NOTE_STATUSES = ["texto", "pendente", "concluida"] as const;
export type TreeMapNoteStatus = (typeof TREE_NOTE_STATUSES)[number];

/** Teto de nós exportados por mapa (o prompt não cresce sem limite). */
export const MAX_EXPORTED_MAP_NODES = 300;
/** Teto de nós NOVOS por resposta da IA. */
export const MAX_NEW_MAP_NODES = 60;

/** Um nó como a IA o vê (export) e o devolve (delta). */
export interface ImportMapNodeSpec {
  key: string;
  parentKey?: string | null;
  kind?: TreeMapNodeKind;
  label?: string;
  body?: string | null;
  /** Só anotação. */
  status?: TreeMapNoteStatus;
  /** Só anotação: é o Resultado esperado. */
  goal?: boolean;
  /** Só anotação: prazo (AAAA-MM-DD). */
  dueDate?: string | null;
  /** Indicador/Multi-fatores/ritual (lib/tree/payload.ts). */
  payload?: unknown;
}

export interface ImportMapSpec {
  mapKey: string;
  nodes: ImportMapNodeSpec[];
}

/** Linha crua de `tree_nodes` que o export consome. */
export interface TreeMapRow {
  id: string;
  scope_id: string;
  kind: string;
  parent_ref: string | null;
  label: string | null;
  body: string | null;
  status: string | null;
  is_goal: boolean | null;
  due_date: string | null;
  payload: unknown;
  preset_key: string | null;
}

/** Retrato dos nós dos mapas (Desfazer da edição por IA). */
export interface TreeMapRowSnapshot {
  id: string;
  scope_id: string;
  kind: string;
  parent_ref: string | null;
  label: string | null;
  body: string | null;
  status: string | null;
  is_goal: boolean | null;
  due_date: string | null;
  payload: unknown;
}

export interface TreeMapsSnapshot {
  mapKeys: string[];
  rows: TreeMapRowSnapshot[];
}

export interface ExportedTreeMaps {
  mapas: ImportMapSpec[];
  /** `${mapKey}|${key}` → uuid da linha. Fica no servidor. */
  nodeIdByKey: Map<string, string>;
  warnings: string[];
}

export function mapNodeIdKey(mapKey: string, key: string): string {
  return `${mapKey}|${key}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function shortHex(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

const KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Mapas (modo livre) usados pelos widgets Tree de um board. */
export function treeMapKeysOf(
  widgets: { visual_type?: string | null; settings?: unknown }[]
): string[] {
  const out = new Set<string>();
  for (const w of widgets) {
    if (w.visual_type !== "tree") continue;
    const tree = isRecord(w.settings) ? w.settings.tree : undefined;
    if (!isRecord(tree)) continue;
    if (tree.source !== "livre") continue;
    if (typeof tree.mapKey === "string" && tree.mapKey.trim()) {
      out.add(tree.mapKey.trim());
    }
  }
  return [...out].sort();
}

/** Payload como a IA o vê: indicador com as linhas EFETIVAS (as cinco). */
function exportPayload(kind: TreeMapNodeKind, raw: unknown): unknown {
  if (kind === "note") return undefined;
  const parsed = parseNodePayload(kind, raw);
  if (!parsed) return raw ?? undefined;
  if (kind === "indicator") {
    return { ...parsed, rows: indicatorRows(parsed as { rows?: IndicatorRow[] }) };
  }
  return parsed;
}

/**
 * Linhas de `tree_nodes` → `mapas` do JSON. Keys determinísticas
 * (`preset_key` ou `n_<8 hex do uuid>`, dedupe `_2`) — o apply recalcula o
 * MESMO mapa a partir das mesmas linhas.
 */
export function exportTreeMaps(
  rows: TreeMapRow[],
  mapKeys: string[]
): ExportedTreeMaps {
  const nodeIdByKey = new Map<string, string>();
  const warnings: string[] = [];
  const mapas: ImportMapSpec[] = [];
  for (const mapKey of mapKeys) {
    const own = rows
      .filter(
        (r) =>
          r.scope_id === mapKey &&
          (TREE_MAP_NODE_KINDS as readonly string[]).includes(r.kind)
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (own.length > MAX_EXPORTED_MAP_NODES) {
      warnings.push(
        `Mapa "${mapKey}": ${own.length} nós — só os ${MAX_EXPORTED_MAP_NODES} primeiros foram enviados à IA.`
      );
    }
    const used = new Set<string>();
    const keyById = new Map<string, string>();
    for (const r of own) {
      let key =
        r.preset_key && KEY_RE.test(r.preset_key) ? r.preset_key : `n_${shortHex(r.id)}`;
      if (used.has(key)) {
        let n = 2;
        while (used.has(`${key}_${n}`)) n++;
        key = `${key}_${n}`;
      }
      used.add(key);
      keyById.set(r.id, key);
      nodeIdByKey.set(mapNodeIdKey(mapKey, key), r.id);
    }
    const nodes: ImportMapNodeSpec[] = [];
    for (const r of own.slice(0, MAX_EXPORTED_MAP_NODES)) {
      const kind = r.kind as TreeMapNodeKind;
      const parentId =
        r.parent_ref && r.parent_ref.startsWith("note:")
          ? r.parent_ref.slice("note:".length)
          : null;
      const node: ImportMapNodeSpec = {
        key: keyById.get(r.id) as string,
        kind,
        label: r.label ?? "",
      };
      const parentKey = parentId ? keyById.get(parentId) : undefined;
      if (parentKey) node.parentKey = parentKey;
      if (r.body) node.body = r.body;
      if (kind === "note") {
        node.status =
          r.status === "pendente" || r.status === "concluida" ? r.status : "texto";
        if (r.is_goal) node.goal = true;
        if (r.due_date) node.dueDate = r.due_date.slice(0, 10);
      } else {
        const p = exportPayload(kind, r.payload);
        if (p !== undefined) node.payload = p;
      }
      nodes.push(node);
    }
    mapas.push({ mapKey, nodes });
  }
  return { mapas, nodeIdByKey, warnings };
}

/** Linhas do cartão: mescla POR `kind`. Lista com todos os kinds = ordem nova. */
export function mergeIndicatorRows(base: unknown, patch: unknown): unknown {
  if (!Array.isArray(patch)) return patch;
  if (!Array.isArray(base)) return patch;
  const patchByKind = new Map<string, Record<string, unknown>>();
  for (const r of patch) {
    if (isRecord(r) && typeof r.kind === "string") patchByKind.set(r.kind, r);
  }
  const baseKinds = base
    .filter(isRecord)
    .map((r) => r.kind)
    .filter((k): k is string => typeof k === "string");
  // A IA mandou a lista INTEIRA: ela define a ordem.
  if (baseKinds.length > 0 && baseKinds.every((k) => patchByKind.has(k))) {
    return patch.map((r) => {
      if (!isRecord(r)) return r;
      const b = base.find((x) => isRecord(x) && x.kind === r.kind);
      return isRecord(b) ? { ...b, ...r } : r;
    });
  }
  const out = base.map((b) => {
    if (!isRecord(b)) return b;
    const p = patchByKind.get(b.kind as string);
    return p ? { ...b, ...p } : b;
  });
  for (const [kind, r] of patchByKind) {
    if (!baseKinds.includes(kind)) out.push(r);
  }
  return out;
}

function mergeValue(base: unknown, patch: unknown, path: string[]): unknown {
  if (path.length === 2 && path[0] === "payload" && path[1] === "rows") {
    return mergeIndicatorRows(base, patch);
  }
  if (isRecord(base) && isRecord(patch)) {
    const out: Record<string, unknown> = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = mergeValue(base[k], patch[k], [...path, k]);
    }
    return out;
  }
  return patch;
}

/**
 * Delta da IA sobre o estado exportado: nó de key EXISTENTE é mesclado (o
 * resto vem do estado); key nova passa intacta. Nós não citados NÃO entram
 * (o apply só toca o que veio).
 */
export function mergeMapDeltas(
  baseMaps: ImportMapSpec[] | undefined,
  aiMaps: unknown
): unknown {
  if (!Array.isArray(aiMaps)) return aiMaps;
  const baseByMap = new Map<string, Map<string, ImportMapNodeSpec>>();
  for (const m of baseMaps ?? []) {
    baseByMap.set(m.mapKey, new Map(m.nodes.map((n) => [n.key, n])));
  }
  return aiMaps.map((m) => {
    if (!isRecord(m) || !Array.isArray(m.nodes)) return m;
    const base = typeof m.mapKey === "string" ? baseByMap.get(m.mapKey) : undefined;
    return {
      ...m,
      nodes: m.nodes.map((n) => {
        if (!isRecord(n) || typeof n.key !== "string") return n;
        const b = base?.get(n.key);
        return b ? mergeValue(b, n, []) : n;
      }),
    };
  });
}

// ---------------- Validação + plano ----------------

export interface TreeMapNodeChange {
  label?: string;
  body?: string | null;
  status?: TreeMapNoteStatus;
  goal?: boolean;
  dueDate?: string | null;
  payload?: unknown;
  /** Re-pendurar: key do novo pai (null = raiz). */
  parentKey?: string | null;
}

export interface TreeMapPlanUpdate {
  key: string;
  kind: TreeMapNodeKind;
  label: string;
  changes: TreeMapNodeChange;
}

export interface TreeMapPlanCreate {
  key: string;
  kind: TreeMapNodeKind;
  parentKey: string | null;
  label: string;
  body: string | null;
  status?: TreeMapNoteStatus;
  goal?: boolean;
  dueDate?: string | null;
  payload?: unknown;
}

export interface TreeMapPlanMap {
  mapKey: string;
  updates: TreeMapPlanUpdate[];
  /** Pais antes dos filhos. */
  creates: TreeMapPlanCreate[];
  unchanged: string[];
}

export interface TreeMapValidation {
  errors: string[];
  warnings: string[];
  plan: TreeMapPlanMap[];
}

const LABEL_MAX = 200;
const BODY_MAX = 4000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Igualdade estrutural estável (ordem de chaves irrelevante). */
export function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Valida a seção `mapas` (JÁ mesclada sobre o estado) e devolve o plano de
 * escrita. `existing` = mapas exportados do board; `allowedMapKeys` = mapas de
 * widgets Tree (modo livre) do board E do próprio JSON.
 */
export function validateTreeMaps(
  raw: unknown,
  ctx: { existing: ImportMapSpec[]; allowedMapKeys: ReadonlySet<string> }
): TreeMapValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan: TreeMapPlanMap[] = [];
  if (raw === undefined || raw === null) return { errors, warnings, plan };
  if (!Array.isArray(raw)) {
    errors.push('"mapas" precisa ser uma lista: [{ "mapKey": "...", "nodes": [...] }].');
    return { errors, warnings, plan };
  }
  const existingByMap = new Map(
    ctx.existing.map((m) => [m.mapKey, new Map(m.nodes.map((n) => [n.key, n]))])
  );
  let created = 0;
  raw.forEach((m, mi) => {
    const where = `mapas[${mi}]`;
    if (!isRecord(m)) {
      errors.push(`${where}: precisa ser um objeto.`);
      return;
    }
    const mapKey = typeof m.mapKey === "string" ? m.mapKey.trim() : "";
    if (!mapKey || !ctx.allowedMapKeys.has(mapKey)) {
      errors.push(
        `${where}: "mapKey" precisa ser o mapa de um widget Tree (modo livre) deste dashboard. Disponíveis: ${[...ctx.allowedMapKeys].join(", ") || "(nenhum)"}.`
      );
      return;
    }
    if (!Array.isArray(m.nodes)) {
      errors.push(`${where}: "nodes" precisa ser uma lista.`);
      return;
    }
    const existing = existingByMap.get(mapKey) ?? new Map<string, ImportMapNodeSpec>();
    const out: TreeMapPlanMap = { mapKey, updates: [], creates: [], unchanged: [] };
    const newKeys = new Set<string>();
    const seen = new Set<string>();
    for (const n of m.nodes) {
      if (isRecord(n) && typeof n.key === "string" && !existing.has(n.key)) newKeys.add(n.key);
    }
    const pendingCreates: TreeMapPlanCreate[] = [];
    m.nodes.forEach((n, ni) => {
      const nw = `${where}.nodes[${ni}]`;
      if (!isRecord(n)) {
        errors.push(`${nw}: precisa ser um objeto.`);
        return;
      }
      const key = typeof n.key === "string" ? n.key.trim() : "";
      if (!key || !KEY_RE.test(key)) {
        errors.push(`${nw}: "key" é obrigatória (slug: letras, números, _ ou -).`);
        return;
      }
      if (seen.has(key)) {
        errors.push(`${nw}: key "${key}" repetida no mesmo mapa.`);
        return;
      }
      seen.add(key);
      const base = existing.get(key);
      const kind = (base?.kind ?? n.kind) as TreeMapNodeKind | undefined;
      if (!kind || !(TREE_MAP_NODE_KINDS as readonly string[]).includes(kind)) {
        errors.push(
          `${nw}: "kind" deve ser ${TREE_MAP_NODE_KINDS.join(" | ")}.`
        );
        return;
      }
      if (base && n.kind !== undefined && n.kind !== base.kind) {
        errors.push(
          `${nw}: não é possível trocar o tipo do nó "${key}" (${base.kind} → ${String(n.kind)}) — converta pela própria Tree.`
        );
        return;
      }
      const label = typeof n.label === "string" ? n.label.trim().slice(0, LABEL_MAX) : "";
      if (!label) {
        errors.push(`${nw}: "label" não pode ficar vazio.`);
        return;
      }
      let body: string | null = null;
      if (n.body !== undefined && n.body !== null) {
        if (typeof n.body !== "string") {
          errors.push(`${nw}: "body" precisa ser texto.`);
          return;
        }
        body = n.body.slice(0, BODY_MAX) || null;
      }
      let status: TreeMapNoteStatus | undefined;
      let goal: boolean | undefined;
      let dueDate: string | null | undefined;
      let payload: unknown;
      if (kind === "note") {
        if (n.status !== undefined) {
          if (!(TREE_NOTE_STATUSES as readonly string[]).includes(n.status as string)) {
            errors.push(`${nw}: "status" deve ser ${TREE_NOTE_STATUSES.join(" | ")}.`);
            return;
          }
          status = n.status as TreeMapNoteStatus;
        }
        if (n.goal !== undefined) goal = n.goal === true;
        if (n.dueDate !== undefined) {
          if (n.dueDate !== null && !(typeof n.dueDate === "string" && ISO_RE.test(n.dueDate))) {
            errors.push(`${nw}: "dueDate" deve ser AAAA-MM-DD ou null.`);
            return;
          }
          dueDate = (n.dueDate as string | null) ?? null;
        }
        if (n.payload !== undefined && n.payload !== null) {
          warnings.push(`${nw}: anotação não tem "payload" — ignorado.`);
        }
      } else {
        const parsed = parseNodePayload(kind, n.payload);
        if (!parsed) {
          errors.push(
            `${nw}: "payload" inválido para ${kind} — confira o formato em "mapas" (indicador precisa de "indicator" com uma chave de meta OU de "realized.override"; ritual precisa de "schedule" com "cadence" e "anchor").`
          );
          return;
        }
        payload = parsed;
      }
      let parentKey: string | null | undefined;
      if (n.parentKey !== undefined) {
        if (n.parentKey === null || n.parentKey === "") parentKey = null;
        else if (typeof n.parentKey === "string") {
          if (n.parentKey === key) {
            errors.push(`${nw}: um nó não pode ser pai de si mesmo.`);
            return;
          }
          if (!existing.has(n.parentKey) && !newKeys.has(n.parentKey)) {
            errors.push(
              `${nw}: "parentKey" "${n.parentKey}" não existe neste mapa (use a key de um nó existente ou de um nó novo desta resposta).`
            );
            return;
          }
          parentKey = n.parentKey;
        }
      }

      if (base) {
        const changes: TreeMapNodeChange = {};
        if (label !== (base.label ?? "")) changes.label = label;
        if ((body ?? null) !== (base.body ?? null) && n.body !== undefined) changes.body = body;
        if (kind === "note") {
          if (status !== undefined && status !== (base.status ?? "texto")) changes.status = status;
          if (goal !== undefined && goal !== (base.goal === true)) changes.goal = goal;
          if (dueDate !== undefined && (dueDate ?? null) !== (base.dueDate ?? null))
            changes.dueDate = dueDate;
        } else {
          const baseParsed = parseNodePayload(kind, base.payload);
          if (!sameJson(payload, baseParsed)) changes.payload = payload;
        }
        if (parentKey !== undefined && (parentKey ?? null) !== (base.parentKey ?? null)) {
          changes.parentKey = parentKey;
        }
        if (Object.keys(changes).length === 0) out.unchanged.push(label);
        else out.updates.push({ key, kind, label, changes });
      } else {
        created += 1;
        pendingCreates.push({
          key,
          kind,
          parentKey: parentKey ?? null,
          label,
          body,
          ...(kind === "note"
            ? { status: status ?? "texto", goal: goal === true, dueDate: dueDate ?? null }
            : { payload }),
        });
      }
    });
    // Pais antes dos filhos (só entre os novos; ciclo = erro).
    const ordered: TreeMapPlanCreate[] = [];
    const placed = new Set<string>();
    let guard = pendingCreates.length + 1;
    while (ordered.length < pendingCreates.length && guard-- > 0) {
      for (const c of pendingCreates) {
        if (placed.has(c.key)) continue;
        if (c.parentKey && newKeys.has(c.parentKey) && !placed.has(c.parentKey)) continue;
        ordered.push(c);
        placed.add(c.key);
      }
    }
    if (ordered.length < pendingCreates.length) {
      errors.push(`${where}: os nós novos formam um ciclo de "parentKey".`);
      return;
    }
    out.creates = ordered;
    plan.push(out);
  });
  if (created > MAX_NEW_MAP_NODES) {
    errors.push(`No máximo ${MAX_NEW_MAP_NODES} nós novos por resposta (vieram ${created}).`);
  }
  return { errors, warnings, plan };
}

/** Resumo da prévia ("atualiza nó: …" / "novo nó: …" / "sem mudança: …"). */
export function treeMapSummary(plan: TreeMapPlanMap[]): string[] {
  const out: string[] = [];
  for (const m of plan) {
    for (const u of m.updates) out.push(`atualiza nó: ${u.label}`);
    for (const c of m.creates) out.push(`novo nó: ${c.label}`);
    if (m.unchanged.length > 0) {
      out.push(`${m.unchanged.length} nó(s) sem mudança no mapa "${m.mapKey}"`);
    }
  }
  return out;
}

/** Mapas declarados nos widgets do PRÓPRIO JSON (widget Tree novo com mapa novo). */
export function treeMapKeysInJson(parsed: unknown): string[] {
  if (!isRecord(parsed) || !Array.isArray(parsed.widgets)) return [];
  return treeMapKeysOf(
    parsed.widgets.filter(isRecord).map((w) => ({
      visual_type: typeof w.visual_type === "string" ? w.visual_type : null,
      settings: w.settings,
    }))
  );
}
