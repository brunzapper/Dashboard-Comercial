// Versão: 1.0 | Data: 17/09/2026
// A LINHA da conversa do assistente da Base manual (`manual_base_ai_sessions`,
// 0142) — leitura, escrita e projeção para a tela.
//
// Vive aqui, e não no arquivo de actions, por duas razões concretas:
//
//  1. Um arquivo "use server" só pode exportar funções async. Constantes,
//     tipos-valor e helpers síncronos (como a projeção) não cabem lá.
//  2. O núcleo do turno (lib/ai/manual-base.ts) precisa das MESMAS funções que
//     as actions usam. Com elas no arquivo de actions, os dois módulos se
//     importariam em círculo.
//
// O JSON da prévia NUNCA sai deste servidor: a projeção devolve só o resumo em
// pt-BR e o sinalizador `hasPending`. É o que impede um cliente de mandar
// aplicar um JSON que nunca passou por prévia nenhuma.
import "server-only";

import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Uma fala do log exibido (mesmo shape do AiChatLog dos outros painéis). */
export interface ManualBaseChatEntry {
  role: "user" | "assistant";
  text: string;
}

export interface ManualBasePending {
  json: string;
  summary: string[];
  warnings: string[];
}

export interface ManualBaseSessionRow {
  turns: string[];
  chat: ManualBaseChatEntry[];
  pending: ManualBasePending | null;
}

export interface ManualBaseSessionState {
  ok: boolean;
  message?: string;
  errors?: string[];
  chat: ManualBaseChatEntry[];
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

/** Tetos do que fica guardado: o laço reinjeta os turnos, e o log é só
 *  exibição. Precedente dos demais painéis. */
export const MANUAL_BASE_MAX_TURNS = 10;
export const MANUAL_BASE_MAX_CHAT = 40;

export const asManualBaseRow = (
  data: Record<string, unknown> | null
): ManualBaseSessionRow => ({
  turns: Array.isArray(data?.turns) ? (data.turns as string[]) : [],
  chat: Array.isArray(data?.chat) ? (data.chat as ManualBaseChatEntry[]) : [],
  pending: (data?.pending as ManualBasePending | null) ?? null,
});

export const toManualBaseSessionState = (
  row: ManualBaseSessionRow
): ManualBaseSessionState => ({
  ok: true,
  chat: row.chat,
  turns: row.turns,
  summary: row.pending?.summary ?? [],
  warnings: row.pending?.warnings ?? [],
  hasPending: row.pending != null,
});

export type ManualBaseSessionKey =
  | { ok: true; supabase: Supabase; orgId: string; userId: string }
  | { ok: false; message: string };

export async function manualBaseSessionKey(): Promise<ManualBaseSessionKey> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  // Falha ALTO: a org está na PK justamente para a prévia de uma organização
  // nunca aparecer na outra para quem é membro das duas (precedente 0124).
  if (!orgId) return { ok: false, message: "Nenhuma organização ativa." };
  return {
    ok: true,
    supabase: await createClient(),
    orgId,
    userId: session.user.id,
  };
}

export async function readManualBaseSessionRow(
  k: Extract<ManualBaseSessionKey, { ok: true }>
): Promise<ManualBaseSessionRow> {
  const { data } = await k.supabase
    .from("manual_base_ai_sessions")
    .select("turns, chat, pending")
    .eq("organization_id", k.orgId)
    .eq("user_id", k.userId)
    .maybeSingle();
  return asManualBaseRow(data as Record<string, unknown> | null);
}

export async function writeManualBaseSessionRow(
  k: Extract<ManualBaseSessionKey, { ok: true }>,
  row: ManualBaseSessionRow
): Promise<void> {
  await k.supabase.from("manual_base_ai_sessions").upsert(
    {
      organization_id: k.orgId,
      user_id: k.userId,
      turns: row.turns,
      chat: row.chat,
      pending: row.pending,
    },
    { onConflict: "organization_id,user_id" }
  );
}
