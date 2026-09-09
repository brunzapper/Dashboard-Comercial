// Versão: 1.0 | Data: 09/09/2026
// Leitura dos atributos de registro (0131).
//
// Com o client RLS do usuário: a policy da 0131 já recorta (vê o atributo quem
// vê o registro). Nada de service role aqui — o único caminho de sistema é o
// executor da automação, que concede o atributo com org explícita.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AttributeStatus, RecordAttribute } from "./registry";

const SELECT =
  "id, record_id, attribute_key, status, granted_by_rule_id, config, created_at, updated_at";

function toRow(r: Record<string, unknown>): RecordAttribute {
  return {
    id: r.id as string,
    recordId: r.record_id as string,
    attributeKey: r.attribute_key as string,
    status: (r.status as AttributeStatus) ?? "ativo",
    grantedByRuleId: (r.granted_by_rule_id as string | null) ?? null,
    config:
      r.config && typeof r.config === "object" && !Array.isArray(r.config)
        ? (r.config as Record<string, unknown>)
        : {},
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

/** Atributos de UM registro (o painel do clique na linha). */
export async function loadRecordAttributes(
  db: SupabaseClient,
  recordId: string
): Promise<RecordAttribute[]> {
  const { data, error } = await db
    .from("record_attributes")
    .select(SELECT)
    .eq("record_id", recordId)
    .order("attribute_key");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(toRow);
}

/**
 * Quais registros de uma lista carregam um atributo — o que a TABELA precisa
 * para marcar as linhas clicáveis sem uma consulta por linha.
 */
export async function loadAttributeRecordIds(
  db: SupabaseClient,
  attributeKey: string,
  recordIds: string[]
): Promise<Map<string, RecordAttribute>> {
  const out = new Map<string, RecordAttribute>();
  if (recordIds.length === 0) return out;
  const CHUNK = 200;
  for (let i = 0; i < recordIds.length; i += CHUNK) {
    const { data } = await db
      .from("record_attributes")
      .select(SELECT)
      .eq("attribute_key", attributeKey)
      .in("record_id", recordIds.slice(i, i + CHUNK));
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const row = toRow(r);
      out.set(row.recordId, row);
    }
  }
  return out;
}
