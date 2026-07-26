// Versão: 2.0 | Data: 26/07/2026
// Escopo VIVO de uma operação para filtros de visualização (20/07/2026):
// `records.operation_id` é uma cópia DERIVADA (operação priority=1 do
// responsável no momento do sync) e pode estar NULL/defasada — filtrar pela
// coluna literal zera dashboards. O caminho canônico do filtro de Operação é
// este resolvedor: (a) responsáveis do VÍNCULO responsible_operations da
// subárvore (qualquer priority) → `responsible_id in`;
// (b) + os FILTROS DE PERFIL da operação (operations.filter, 0083 — mesmo
// shape WidgetFilter das sub-fontes, com `sources` opcional por condição).
// Consumidores: page do dashboard e widget-scope (espelho server-side).
// Dimensões/agrupamentos e restrições de snapshot seguem na coluna derivada
// (ver runbook do backfill).
// v2.0 (26/07/2026, Parcerias): loader BATELADO (2 queries + subárvores em JS;
//   antes: 1 RPC + 2 queries POR operação) e FUSÃO de perfis — multi-seleção
//   de operações profile-only (sub-operações de parceria) e seleção do PAI
//   fundem os perfis num único `in`/`in_ci` (0105) em vez de descartá-los e
//   zerar o dashboard. Casos não-fundíveis degradam exatamente como antes.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WidgetFilter } from "@/lib/widgets/types";

export interface SubtreeProfileEntry {
  opId: string;
  /** A operação tem vínculo DIRETO em responsible_operations. */
  hasResponsibles: boolean;
  profile: WidgetFilter[];
}

export interface OperationScope {
  responsibleIds: string[];
  profile: WidgetFilter[];
  /** Operações ATIVAS da subárvore (raiz inclusa) com perfil não-vazio —
   * insumo do roll-up do pai e da fusão multi-seleção. */
  subtreeProfiles: SubtreeProfileEntry[];
}

// Filtro impossível explícito: operação sem vínculo E sem perfil zera com
// clareza (uuid nulo nunca existe) em vez de silenciosamente não filtrar.
const IMPOSSIBLE: WidgetFilter = {
  field: "responsible_id",
  op: "in",
  value: ["00000000-0000-0000-0000-000000000000"],
};

function cleanProfile(v: unknown): WidgetFilter[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (f): f is WidgetFilter =>
      f != null &&
      typeof f === "object" &&
      typeof (f as WidgetFilter).field === "string" &&
      typeof (f as WidgetFilter).op === "string"
  );
}

interface OpRow {
  id: string;
  parent_operation_id: string | null;
  filter: unknown;
  active: boolean;
}

// Subárvore por BFS ciclo-safe (mesma semântica do RPC operation_subtree:
// UNION, termina mesmo com ciclo; raiz inclusa mesmo fora do catálogo).
function subtreeOf(root: string, childrenByParent: Map<string, string[]>): string[] {
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return [...seen];
}

/** Escopos das operações pedidas (subárvore incluída no vínculo). */
export const loadOperationScopes = cache(async function loadOperationScopes(
  supabase: SupabaseClient,
  operationIds: string[]
): Promise<Map<string, OperationScope>> {
  const out = new Map<string, OperationScope>();
  const wanted = [...new Set(operationIds)];
  if (wanted.length === 0) return out;
  try {
    // Catálogo inteiro da org (recorte pela RLS) numa ida só — `operations` é
    // pequena e o loop antigo (1 RPC + 2 queries POR operação) não escalava
    // com dezenas de parcerias multi-selecionadas.
    const { data: opsData } = await supabase
      .from("operations")
      .select("id, parent_operation_id, filter, active");
    const ops = (opsData ?? []) as OpRow[];
    const opById = new Map(ops.map((o) => [o.id, o]));
    const childrenByParent = new Map<string, string[]>();
    for (const o of ops) {
      if (!o.parent_operation_id) continue;
      const arr = childrenByParent.get(o.parent_operation_id);
      if (arr) arr.push(o.id);
      else childrenByParent.set(o.parent_operation_id, [o.id]);
    }

    const subtrees = new Map(
      wanted.map((id) => [id, subtreeOf(id, childrenByParent)])
    );
    const allIds = [...new Set([...subtrees.values()].flat())];

    const respByOp = new Map<string, string[]>();
    {
      const { data: links } = await supabase
        .from("responsible_operations")
        .select("responsible_id, operation_id")
        .in("operation_id", allIds);
      for (const l of links ?? []) {
        const op = l.operation_id as string;
        const resp = l.responsible_id as string;
        if (!resp) continue;
        const arr = respByOp.get(op);
        if (arr) arr.push(resp);
        else respByOp.set(op, [resp]);
      }
    }

    for (const opId of wanted) {
      const subtree = subtrees.get(opId) ?? [opId];
      const responsibleIds = [
        ...new Set(subtree.flatMap((id) => respByOp.get(id) ?? [])),
      ];
      const subtreeProfiles: SubtreeProfileEntry[] = [];
      for (const id of subtree) {
        const row = opById.get(id);
        if (!row || !row.active) continue;
        const profile = cleanProfile(row.filter);
        if (profile.length === 0) continue;
        subtreeProfiles.push({
          opId: id,
          hasResponsibles: (respByOp.get(id) ?? []).length > 0,
          profile,
        });
      }
      out.set(opId, {
        responsibleIds,
        profile: cleanProfile(opById.get(opId)?.filter),
        subtreeProfiles,
      });
    }
  } catch {
    for (const opId of wanted) {
      if (!out.has(opId)) {
        out.set(opId, { responsibleIds: [], profile: [], subtreeProfiles: [] });
      }
    }
  }
  return out;
});

/**
 * Funde N perfis de operação em UM filtro de pertencimento quando TODOS são
 * recortes de condição ÚNICA sobre o MESMO campo (e mesmas fontes-alvo) com
 * op eq/eq_ci/in — o caso das sub-operações de parceria geradas (0106).
 * Qualquer `_ci` presente → `in_ci` (normalização do eq_ci no RPC, 0105);
 * só exatos → `in`. Não-fundível (multi-condição, campos/fontes distintos,
 * outros ops) → null.
 */
export function fuseOperationProfiles(
  profiles: WidgetFilter[][]
): WidgetFilter | null {
  if (profiles.length === 0) return null;
  let field: string | null = null;
  let sources: WidgetFilter["sources"];
  let sourcesKey: string | null = null;
  let ci = false;
  const values: string[] = [];
  for (const p of profiles) {
    if (p.length !== 1) return null;
    const f = p[0];
    if (f.op !== "eq" && f.op !== "eq_ci" && f.op !== "in") return null;
    if (field == null) {
      field = f.field;
      sources = f.sources;
      sourcesKey = JSON.stringify(f.sources ?? null);
    } else if (
      f.field !== field ||
      JSON.stringify(f.sources ?? null) !== sourcesKey
    ) {
      return null;
    }
    if (f.op === "eq_ci") ci = true;
    if (f.op === "in") {
      if (!Array.isArray(f.value) || f.value.length === 0) return null;
      values.push(...f.value.map((v) => String(v)));
    } else {
      if (f.value == null || f.value === "") return null;
      values.push(String(f.value));
    }
  }
  if (field == null || values.length === 0) return null;
  return {
    field,
    op: ci ? "in_ci" : "in",
    value: [...new Set(values)],
    ...(sources && sources.length > 0 ? { sources } : {}),
  };
}

// Perfil FUNDIDO da seleção, quando aplicável (null = seguir o caminho
// clássico). Pré-condição: nenhum responsável em nenhuma subárvore pedida —
// OR entre `responsible_id in` e perfil não é exprimível em WidgetFilter[]
// (AND-only), então seleção mista degrada como sempre degradou.
function fusedProfileFor(
  ids: string[],
  scopes: Map<string, OperationScope>
): WidgetFilter | null {
  const parts: WidgetFilter[][] = [];
  for (const id of ids) {
    const scope = scopes.get(id);
    if (!scope) return null;
    if (ids.length === 1 && scope.profile.length > 0) {
      // 1 operação COM perfil próprio: caminho clássico byte a byte.
      return null;
    }
    if (scope.profile.length > 0) {
      parts.push(scope.profile);
      continue;
    }
    // Sem perfil próprio: roll-up das filhas profile-only da subárvore
    // (pai "Parceiro" seleciona a união das parcerias).
    const subs = scope.subtreeProfiles.filter(
      (e) => e.opId !== id && !e.hasResponsibles
    );
    if (subs.length === 0) return null;
    parts.push(...subs.map((e) => e.profile));
  }
  return fuseOperationProfiles(parts);
}

/**
 * Converte um filtro de visualização `operation_id eq/in` nos filtros de
 * escopo resolvidos. `carrySources` = alvo por fonte do filtro original
 * (pass-through), herdado pelas condições sem alvo próprio.
 * Regras: vínculo = união dos responsáveis das operações pedidas; PERFIL
 * próprio entra quando há UMA operação (recortes AND — combiná-los zeraria);
 * seleção SÓ de operações profile-only (nenhum responsável nas subárvores)
 * tenta a FUSÃO dos perfis (fuseOperationProfiles — inclui o roll-up do pai);
 * não-fundível degrada como antes. Sem vínculo e sem perfil → filtro
 * impossível explícito.
 */
export function operationFilterSet(
  ids: string[],
  scopes: Map<string, OperationScope>,
  carrySources?: string[]
): WidgetFilter[] {
  const respIds = [
    ...new Set(ids.flatMap((id) => scopes.get(id)?.responsibleIds ?? [])),
  ];
  const fused = respIds.length === 0 ? fusedProfileFor(ids, scopes) : null;
  const profile = fused
    ? [fused]
    : ids.length === 1
      ? (scopes.get(ids[0])?.profile ?? [])
      : [];
  const out: WidgetFilter[] = [];
  if (respIds.length > 0) {
    out.push({ field: "responsible_id", op: "in", value: respIds });
  }
  for (const f of profile) {
    out.push(
      f.sources && f.sources.length > 0
        ? f
        : carrySources && carrySources.length > 0
          ? { ...f, sources: carrySources as WidgetFilter["sources"] }
          : f
    );
  }
  if (out.length === 0) return [{ ...IMPOSSIBLE }];
  if (carrySources && carrySources.length > 0) {
    return out.map((f) =>
      f.sources && f.sources.length > 0
        ? f
        : { ...f, sources: carrySources as WidgetFilter["sources"] }
    );
  }
  return out;
}

/** Ids de operação referenciados por filtros `operation_id` eq/in. */
export function collectOperationFilterIds(
  filters: WidgetFilter[]
): string[] {
  const ids: string[] = [];
  for (const f of filters) {
    if (f.field !== "operation_id") continue;
    if (f.op === "eq" && typeof f.value === "string") ids.push(f.value);
    if (f.op === "in" && Array.isArray(f.value)) {
      for (const v of f.value) if (typeof v === "string") ids.push(v);
    }
  }
  return ids;
}

/** Reescreve filtros de visualização trocando `operation_id` pelo escopo. */
export function translateOperationFilters(
  filters: WidgetFilter[],
  scopes: Map<string, OperationScope>
): WidgetFilter[] {
  return filters.flatMap((f) => {
    if (f.field !== "operation_id") return [f];
    const ids =
      f.op === "eq" && typeof f.value === "string"
        ? [f.value]
        : f.op === "in" && Array.isArray(f.value)
          ? f.value.filter((v): v is string => typeof v === "string")
          : null;
    if (!ids || ids.length === 0) return [f];
    return operationFilterSet(ids, scopes, f.sources as string[] | undefined);
  });
}
