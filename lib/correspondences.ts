// Versão: 1.0 | Data: 09/07/2026
// Fase 8: correspondências de colunas GLOBAIS. Um "campo unificado" liga colunas
// equivalentes de fontes diferentes (por record_type) para que o widget as trate
// como a mesma coluna. Tipos + carregamento + o mapa passado ao RPC
// run_widget_query (p_correspondences): { "<key>": ["custom:a", "mrr", ...] }.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DataType } from "@/lib/records/types";

export interface CorrespondenceMember {
  record_type: "lead" | "negocio" | "venda_site";
  field_ref: string; // coluna do núcleo (ex.: 'mrr') ou 'custom:<key>'
}

export interface Correspondence {
  id: string;
  key: string;
  label: string;
  data_type: DataType;
  members: CorrespondenceMember[];
}

/** Carrega todas as correspondências + membros (globais). */
export async function loadCorrespondences(
  supabase: SupabaseClient
): Promise<Correspondence[]> {
  const { data } = await supabase
    .from("field_correspondences")
    .select(
      "id, key, label, data_type, members:field_correspondence_members(record_type, field_ref)"
    )
    .order("label", { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id as string,
    key: c.key as string,
    label: c.label as string,
    data_type: c.data_type as DataType,
    members: ((c.members ?? []) as CorrespondenceMember[]).map((m) => ({
      record_type: m.record_type,
      field_ref: m.field_ref,
    })),
  }));
}

/**
 * Mapa para o RPC: { "<key>": [refs distintos] }. Usado pelo run_widget_query
 * para montar coalesce(...) das colunas correspondidas. Refs vazios são
 * ignorados; chaves sem membros não entram (o RPC ergueria erro).
 */
export function buildCorrespondenceMap(
  correspondences: Correspondence[]
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const c of correspondences) {
    const refs = Array.from(
      new Set(c.members.map((m) => m.field_ref).filter(Boolean))
    );
    if (refs.length > 0) map[c.key] = refs;
  }
  return map;
}

/**
 * Ref concreto (coluna do núcleo ou 'custom:<k>') do membro de um campo
 * unificado para um record_type — null quando a correspondência não tem membro
 * para essa fonte. Opera sobre o mapa `AvailableField.unifiedMembers` para os
 * caminhos client-side (modo registros, "Agrupar período") resolverem o valor
 * por registro, espelhando o coalesce do RPC.
 */
export function unifiedMemberRef(
  members: Record<string, string> | undefined,
  recordType: string | null | undefined
): string | null {
  if (!members || !recordType) return null;
  return members[recordType] || null;
}
