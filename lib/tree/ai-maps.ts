// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): o lado SERVIDOR da seção `mapas` do contrato
// `dashboard-import` (lib/import/dashboard/tree-maps.ts é o lado puro).
//
//  - `loadBoardTreeMaps`: lê, com o client RLS do usuário, as linhas próprias
//    dos mapas usados pelos widgets Tree (modo livre) do board e as exporta.
//  - `applyTreeMapPlan`: escreve SÓ pelos choke points de tree-actions.ts —
//    `createTreeNote`/`createTreeNode` (nós novos, pais antes dos filhos),
//    `updateTreeNote`/`updateTreeNode` (que re-parseiam o payload e validam a
//    fonte do realizado de novo) e `setTreeNodeParent` (re-pendurar). Nada de
//    escrita direta em `tree_nodes` (invariante 25). Resultado POR NÓ.
//  - `captureTreeMapRows`/`restoreTreeMapRows`: o Desfazer da edição por IA
//    cobre os nós (o snapshot do board só via widgets).
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  createTreeNode,
  createTreeNote,
  setTreeNodeParent,
  updateTreeNode,
  updateTreeNote,
} from "@/app/(app)/dashboards/tree-actions";
import {
  exportTreeMaps,
  mapNodeIdKey,
  treeMapKeysOf,
  TREE_MAP_NODE_KINDS,
  type ExportedTreeMaps,
  type TreeMapPlanMap,
  type TreeMapRow,
  type TreeMapsSnapshot,
} from "@/lib/import/dashboard/tree-maps";

type Db = Awaited<ReturnType<typeof createClient>>;

const ROW_COLS =
  "id, scope_id, kind, parent_ref, label, body, status, is_goal, due_date, payload, preset_key";

async function loadMapRows(supabase: Db, mapKeys: string[]): Promise<TreeMapRow[]> {
  if (mapKeys.length === 0) return [];
  const { data } = await supabase
    .from("tree_nodes")
    .select(ROW_COLS)
    .eq("scope_kind", "livre")
    .in("scope_id", mapKeys)
    .is("node_ref", null)
    .in("kind", [...TREE_MAP_NODE_KINDS]);
  return (data ?? []) as TreeMapRow[];
}

export interface BoardTreeMaps extends ExportedTreeMaps {
  mapKeys: string[];
}

/** Mapas dos widgets Tree (modo livre) de um board, exportados para a IA. */
export async function loadBoardTreeMaps(
  supabase: Db,
  widgets: { visual_type?: string | null; settings?: unknown }[]
): Promise<BoardTreeMaps> {
  const mapKeys = treeMapKeysOf(widgets);
  const rows = await loadMapRows(supabase, mapKeys);
  return { ...exportTreeMaps(rows, mapKeys), mapKeys };
}

export interface TreeMapApplyResult {
  updated: number;
  created: number;
  errors: string[];
}

/** Escreve o plano validado pelos choke points da Tree. */
export async function applyTreeMapPlan(
  plan: TreeMapPlanMap[],
  nodeIdByKey: Map<string, string>
): Promise<TreeMapApplyResult> {
  const out: TreeMapApplyResult = { updated: 0, created: 0, errors: [] };
  const opts = { revalidate: false } as const;
  for (const m of plan) {
    const scope = { kind: "livre" as const, mapKey: m.mapKey };
    const ids = new Map<string, string>();
    for (const [k, id] of nodeIdByKey) {
      const prefix = `${m.mapKey}|`;
      if (k.startsWith(prefix)) ids.set(k.slice(prefix.length), id);
    }
    const parentRefOf = (key: string | null | undefined): string | null => {
      if (!key) return null;
      const id = ids.get(key);
      return id ? `note:${id}` : null;
    };

    for (const c of m.creates) {
      const parentRef = parentRefOf(c.parentKey);
      const res =
        c.kind === "note"
          ? await createTreeNote(
              scope,
              {
                parentRef,
                label: c.label,
                body: c.body,
                status: c.status,
                goal: c.goal,
              },
              opts
            )
          : await createTreeNode(
              scope,
              { kind: c.kind, parentRef, label: c.label, body: c.body, payload: c.payload },
              opts
            );
      if (!res.ok || !res.nodeId) {
        out.errors.push(`Nó "${c.label}": ${res.message ?? "falha ao criar."}`);
        continue;
      }
      const newId = res.nodeId.slice("note:".length);
      ids.set(c.key, newId);
      nodeIdByKey.set(mapNodeIdKey(m.mapKey, c.key), newId);
      if (c.kind === "note" && c.dueDate) {
        const due = await updateTreeNote(newId, { dueDate: c.dueDate }, opts);
        if (!due.ok) out.errors.push(`Nó "${c.label}": ${due.message ?? "prazo não gravado."}`);
      }
      out.created += 1;
    }

    for (const u of m.updates) {
      const id = ids.get(u.key);
      if (!id) {
        out.errors.push(`Nó "${u.label}": não encontrado no mapa.`);
        continue;
      }
      const { parentKey, ...cols } = u.changes;
      let ok = true;
      if (Object.keys(cols).length > 0) {
        const res =
          u.kind === "note"
            ? await updateTreeNote(
                id,
                {
                  label: cols.label,
                  body: cols.body,
                  status: cols.status,
                  goal: cols.goal,
                  dueDate: cols.dueDate,
                },
                opts
              )
            : await updateTreeNode(
                id,
                { kind: u.kind, label: cols.label, body: cols.body, payload: cols.payload },
                opts
              );
        if (!res.ok) {
          ok = false;
          out.errors.push(`Nó "${u.label}": ${res.message ?? "falha ao salvar."}`);
        }
      }
      if (parentKey !== undefined) {
        const res = await setTreeNodeParent(scope, `note:${id}`, parentRefOf(parentKey), opts);
        if (!res.ok) {
          ok = false;
          out.errors.push(`Nó "${u.label}": ${res.message ?? "não foi possível mudar o pai."}`);
        }
      }
      if (ok) out.updated += 1;
    }
  }
  return out;
}

// ---------------- Desfazer ----------------

export async function captureTreeMapRows(
  supabase: Db,
  mapKeys: string[]
): Promise<TreeMapsSnapshot | null> {
  if (mapKeys.length === 0) return null;
  const rows = await loadMapRows(supabase, mapKeys);
  return {
    mapKeys,
    rows: rows
      .map((r) => ({
        id: r.id,
        scope_id: r.scope_id,
        kind: r.kind,
        parent_ref: r.parent_ref,
        label: r.label,
        body: r.body,
        status: r.status,
        is_goal: r.is_goal,
        due_date: r.due_date,
        payload: r.payload,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Repõe os nós dos mapas no estado do snapshot: conteúdo e pai de cada linha
 * do retrato e REMOVE as linhas próprias que nasceram depois (as que a IA
 * criou). Restaurar é restaurar — como o Desfazer dos widgets, reconcilia por
 * linha com o client RLS do usuário.
 */
export async function restoreTreeMapRows(
  supabase: Db,
  snap: TreeMapsSnapshot
): Promise<{ ok: boolean; message?: string }> {
  for (const r of snap.rows) {
    const { error } = await supabase
      .from("tree_nodes")
      .update({
        parent_ref: r.parent_ref,
        label: r.label,
        body: r.body,
        status: r.status,
        is_goal: r.is_goal,
        due_date: r.due_date,
        payload: r.payload,
      })
      .eq("id", r.id)
      .is("node_ref", null);
    if (error) return { ok: false, message: error.message };
  }
  const now = await loadMapRows(supabase, snap.mapKeys);
  const keep = new Set(snap.rows.map((r) => r.id));
  const extra = now.map((r) => r.id).filter((id) => !keep.has(id));
  if (extra.length > 0) {
    const { error } = await supabase
      .from("tree_nodes")
      .delete()
      .in("id", extra)
      .is("node_ref", null);
    if (error) return { ok: false, message: error.message };
  }
  return { ok: true };
}
