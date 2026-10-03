// Versão: 1.1 | Data: 03/10/2026
// v1.1 (03/10/2026): `complete` nos contadores — o portão de mudança do tick
//   (0151, lib/ticks/gate.ts) só pula os minutos seguintes depois de uma
//   rodada que viu TODOS os rituais (sem corte de deadline/teto e sem falha de
//   inserção que não seja o 23505 da trava).
// Executor dos RITUAIS automáticos (0149) — o modo opt-in `payload.auto` do nó
// de ritual da Tree. Roda no tick das automações (a cada minuto, no orçamento
// que sobrar).
//
// Molde do executor de séries e de `lib/mappings/notify.ts`: service role com
// org EXPLÍCITA em toda consulta (o tick não tem sessão), autoria = quem criou
// o nó, webhook `task.created` à mão. A trava é o índice único
// `uq_tasks_ritual_occurrence (ritual_node_id, ritual_occurrence)`: repetir é
// 23505, que é NO-OP — nunca erro. A ocorrência é DERIVADA do calendário
// (cadence.ts), então tick perdido não dessincroniza nada, e nunca se cria
// ocorrência retroativa.
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  buildResponsibleNameIndex,
  responsibleIdForName,
  type ResponsibleNameRow,
} from "@/lib/config/responsible-names";
import { parseRitualPayload } from "@/lib/tree/payload";
import { ritualOccurrencesToOpen } from "./cadence";

/** Teto de rituais por rodada (sobra para o próximo tick). */
const MAX_RITUALS_PER_RUN = 200;

export interface RitualRunCounters {
  rituals: number;
  created: number;
  skipped: number;
  /** v1.1: todos os rituais avaliados, sem corte nem falha transitória. */
  complete: boolean;
}

export async function runTreeRituals(
  db: SupabaseClient,
  deadline: number,
  now: Date = new Date()
): Promise<RitualRunCounters> {
  const out: RitualRunCounters = {
    rituals: 0,
    created: 0,
    skipped: 0,
    complete: true,
  };
  const { data: rows, error } = await db
    .from("tree_nodes")
    .select("id, organization_id, scope_id, label, payload, created_by")
    .eq("kind", "ritual")
    .eq("scope_kind", "livre")
    .is("node_ref", null)
    .filter("payload->>auto", "eq", "true")
    .order("updated_at", { ascending: true })
    .limit(MAX_RITUALS_PER_RUN);
  if (error) return { ...out, complete: false };
  if (!rows || rows.length === 0) return out;
  // v1.1: bateu no teto ⇒ pode haver ritual além dele.
  if (rows.length >= MAX_RITUALS_PER_RUN) out.complete = false;

  const today = todayBrasiliaIso(now);
  const orgCache = new Map<
    string,
    { holidays: Set<string>; names: ReturnType<typeof buildResponsibleNameIndex> }
  >();
  const orgData = async (orgId: string) => {
    const hit = orgCache.get(orgId);
    if (hit) return hit;
    const [{ data: days }, { data: resps }] = await Promise.all([
      db.from("non_working_days").select("day").eq("organization_id", orgId),
      db
        .from("responsibles")
        .select("id, display_name, canonical_id")
        .eq("organization_id", orgId),
    ]);
    const value = {
      holidays: new Set(
        ((days ?? []) as { day: string }[]).map((d) => String(d.day).slice(0, 10))
      ),
      names: buildResponsibleNameIndex((resps ?? []) as ResponsibleNameRow[]),
    };
    orgCache.set(orgId, value);
    return value;
  };

  for (const row of rows as {
    id: string;
    organization_id: string;
    scope_id: string;
    label: string | null;
    payload: unknown;
    created_by: string | null;
  }[]) {
    if (Date.now() > deadline) {
      out.complete = false;
      break;
    }
    const payload = parseRitualPayload(row.payload);
    if (!payload?.auto) continue;
    out.rituals += 1;
    const { holidays, names } = await orgData(row.organization_id);
    const { data: occ } = await db
      .from("tasks")
      .select("ritual_occurrence")
      .eq("organization_id", row.organization_id)
      .eq("ritual_node_id", row.id)
      .not("ritual_occurrence", "is", null);
    const existing = new Set(
      ((occ ?? []) as { ritual_occurrence: number }[]).map((o) => o.ritual_occurrence)
    );
    const toOpen = ritualOccurrencesToOpen(
      payload.schedule,
      today,
      existing,
      payload.lookahead ?? 1,
      holidays
    );
    const responsibleId = responsibleIdForName(names, payload.responsible);
    for (const o of toOpen) {
      const title = (row.label ?? "").trim() || "Ritual";
      const { data: task, error: insErr } = await db
        .from("tasks")
        .insert({
          organization_id: row.organization_id,
          title,
          description: payload.reading ?? null,
          due_date: o.date,
          responsible_id: responsibleId,
          created_by: row.created_by,
          position: -Date.now(),
          phase: "a_fazer",
          ritual_node_id: row.id,
          ritual_occurrence: o.n,
        })
        .select("id")
        .single();
      if (insErr || !task) {
        // 23505 = esta ocorrência já existe (corrida com o botão) — no-op.
        out.skipped += 1;
        // v1.1: outra falha é transitória — o próximo tick tenta de novo.
        if (insErr?.code !== "23505") out.complete = false;
        continue;
      }
      out.created += 1;
      // Pendura no ritual (mapa livre); repetir é no-op (uq_tree_nodes_map_task).
      await db.from("tree_nodes").insert({
        organization_id: row.organization_id,
        scope_kind: "livre",
        scope_id: row.scope_id,
        kind: "task",
        ref_id: task.id,
        parent_ref: `note:${row.id}`,
        created_by: row.created_by,
      });
      await emitWebhookEvent(
        "task.created",
        { taskId: task.id as string, title, recordId: null },
        row.organization_id
      );
    }
  }
  return out;
}
