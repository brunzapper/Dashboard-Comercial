// Versão: 1.0 | Data: 11/10/2026
// A ENTIDADE DO CRM de um registro, para o WRITE-BACK (0155).
//
// Os cinco caminhos que enfileiram write-back (edição de registro, ação em
// massa do kanban, automação, ingestão e a edição por IA) tinham cada um o
// ternário `negocio → deal / lead → lead`. Com os processos inteligentes a
// resposta passa a depender de `data_sources.bitrix_entity_type_id`, e um
// ternário a mais em cada sítio seria a régua paralela que o projeto proíbe.
// Este é o dono único da pergunta "para onde grava este registro?".
import type { SupabaseClient } from "@supabase/supabase-js";

import { dynamicEntity, type BitrixEntity } from "./entities";

/**
 * Entidade do CRM do `record_type`, ou null (Base sem par no Bitrix). Lead e
 * negócio respondem sem consulta; o resto lê a Base (a leitura passa pela RLS
 * de quem chama — usuário sem acesso à Base não grava nela de todo modo).
 */
export async function resolveRecordEntity(
  db: SupabaseClient,
  recordType: string | null | undefined
): Promise<BitrixEntity | null> {
  if (recordType === "lead") return "lead";
  if (recordType === "negocio") return "deal";
  if (!recordType) return null;
  try {
    const { data, error } = await db
      .from("data_sources")
      .select("bitrix_entity_type_id")
      .eq("record_type", recordType)
      .maybeSingle();
    if (error) return null;
    const typeId = Number(data?.bitrix_entity_type_id);
    return Number.isInteger(typeId) && typeId > 0 ? dynamicEntity(typeId) : null;
  } catch {
    return null;
  }
}

/** Versão em lote (ações em massa): um select para todos os record_types. */
export async function resolveRecordEntities(
  db: SupabaseClient,
  recordTypes: Iterable<string>
): Promise<Map<string, BitrixEntity>> {
  const out = new Map<string, BitrixEntity>();
  const rest: string[] = [];
  for (const rt of new Set(recordTypes)) {
    if (rt === "lead") out.set(rt, "lead");
    else if (rt === "negocio") out.set(rt, "deal");
    else if (rt) rest.push(rt);
  }
  if (rest.length === 0) return out;
  try {
    const { data } = await db
      .from("data_sources")
      .select("record_type, bitrix_entity_type_id")
      .in("record_type", rest)
      .not("bitrix_entity_type_id", "is", null);
    for (const r of data ?? []) {
      const typeId = Number(r.bitrix_entity_type_id);
      if (Number.isInteger(typeId) && typeId > 0) {
        out.set(r.record_type as string, dynamicEntity(typeId));
      }
    }
  } catch {
    // sem a coluna (0155 não aplicada): só lead/negócio gravam de volta
  }
  return out;
}
