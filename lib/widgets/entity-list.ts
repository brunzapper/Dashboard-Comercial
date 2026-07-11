// Versão: 1.0 | Data: 11/07/2026
// Tabela de dashboard em modo lista cuja "Fonte das linhas" é uma ENTIDADE
// (responsáveis ou operações). Cada linha é uma entidade; as colunas
// personalizadas não calculadas são editáveis e gravam em entity_custom_values
// (valores globais/compartilhados). Aqui carregamos as entidades ativas + seus
// valores personalizados, indexados por field_key.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RowSource } from "./types";

export type EntityRowSource = Exclude<RowSource, "records">;

// entity_type usado em entity_custom_values (singular).
export const ENTITY_TYPE_OF: Record<EntityRowSource, "responsible" | "operation"> = {
  responsibles: "responsible",
  operations: "operation",
};

export interface EntityListRow {
  id: string;
  label: string; // nome da entidade (responsável/operação)
  // Valores dos campos personalizados por field_key (custom sem o prefixo).
  values: Record<string, unknown>;
}

/**
 * Lista as entidades ativas (responsáveis/operações) como linhas + seus valores
 * personalizados (entity_custom_values). RLS decide o que o usuário enxerga.
 */
export async function runEntityList(
  supabase: SupabaseClient,
  rowSource: EntityRowSource,
  limit?: number
): Promise<EntityListRow[]> {
  const entityType = ENTITY_TYPE_OF[rowSource];

  let entities: { id: string; label: string }[] = [];
  if (rowSource === "responsibles") {
    let q = supabase
      .from("responsibles")
      .select("id, display_name")
      .eq("active", true)
      .order("display_name");
    if (typeof limit === "number" && limit > 0) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    entities = (data ?? []).map((r) => ({
      id: r.id as string,
      label: (r.display_name as string) ?? "—",
    }));
  } else {
    let q = supabase
      .from("operations")
      .select("id, name")
      .eq("active", true)
      .order("name");
    if (typeof limit === "number" && limit > 0) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    entities = (data ?? []).map((r) => ({
      id: r.id as string,
      label: (r.name as string) ?? "—",
    }));
  }

  const ids = entities.map((e) => e.id);
  const valuesByEntity: Record<string, Record<string, unknown>> = {};
  if (ids.length > 0) {
    const { data: vals } = await supabase
      .from("entity_custom_values")
      .select("entity_id, field_key, value")
      .eq("entity_type", entityType)
      .in("entity_id", ids);
    for (const v of vals ?? []) {
      const eid = v.entity_id as string;
      (valuesByEntity[eid] ??= {})[v.field_key as string] = v.value;
    }
  }

  return entities.map((e) => ({
    id: e.id,
    label: e.label,
    values: valuesByEntity[e.id] ?? {},
  }));
}
