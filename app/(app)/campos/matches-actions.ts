// Versão: 1.0 | Data: 12/07/2026
// Fase 2: Server Actions do matching entre fontes. CRUD de match_rules + rodar o
// auto-match + conexão/desconexão manual de registros (record_matches). Gravação
// com o client do usuário — a RLS exige manage_field_definitions. Regras e
// matches são GLOBAIS.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isSourceKey, toRecordType, toSourceKey } from "@/lib/sources";
import { runAutoMatch } from "@/lib/records/matching-engine";
import { recalcAllFormulaFields } from "@/lib/records/recalc";

export interface MatchActionState {
  ok?: boolean;
  message?: string;
}

async function ensureCanManage(): Promise<string | null> {
  const session = await getSessionInfo();
  if (!session) return "Sessão expirada.";
  if (!session.permissions.includes("manage_field_definitions")) {
    return "Apenas administradores podem gerenciar conexões entre fontes.";
  }
  return null;
}

// record_type a partir de uma SourceKey enviada pelo form.
function recordTypeFromForm(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return isSourceKey(v) ? toRecordType(v) : null;
}

function readRule(formData: FormData): {
  values?: {
    label: string;
    source_a: string;
    source_b: string;
    field_a_1: string;
    field_b_1: string;
    field_a_2: string | null;
    field_b_2: string | null;
    enabled: boolean;
    priority: number;
  };
  error?: string;
} {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { error: "Informe o rótulo." };
  const source_a = recordTypeFromForm(formData, "source_a");
  const source_b = recordTypeFromForm(formData, "source_b");
  if (!source_a || !source_b) return { error: "Escolha as duas fontes." };
  if (source_a === source_b) return { error: "As fontes devem ser diferentes." };
  const field_a_1 = String(formData.get("field_a_1") ?? "").trim();
  const field_b_1 = String(formData.get("field_b_1") ?? "").trim();
  if (!field_a_1 || !field_b_1) {
    return { error: "Defina o primeiro par de campos (um de cada fonte)." };
  }
  const fa2 = String(formData.get("field_a_2") ?? "").trim();
  const fb2 = String(formData.get("field_b_2") ?? "").trim();
  // Par 2 só vale se AMBOS os lados forem informados.
  const bothPair2 = Boolean(fa2 && fb2);
  return {
    values: {
      label,
      source_a,
      source_b,
      field_a_1,
      field_b_1,
      field_a_2: bothPair2 ? fa2 : null,
      field_b_2: bothPair2 ? fb2 : null,
      enabled: String(formData.get("enabled") ?? "on") !== "off",
      priority: Number(formData.get("priority") ?? 0) || 0,
    },
  };
}

export async function createMatchRule(
  _prev: MatchActionState,
  formData: FormData
): Promise<MatchActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  const { values, error } = readRule(formData);
  if (error) return { ok: false, message: error };

  const supabase = await createClient();
  const { data: created, error: insErr } = await supabase
    .from("match_rules")
    .insert(values!)
    .select("id")
    .maybeSingle();
  if (insErr) return { ok: false, message: insErr.message };

  // Popula os matches da regra recém-criada (best-effort).
  let matched = 0;
  try {
    const res = await runAutoMatch(supabase, created?.id as string | undefined);
    matched = res.inserted;
    // Refaz lead_time_days e campos calculados com match:<fonte> (best-effort).
    await recalcAllFormulaFields();
  } catch {
    /* ignora: a regra foi salva; o botão "Rodar auto-match" refaz. */
  }
  revalidatePath("/campos");
  return {
    ok: true,
    message: `Regra "${values!.label}" criada. ${matched} conexão(ões) gravada(s).`,
  };
}

export async function updateMatchRule(
  _prev: MatchActionState,
  formData: FormData
): Promise<MatchActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Regra não identificada." };
  const { values, error } = readRule(formData);
  if (error) return { ok: false, message: error };

  const supabase = await createClient();
  const { error: updErr } = await supabase
    .from("match_rules")
    .update(values!)
    .eq("id", id);
  if (updErr) return { ok: false, message: updErr.message };

  let matched = 0;
  try {
    const res = await runAutoMatch(supabase, id);
    matched = res.inserted;
    // Refaz lead_time_days e campos calculados com match:<fonte> (best-effort).
    await recalcAllFormulaFields();
  } catch {
    /* ignora */
  }
  revalidatePath("/campos");
  return {
    ok: true,
    message: `Regra "${values!.label}" atualizada. ${matched} nova(s) conexão(ões).`,
  };
}

export async function deleteMatchRule(formData: FormData): Promise<void> {
  const err = await ensureCanManage();
  if (err) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  // Os matches auto ficam com rule_id = null (ON DELETE SET NULL); não apagamos
  // os matches para não perder o que já foi curado manualmente.
  await supabase.from("match_rules").delete().eq("id", id);
  revalidatePath("/campos");
}

export async function runAutoMatchAction(
  _prev: MatchActionState,
  _formData: FormData
): Promise<MatchActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  try {
    const res = await runAutoMatch(supabase);
    await recalcAllFormulaFields(); // lead_time + campos com match:<fonte>
    revalidatePath("/campos");
    revalidatePath("/registros");
    return {
      ok: true,
      message: `Auto-match: ${res.rulesRun} regra(s), ${res.inserted} conexão(ões) gravada(s).`,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---- Conexão/desconexão MANUAL (usadas na ficha do registro) ----

/** Busca registros de uma fonte por título (para conectar manualmente). */
export async function searchRecordsForMatch(
  source: string,
  term: string
): Promise<{ id: string; title: string }[]> {
  if (!isSourceKey(source)) return [];
  const supabase = await createClient();
  const rt = toRecordType(source);
  let q = supabase
    .from("records")
    .select("id, title")
    .eq("record_type", rt)
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .limit(20);
  const t = term.trim();
  if (t) q = q.ilike("title", `%${t.replace(/[,()]/g, " ")}%`);
  const { data } = await q;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    title: (r.title as string) ?? "—",
  }));
}

export interface MatchListItem {
  matchId: string;
  source: string; // SourceKey do registro conectado
  recordId: string;
  title: string;
  mode: "auto" | "manual";
}

/** Lista as conexões de um registro (para exibir/remover na ficha). */
export async function listRecordMatches(
  recordId: string
): Promise<MatchListItem[]> {
  if (!recordId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("record_matches")
    .select("id, record_a_id, record_b_id, mode")
    .or(`record_a_id.eq.${recordId},record_b_id.eq.${recordId}`);
  const rows = data ?? [];
  const partnerId = (m: { record_a_id: string; record_b_id: string }) =>
    m.record_a_id === recordId ? m.record_b_id : m.record_a_id;
  const ids = rows.map((m) => partnerId(m as never));
  if (ids.length === 0) return [];
  const { data: parts } = await supabase
    .from("records")
    .select("id, title, record_type")
    .in("id", ids);
  const byId = new Map(
    (parts ?? []).map((p) => [
      p.id as string,
      { title: (p.title as string) ?? "—", rt: p.record_type as string },
    ])
  );
  return rows.map((m) => {
    const pid = partnerId(m as never);
    const info = byId.get(pid);
    return {
      matchId: m.id as string,
      recordId: pid,
      title: info?.title ?? "—",
      source: info ? toSourceKey(info.rt) : "",
      mode: m.mode as "auto" | "manual",
    };
  });
}

/** Conecta dois registros manualmente (mode='manual'). */
export async function connectRecords(
  recordAId: string,
  recordBId: string
): Promise<MatchActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  if (!recordAId || !recordBId || recordAId === recordBId) {
    return { ok: false, message: "Selecione um registro diferente para conectar." };
  }
  const supabase = await createClient();
  // Evita duplicar o par invertido (unique cobre só a mesma ordem).
  const { data: existing } = await supabase
    .from("record_matches")
    .select("id")
    .or(
      `and(record_a_id.eq.${recordAId},record_b_id.eq.${recordBId}),and(record_a_id.eq.${recordBId},record_b_id.eq.${recordAId})`
    )
    .maybeSingle();
  if (existing?.id) {
    return { ok: true, message: "Esses registros já estão conectados." };
  }
  const { error } = await supabase.from("record_matches").insert({
    record_a_id: recordAId,
    record_b_id: recordBId,
    mode: "manual",
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/registros");
  return { ok: true, message: "Registros conectados." };
}

/** Remove uma conexão (auto ou manual) pelo id do match. */
export async function disconnectRecords(
  matchId: string
): Promise<MatchActionState> {
  const err = await ensureCanManage();
  if (err) return { ok: false, message: err };
  if (!matchId) return { ok: false, message: "Conexão não identificada." };
  const supabase = await createClient();
  const { error } = await supabase.from("record_matches").delete().eq("id", matchId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/registros");
  return { ok: true, message: "Conexão removida." };
}
