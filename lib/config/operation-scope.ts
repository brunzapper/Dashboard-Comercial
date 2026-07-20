// Versão: 1.0 | Data: 20/07/2026
// Escopo VIVO de uma operação para filtros de visualização (20/07/2026):
// `records.operation_id` é uma cópia DERIVADA (operação priority=1 do
// responsável no momento do sync) e pode estar NULL/defasada — filtrar pela
// coluna literal zera dashboards. O caminho canônico do filtro de Operação é
// este resolvedor: (a) responsáveis do VÍNCULO responsible_operations da
// subárvore (operation_subtree, qualquer priority) → `responsible_id in`;
// (b) + os FILTROS DE PERFIL da operação (operations.filter, 0083 — mesmo
// shape WidgetFilter das sub-fontes, com `sources` opcional por condição).
// Consumidores: page do dashboard e widget-scope (espelho server-side).
// Dimensões/agrupamentos e restrições de snapshot seguem na coluna derivada
// (ver runbook do backfill).
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WidgetFilter } from "@/lib/widgets/types";

export interface OperationScope {
  responsibleIds: string[];
  profile: WidgetFilter[];
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

/** Escopos das operações pedidas (subárvore incluída no vínculo). */
export const loadOperationScopes = cache(async function loadOperationScopes(
  supabase: SupabaseClient,
  operationIds: string[]
): Promise<Map<string, OperationScope>> {
  const out = new Map<string, OperationScope>();
  for (const opId of [...new Set(operationIds)]) {
    try {
      // Subárvore (aninhamento 0016); falha do RPC degrada p/ a própria op.
      let subtree: string[] = [opId];
      try {
        const { data } = await supabase.rpc("operation_subtree", {
          p_root: opId,
        });
        const ids = (data ?? [])
          .map((r: { operation_id?: string }) => r.operation_id)
          .filter((x: unknown): x is string => typeof x === "string");
        if (ids.length > 0) subtree = ids;
      } catch {
        // mantém [opId]
      }
      const [{ data: links }, { data: op }] = await Promise.all([
        supabase
          .from("responsible_operations")
          .select("responsible_id")
          .in("operation_id", subtree),
        supabase.from("operations").select("filter").eq("id", opId).maybeSingle(),
      ]);
      out.set(opId, {
        responsibleIds: [
          ...new Set(
            (links ?? [])
              .map((l) => l.responsible_id as string)
              .filter(Boolean)
          ),
        ],
        profile: cleanProfile(op?.filter),
      });
    } catch {
      out.set(opId, { responsibleIds: [], profile: [] });
    }
  }
  return out;
});

/**
 * Converte um filtro de visualização `operation_id eq/in` nos filtros de
 * escopo resolvidos. `carrySources` = alvo por fonte do filtro original
 * (pass-through), herdado pelas condições sem alvo próprio.
 * Regras: vínculo = união dos responsáveis das operações pedidas; PERFIL só
 * entra quando há UMA operação (perfis de operações diferentes são recortes
 * AND — combiná-los zeraria; documentado). Sem vínculo e sem perfil → filtro
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
  const profile = ids.length === 1 ? (scopes.get(ids[0])?.profile ?? []) : [];
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
