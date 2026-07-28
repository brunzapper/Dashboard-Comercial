// Versão: 1.1 | Data: 28/07/2026
// v1.1 (28/07/2026): movido de lib/kanban/automations/ (agora compartilhado
//   com as métricas de card/coluna do quadro — "Leads vinculados") +
//   opts.extraPairs: pares extras opt-in (gêmeo records.related_lead_id,
//   espelhando o coalesce do _widget_match_expr p/ leads). O parceiro do par
//   extra passa pela MESMA validação (record_type/org/predicado/filtros) e o
//   dedupe de par cobre gêmeo × linha real de record_matches. As automações
//   (related_count) seguem chamando SEM extraPairs — comportamento inalterado.
// Contagem de registros CONECTADOS por card (condição related_count das
// automações e métricas "vinculados" do quadro): quantos registros da base
// `source` estão conectados (record_matches, qualquer direção) a cada um dos
// `recordIds` e passam nos `filters` — o "parceiro com ≥ N leads". O
// attachMatches do modo lista guarda só o MELHOR match por fonte (p/ resolver
// refs match:), então não serve p/ contar; aqui contamos TODOS os pares
// (deduplicados — dois vínculos por regras de match diferentes contam uma
// conexão só). Consultas com escopo EXPLÍCITO de org (chamador service-role)
// e chunks de 200 (padrão attachMatches). Filtros avaliados em memória com a
// MESMA semântica das condições de campo (fieldFilterMatches); refs match:
// são proibidos aqui (1 nível só — barrado no parse).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordRow } from "@/lib/records/types";
import { recordTypeOf, sourcePredicate, type SourceDef } from "@/lib/sources";
import type { AvailableField } from "@/lib/widgets/fields";
import { RECORD_COLS } from "@/lib/widgets/record-list";
import { recordRawValue } from "@/lib/widgets/quick-filters";
import type { WidgetFilter } from "@/lib/widgets/types";
import { fieldFilterMatches } from "./automations/evaluate";

const CHUNK = 200;

function chunksOf(list: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/**
 * Conta, por registro de origem, os conectados da base `source` que passam em
 * `filters`. Registro sem conexões não aparece no mapa (contagem 0 no
 * avaliador). `available`/`catalog` resolvem refs custom:/unified: dos filtros
 * e o predicado de sub-base (sub conta só as linhas recortadas da pai).
 * `opts.extraPairs` acrescenta pares fora de record_matches (gêmeo
 * related_lead_id) — validados e deduplicados como os demais.
 */
export async function countRelatedBySource(
  db: SupabaseClient,
  orgId: string | null,
  recordIds: string[],
  source: string,
  filters: WidgetFilter[],
  available: AvailableField[],
  catalog: SourceDef[],
  opts?: { extraPairs?: { selfId: string; partnerId: string }[] }
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (recordIds.length === 0) return counts;
  const selfIds = new Set(recordIds);

  // 1) Pares conectados envolvendo os cards (qualquer direção). Os pares
  // extras (gêmeo) entram como linhas sintéticas ANTES da carga dos parceiros
  // — mesmo caminho de validação; o dedupe de par absorve a sobreposição.
  type MatchRow = { record_a_id: string; record_b_id: string };
  const matches: MatchRow[] = (
    await Promise.all(
      chunksOf(recordIds).map(async (slice) => {
        const { data } = await db
          .from("record_matches")
          .select("record_a_id, record_b_id")
          .or(
            `record_a_id.in.(${slice.join(",")}),record_b_id.in.(${slice.join(",")})`
          );
        return (data ?? []) as MatchRow[];
      })
    )
  ).flat();
  for (const p of opts?.extraPairs ?? []) {
    if (!selfIds.has(p.selfId) || !p.partnerId) continue;
    matches.push({ record_a_id: p.selfId, record_b_id: p.partnerId });
  }
  if (matches.length === 0) return counts;

  // 2) Parceiros da base pedida (record_type da pai; sub recorta em memória).
  const partnerIds = new Set<string>();
  for (const m of matches) {
    partnerIds.add(m.record_a_id);
    partnerIds.add(m.record_b_id);
  }
  const recordType = recordTypeOf(source, catalog);
  const partnerById = new Map<string, RecordRow>();
  await Promise.all(
    chunksOf([...partnerIds]).map(async (slice) => {
      let q = db
        .from("records")
        .select(RECORD_COLS)
        .eq("record_type", recordType)
        .in("id", slice);
      if (orgId) q = q.eq("organization_id", orgId);
      const { data } = await q;
      for (const p of (data ?? []) as unknown as RecordRow[]) {
        partnerById.set(p.id, p);
      }
    })
  );

  // 3) Predicado de sub-base + filtros da condição, em memória.
  const predicate = sourcePredicate(source, catalog);
  const passes = (p: RecordRow): boolean =>
    [...predicate, ...filters].every((f) =>
      fieldFilterMatches(f, (ref) => recordRawValue(ref, p, available))
    );

  // 4) Conta por origem, deduplicando o PAR (vínculos por regras diferentes
  // contam uma conexão). Um par com os DOIS lados no quadro conta p/ ambos.
  const seen = new Set<string>();
  for (const m of matches) {
    for (const [self, other] of [
      [m.record_a_id, m.record_b_id],
      [m.record_b_id, m.record_a_id],
    ] as const) {
      if (!selfIds.has(self)) continue;
      if (self === other) continue;
      const pairKey = `${self}:${other}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const partner = partnerById.get(other);
      if (!partner || !passes(partner)) continue;
      counts.set(self, (counts.get(self) ?? 0) + 1);
    }
  }
  return counts;
}
