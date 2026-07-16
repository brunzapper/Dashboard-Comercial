// Versão: 1.0 | Data: 16/07/2026
// Fase 12 — regra dos mocks de "Data Reunião" (espelho CLIENT-SIDE do
// v_include_mocks de run_widget_query/0052+0054 e run_widget_query_snapshot/
// 0057): leads mock (records.is_mock) só entram quando a consulta referencia
// uma das duas chaves do campo — direto (custom:<k>, match:<fonte>:custom:<k>,
// o byType do @period ou o field do @bucket, todos serializados nas partes
// inspecionadas) ou via campo unificado cuja correspondência contenha uma
// delas. A detecção é textual por substring DE PROPÓSITO, em paridade com o
// `like '%<key>%'` / `position(...)` do SQL — não "corrigir" só de um lado.
import type { AvailableField } from "./fields";

// Chaves jsonb de "Data Reunião" (Lead/Negócio) — gatilho da regra dos mocks.
export const MOCK_REUNIAO_KEYS = [
  "bitrix_uf_crm_1743441331", // Data Reunião (Lead)
  "bitrix_uf_crm_67eacefcccd98", // Data Reunião (Negócio)
];

/**
 * Decide se uma consulta client-side referencia "Data Reunião" e portanto deve
 * incluir os leads mock. `parts` são os pedaços da config que a consulta
 * efetivamente usa (filtros, colunas, dimensões, métricas — conforme o modo);
 * `available` fornece os membros dos campos unificados (equivalente do
 * p_correspondences do RPC).
 */
export function includesMockReuniaoRef(
  parts: unknown[],
  available: Pick<AvailableField, "field" | "unifiedMembers">[] = []
): boolean {
  const refs = parts.map((p) => JSON.stringify(p ?? null)).join("");
  if (MOCK_REUNIAO_KEYS.some((k) => refs.includes(k))) return true;
  // Espelho do loop de p_correspondences do RPC (0054): campo `unified:<key>`
  // referenciado nas partes E correspondência contendo uma das chaves.
  for (const a of available) {
    if (!a.field.startsWith("unified:") || !refs.includes(a.field)) continue;
    const members = Object.values(a.unifiedMembers ?? {});
    if (members.some((ref) => MOCK_REUNIAO_KEYS.some((k) => ref.includes(k))))
      return true;
  }
  return false;
}
