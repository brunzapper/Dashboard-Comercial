// Versão: 1.1 | Data: 19/07/2026
// Fase 8: correspondências de colunas GLOBAIS. Um "campo unificado" liga colunas
// equivalentes de fontes diferentes (por source-key) para que o widget as trate
// como a mesma coluna. Tipos + carregamento + o mapa passado ao RPC
// run_widget_query (p_correspondences): { "<key>": ["custom:a", "mrr", ...] }.
// v1.1 (19/07/2026): SUB-FONTES (0078) — o membro passa a ser identificado pela
//   SOURCE-KEY (`source_key`), não só pelo record_type: assim um campo unificado
//   pode ligar DUAS colunas do mesmo record_type (ex.: Leads→Data Reunião e a
//   sub Leads/Clientes Lite→Data da mudança de etapa). `correspondenceMapForSources`
//   monta o coalesce por PERNA (um ref por source-key), evitando misturar o membro
//   da pai com o da sub no mesmo coalesce.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DataType } from "@/lib/records/types";

export interface CorrespondenceMember {
  // record_type da fonte (o da PAI, quando a fonte é sub).
  record_type: string;
  // source-key da fonte (pai OU sub). Identidade do membro desde 0078.
  source_key: string;
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
      "id, key, label, data_type, members:field_correspondence_members(record_type, source_key, field_ref)"
    )
    .order("label", { ascending: true });
  return (data ?? []).map((c) => ({
    id: c.id as string,
    key: c.key as string,
    label: c.label as string,
    data_type: c.data_type as DataType,
    members: ((c.members ?? []) as CorrespondenceMember[]).map((m) => ({
      record_type: m.record_type,
      // Membros antigos (antes do backfill 0078) podem vir sem source_key; cai
      // no record_type (fontes dinâmicas: key === record_type; builtins são
      // retro-preenchidos pela migração).
      source_key: m.source_key ?? m.record_type,
      field_ref: m.field_ref,
    })),
  }));
}

/**
 * Mapa para o RPC: { "<key>": [refs distintos] }. Usado pelo run_widget_query
 * para montar coalesce(...) das colunas correspondidas. Refs vazios são
 * ignorados; chaves sem membros não entram (o RPC ergueria erro).
 *
 * ATENÇÃO (0078): este mapa GLOBAL junta TODOS os membros de cada correspondência
 * — inclusive membros de sub-fontes do MESMO record_type (ex.: Leads→reunião E
 * Leads/Clientes Lite→mudança). Num coalesce, uma linha de lead que tenha as duas
 * colunas preenchidas pegaria a 1ª — ambíguo. Por isso os caminhos de consulta
 * usam `correspondenceMapForSources` (um ref por SOURCE-KEY da perna). Mantido só
 * para caminhos legados sem sub-fontes.
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
 * Mapa `p_correspondences` de UMA PERNA (0078): para cada correspondência, o
 * coalesce só inclui os refs dos membros cujas source-keys estão na perna — um
 * por source-key, então no máximo um por record_type. Assim o coalesce da perna
 * escolhe o membro certo por linha (o da própria source-key), sem o membro da
 * sub e o da pai colidirem. `sourceKeys` são as fontes efetivas da perna (para a
 * consulta principal, as fontes RAIZ do widget; para uma perna de sub, [subKey]).
 */
export function correspondenceMapForSources(
  correspondences: Correspondence[],
  sourceKeys: string[]
): Record<string, string[]> {
  const want = new Set(sourceKeys);
  const map: Record<string, string[]> = {};
  for (const c of correspondences) {
    const refs = Array.from(
      new Set(
        c.members
          .filter((m) => want.has(m.source_key) && m.field_ref)
          .map((m) => m.field_ref)
      )
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
