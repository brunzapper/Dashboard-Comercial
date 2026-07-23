// Versão: 1.3 | Data: 23/07/2026
// v1.3 (23/07/2026): multi-org — orgId opcional filtra as correspondências da
//   organização ativa (RLS já escopa; o filtro resolve a visão multi-org).
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
// v1.2 (20/07/2026): `correspondenceMapForSources` vira o builder de TODOS os
//   caminhos de consulta (o gate "só quando há sub selecionada" deixava o mapa
//   global poluído vazar p/ widget só-pai — o membro da sub entrava no coalesce
//   da pai). Ganha fallback perna→raízes→todos (o RPC ergue erro p/ chave
//   referenciada ausente) + membros ordenados por source_key (coalesce
//   determinístico). `buildCorrespondenceMap` fica SÓ p/ opções de bucket.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DataType } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";

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

/** Carrega todas as correspondências + membros (da org, quando informada). */
export async function loadCorrespondences(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<Correspondence[]> {
  let query = supabase
    .from("field_correspondences")
    .select(
      "id, key, label, data_type, members:field_correspondence_members(record_type, source_key, field_ref)"
    )
    .order("label", { ascending: true });
  if (orgId) query = query.eq("organization_id", orgId);
  const { data } = await query;
  return (data ?? []).map((c) => ({
    id: c.id as string,
    key: c.key as string,
    label: c.label as string,
    data_type: c.data_type as DataType,
    members: ((c.members ?? []) as CorrespondenceMember[])
      .map((m) => ({
        record_type: m.record_type,
        // Membros antigos (antes do backfill 0078) podem vir sem source_key; cai
        // no record_type (fontes dinâmicas: key === record_type; builtins são
        // retro-preenchidos pela migração).
        source_key: m.source_key ?? m.record_type,
        field_ref: m.field_ref,
      }))
      // Ordem estável por source_key: qualquer coalesce que una 2+ membros
      // (multi-raiz ou fallback) sai determinístico entre carregamentos.
      .sort((a, b) => a.source_key.localeCompare(b.source_key)),
  }));
}

/**
 * Mapa GLOBAL { "<key>": [refs distintos] } — SÓ para as RPCs de OPÇÕES de
 * bucket/display (ex.: valores distintos de um unificado no editor), nunca para
 * consultas de widget.
 *
 * ATENÇÃO (0078/v1.2): este mapa junta TODOS os membros de cada correspondência
 * — inclusive membros de sub-fontes do MESMO record_type (ex.: Leads→reunião E
 * Leads/Clientes Lite→mudança). Num coalesce, uma linha de lead que tenha as duas
 * colunas preenchidas pegaria a 1ª — ambíguo, e foi exatamente o bug do widget
 * só-pai. TODOS os caminhos de consulta (runWidget, runCalculatedWidget, pernas)
 * usam `correspondenceMapForSources` (um ref por SOURCE-KEY da perna). Não passe
 * este mapa a `aggregate`/`run_widget_query`.
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
 *
 * Fallback (v1.2) — perna → RAÍZES (via `catalog`) → todos os membros: uma
 * correspondência referenciada na consulta mas sem membro nas fontes da perna
 * não pode simplesmente sumir do mapa (`_widget_unified_expr` ergue
 * "Correspondência sem colunas"), e snapshots congelados pré-0078 têm membros
 * sem `source_key` real. O caso pai+sub nunca cai no fallback: a perna sempre
 * tem o próprio membro, então o da sub fica DE FORA do coalesce da pai.
 */
export function correspondenceMapForSources(
  correspondences: Correspondence[],
  sourceKeys: string[],
  catalog: SourceDef[] = []
): Record<string, string[]> {
  const want = new Set(sourceKeys);
  const subKeys = new Set(
    catalog.filter((s) => s.parentKey).map((s) => s.key)
  );
  // Ordem do coalesce (20/07/2026): refs `custom:` (ESPARSOS — um campo custom
  // só existe nas linhas do próprio record_type) vêm ANTES das colunas do
  // núcleo (DENSAS — preenchidas em todo record_type). Sem isso, uma coluna
  // densa como `source_created_at` (membro do lead) sombrearia o membro
  // `custom:` de outro record_type na MESMA perna (ex.: data_assinatura do
  // deal), e a linha bucketizaria pela coluna errada. Limitação restante,
  // documentada: DOIS membros de coluna de núcleo distintos (ex.:
  // source_created_at + closed_at) ainda se sombreiam — a correção definitiva
  // seria CASE por record_type no RPC (migração espelhada, fase futura).
  const refsOf = (
    c: Correspondence,
    pick: (m: CorrespondenceMember) => boolean
  ): string[] => {
    const refs = Array.from(
      new Set(c.members.filter((m) => m.field_ref && pick(m)).map((m) => m.field_ref))
    );
    const isCustom = (r: string) => r.startsWith("custom:");
    return [...refs.filter(isCustom), ...refs.filter((r) => !isCustom(r))];
  };
  const map: Record<string, string[]> = {};
  for (const c of correspondences) {
    let refs = refsOf(c, (m) => want.has(m.source_key));
    if (refs.length === 0)
      refs = refsOf(c, (m) => !subKeys.has(m.source_key));
    if (refs.length === 0) refs = refsOf(c, () => true);
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
