// Versão: 1.0 | Data: 28/07/2026
// Server Actions das ANOTAÇÕES DO DIA (agenda_notes, 0111) — post-its do
// calendário. Gravação com o client do usuário: a RLS decide (org inteira lê;
// autor OU admin/gestor editam/excluem — attempt-and-fail, a negação volta
// como "Sem permissão"). Tabela RAIZ org-scoped ⇒ carimbo de org AQUI via
// getActiveOrgId() (padrão createTask; sem carimbo, usuário de outra org
// falharia no WITH CHECK). Sem webhooks (anotação é cromo de calendário, não
// entidade de negócio) e sem revalidatePath (a agenda é client-fetched —
// realtime 0111 + event bus cobrem o refresh).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { NOTE_COLORS } from "./types";

export interface AgendaNoteActionState {
  ok?: boolean;
  message?: string;
  id?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BODY_MAX = 2000;

function cleanBody(v: string): string {
  return String(v ?? "")
    .trim()
    .slice(0, BODY_MAX);
}

function cleanColor(v: string | null | undefined): string | null {
  return v && (NOTE_COLORS as readonly string[]).includes(v) ? v : null;
}

/** Cria uma anotação num dia do calendário. */
export async function createAgendaNote(
  dateIso: string,
  body: string,
  color?: string | null
): Promise<AgendaNoteActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!DATE_RE.test(dateIso)) return { ok: false, message: "Data inválida." };
  const text = cleanBody(body);
  if (!text) return { ok: false, message: "Escreva a anotação." };

  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const { data, error } = await supabase
    .from("agenda_notes")
    .insert({
      ...(orgId ? { organization_id: orgId } : {}),
      note_date: dateIso,
      body: text,
      color: cleanColor(color),
      created_by: session.user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Falha ao criar: ${error.message}` };
  return { ok: true, id: data.id as string };
}

/** Edita texto e/ou cor de uma anotação (RLS: autor ou admin/gestor). */
export async function updateAgendaNote(
  id: string,
  patch: { body?: string; color?: string | null }
): Promise<AgendaNoteActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const updates: Record<string, unknown> = {};
  if (patch.body !== undefined) {
    const text = cleanBody(patch.body);
    if (!text) return { ok: false, message: "Escreva a anotação." };
    updates.body = text;
  }
  if (patch.color !== undefined) updates.color = cleanColor(patch.color);
  if (Object.keys(updates).length === 0) return { ok: true };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agenda_notes")
    .update(updates)
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para alterar esta anotação." };
  }
  return { ok: true };
}

/** Move a anotação para outro dia (drag entre células da agenda). */
export async function moveAgendaNote(
  id: string,
  dateIso: string
): Promise<AgendaNoteActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!DATE_RE.test(dateIso)) return { ok: false, message: "Data inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agenda_notes")
    .update({ note_date: dateIso })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para mover esta anotação." };
  }
  return { ok: true };
}

/** Exclui uma anotação (RLS: autor ou admin/gestor). */
export async function deleteAgendaNote(
  id: string
): Promise<AgendaNoteActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agenda_notes")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para excluir esta anotação." };
  }
  return { ok: true };
}
