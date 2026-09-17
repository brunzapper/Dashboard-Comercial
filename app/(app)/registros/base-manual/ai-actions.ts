// Versão: 1.0 | Data: 17/09/2026
// A conversa do assistente da BASE MANUAL (0142), persistida em
// `manual_base_ai_sessions` — molde da 0124 (operacao_ai_sessions) e da 0098.
//
// O SERVIDOR é a fonte de verdade: os turnos e a PRÉVIA vivem na linha, e o
// apply lê o JSON DAQUI, nunca de um argumento do cliente. Sem isso, um
// cliente poderia mandar aplicar um JSON que nunca passou por prévia nenhuma.
//
// O TURNO não mora aqui — ele entra pela rota NDJSON
// (app/api/registros/base-manual/ai-turn), porque uma Server Action de dois
// minutos congelaria a fila do cliente inteira e a vítima seria justamente o
// refetch dos widgets que a edição acabou de disparar. O que fica em action é
// o que é curto e mutação: abrir o fio, aplicar, descartar.
"use server";

import { revalidatePath } from "next/cache";

import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  applyManualBaseCore,
  buildManualBasePromptCore,
  previewManualBaseCore,
  type ApplyManualBaseState,
  type ManualBaseGenerateState,
} from "@/lib/ai/manual-base";

/** Uma fala do log exibido (o mesmo shape do AiChatLog dos outros painéis). */
export interface ManualBaseChatEntry {
  role: "user" | "assistant";
  text: string;
}

export interface ManualBaseSessionState {
  ok: boolean;
  message?: string;
  errors?: string[];
  chat: ManualBaseChatEntry[];
  /** Turnos de usuário (o que o laço reinjeta). */
  turns: string[];
  /** Resumo da prévia pendente, em pt-BR. Vazio = nada a aplicar. */
  summary: string[];
  warnings: string[];
  /** A prévia existe? O JSON em si NUNCA sai do servidor. */
  hasPending: boolean;
}

export const EMPTY_MANUAL_BASE_SESSION: ManualBaseSessionState = {
  ok: true,
  chat: [],
  turns: [],
  summary: [],
  warnings: [],
  hasPending: false,
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface SessionRow {
  turns: string[];
  chat: ManualBaseChatEntry[];
  pending: { json: string; summary: string[]; warnings: string[] } | null;
}

async function sessionKey(): Promise<
  { ok: true; supabase: Supabase; orgId: string; userId: string } | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  // Falha ALTO: a org está na PK justamente para a prévia de uma organização
  // nunca aparecer na outra para quem é membro das duas.
  if (!orgId) return { ok: false, message: "Nenhuma organização ativa." };
  return { ok: true, supabase: await createClient(), orgId, userId: session.user.id };
}

const asRow = (data: Record<string, unknown> | null): SessionRow => ({
  turns: Array.isArray(data?.turns) ? (data.turns as string[]) : [],
  chat: Array.isArray(data?.chat) ? (data.chat as ManualBaseChatEntry[]) : [],
  pending: (data?.pending as SessionRow["pending"]) ?? null,
});

const toState = (row: SessionRow): ManualBaseSessionState => ({
  ok: true,
  chat: row.chat,
  turns: row.turns,
  summary: row.pending?.summary ?? [],
  warnings: row.pending?.warnings ?? [],
  hasPending: row.pending != null,
});

/** Estado atual da conversa (abrir o painel). */
export async function loadManualBaseSession(): Promise<ManualBaseSessionState> {
  const k = await sessionKey();
  if (!k.ok) return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  const { data } = await k.supabase
    .from("manual_base_ai_sessions")
    .select("turns, chat, pending")
    .eq("organization_id", k.orgId)
    .eq("user_id", k.userId)
    .maybeSingle();
  return toState(asRow(data as Record<string, unknown> | null));
}

/** Lê a linha inteira — usado pelo núcleo do turno (rota NDJSON). */
export async function readManualBaseSessionRow(): Promise<
  { ok: true; row: SessionRow; orgId: string; userId: string; supabase: Supabase }
  | { ok: false; message: string }
> {
  const k = await sessionKey();
  if (!k.ok) return k;
  const { data } = await k.supabase
    .from("manual_base_ai_sessions")
    .select("turns, chat, pending")
    .eq("organization_id", k.orgId)
    .eq("user_id", k.userId)
    .maybeSingle();
  return {
    ok: true,
    row: asRow(data as Record<string, unknown> | null),
    orgId: k.orgId,
    userId: k.userId,
    supabase: k.supabase,
  };
}

/** Grava a linha (upsert own-row). */
export async function writeManualBaseSessionRow(
  supabase: Supabase,
  orgId: string,
  userId: string,
  row: SessionRow
): Promise<void> {
  await supabase.from("manual_base_ai_sessions").upsert(
    {
      organization_id: orgId,
      user_id: userId,
      turns: row.turns,
      chat: row.chat,
      pending: row.pending,
    },
    { onConflict: "organization_id,user_id" }
  );
}

/** Colar JSON de IA EXTERNA: mesma prévia, mesmo validador, sem IA. */
export async function pasteManualBaseJson(
  raw: string
): Promise<ManualBaseSessionState> {
  const k = await sessionKey();
  if (!k.ok) return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  const res: ManualBaseGenerateState = await previewManualBaseCore(raw);
  const { row } = (await readManualBaseSessionRow()) as { row: SessionRow };
  if (!res.ok || !res.pendingJson) {
    return {
      ...toState(row),
      ok: false,
      message: res.message,
      errors: res.errors,
    };
  }
  const next: SessionRow = {
    turns: row.turns,
    chat: [
      ...row.chat,
      { role: "user", text: "(JSON colado de uma IA externa)" },
      { role: "assistant", text: res.message ?? "Prévia pronta." },
    ],
    pending: {
      json: res.pendingJson,
      summary: res.summary ?? [],
      warnings: res.warnings ?? [],
    },
  };
  await writeManualBaseSessionRow(k.supabase, k.orgId, k.userId, next);
  return toState(next);
}

/** Prompt completo para IA externa (mesmo SPEC do chat + catálogo atual). */
export async function copyManualBasePrompt(): Promise<{
  ok: boolean;
  message?: string;
  prompt?: string;
}> {
  return buildManualBasePromptCore();
}

/** Aplica a prévia — o JSON sai da LINHA, nunca do cliente. */
export async function applyManualBaseSession(): Promise<
  ApplyManualBaseState & { session?: ManualBaseSessionState }
> {
  const k = await sessionKey();
  if (!k.ok) return { ok: false, message: k.message };
  const { row } = (await readManualBaseSessionRow()) as { row: SessionRow };
  if (!row.pending) return { ok: false, message: "Não há prévia para aplicar." };

  const res = await applyManualBaseCore(row.pending.json);
  // Falha PARCIAL mantém a prévia: o usuário vê o que não entrou e decide.
  const next: SessionRow = {
    turns: row.turns,
    chat: [
      ...row.chat,
      { role: "assistant", text: res.message ?? "Aplicado." },
    ],
    pending: res.ok && res.appliedCount === res.results?.length ? null : row.pending,
  };
  await writeManualBaseSessionRow(k.supabase, k.orgId, k.userId, next);
  revalidatePath("/registros/base-manual");
  return { ...res, session: toState(next) };
}

/** Descarta a prévia sem aplicar. */
export async function discardManualBasePending(): Promise<ManualBaseSessionState> {
  const k = await sessionKey();
  if (!k.ok) return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  const { row } = (await readManualBaseSessionRow()) as { row: SessionRow };
  const next: SessionRow = { ...row, pending: null };
  await writeManualBaseSessionRow(k.supabase, k.orgId, k.userId, next);
  return toState(next);
}

/** Recomeça a conversa (zera turnos e log; a prévia vai junto). */
export async function resetManualBaseSession(): Promise<ManualBaseSessionState> {
  const k = await sessionKey();
  if (!k.ok) return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  const next: SessionRow = { turns: [], chat: [], pending: null };
  await writeManualBaseSessionRow(k.supabase, k.orgId, k.userId, next);
  return toState(next);
}
