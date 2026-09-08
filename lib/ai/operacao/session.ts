// Versão: 1.0 | Data: 07/09/2026
// NÚCLEO da sessão do painel de IA da Operação — gêmeo de lib/ai/edit-session.ts
// (gate, leitura/gravação da linha de `operacao_ai_sessions` e o corpo do
// TURNO). Extraído desde o início para que a rota de streaming e as server
// actions rodem o MESMO turno: server action não aceita função como argumento
// (o `onThought` do raciocínio ao vivo), e um segundo caminho de gate ou de
// persistência seria a porta para os dois divergirem.
//
// Diferença estrutural para a 0098: a linha é por (org, usuário, ESCOPO) e a
// org é carimbada AQUI — não há dashboard-pai de onde derivar, e a coluna tem
// default da org legada. Por isso `getActiveOrgId()` nulo FALHA ALTO: esta
// linha guarda `pending` (payload de escrita) e `undo_snapshot`.
import "server-only";

import { getSessionInfo } from "@/lib/auth/session";
import { checkSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { handlerFor, type OperacaoAiHandler } from "./handlers";
// Import só de TIPO (apagado no build — nada de módulo client no bundle server).
import type { AiChatEntry } from "@/components/dashboards/ai-chat-log";

export interface OperacaoAiState {
  ok: boolean;
  message?: string;
  chat: AiChatEntry[];
  /** Presença = há prévia aguardando Aplicar. */
  pendingSummary?: string[];
  /** Alvo (domínio/plano) a que a prévia pendente pertence. */
  pendingTarget?: string;
  hasUndo: boolean;
  /** True quando o turno/Aplicar/Desfazer mudou dados (cliente dá refresh). */
  applied?: boolean;
}

// Mesmos caps da 0098: só os últimos 10 turnos chegam ao modelo (o laço já
// corta); guardamos mais para o histórico de exibição.
const TURNS_STORED_CAP = 30;
const CHAT_STORED_CAP = 100;

export interface PendingProposal {
  target: string;
  json: string;
  summary: string[];
}

export interface OperacaoSessionRow {
  turns: string[];
  chat: AiChatEntry[];
  pending: PendingProposal | null;
  undo_snapshot: unknown | null;
  undo_saved_at: string | null;
}

const EMPTY_ROW: OperacaoSessionRow = {
  turns: [],
  chat: [],
  pending: null,
  undo_snapshot: null,
  undo_saved_at: null,
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type OperacaoAiGate =
  | {
      ok: true;
      supabase: Supabase;
      userId: string;
      orgId: string;
      handler: OperacaoAiHandler;
    }
  | { ok: false; message: string };

/**
 * Gate do escopo. Ordem: sessão → escopo existe → área liberada (o
 * `checkSettingsArea` já embute a precedência feature-off > deny > allow >
 * papel) → papel de escrita → org ativa. O handler REPETE o gate dele a cada
 * chamada com contexto fresco; este aqui é o do painel.
 */
export async function gateOperacaoAi(scope: string): Promise<OperacaoAiGate> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const handler = handlerFor(scope);
  if (!handler) return { ok: false, message: "Área sem assistente de IA." };

  if (!(await checkSettingsArea(handler.meta.key))) {
    return { ok: false, message: "Você não tem acesso a esta área." };
  }
  // A área `remuneracao` não tem gate de papel (a page ramifica para "Minha
  // remuneração"): sem esta checagem, um vendedor veria um painel de ESCRITA
  // que o servidor recusaria a cada turno.
  if (handler.meta.adminOnly && !session.roles.includes("admin")) {
    return {
      ok: false,
      message: "Apenas administradores podem alterar esta área por IA.",
    };
  }

  const orgId = await getActiveOrgId();
  if (!orgId) {
    // Falha ALTA de propósito: a linha guarda payload de escrita, e a coluna
    // tem default da org legada — carimbar errado aqui seria vazamento.
    return { ok: false, message: "Organização ativa não identificada." };
  }

  const supabase = await createClient();
  return { ok: true, supabase, userId: session.user.id, orgId, handler };
}

export async function loadRow(
  supabase: Supabase,
  orgId: string,
  userId: string,
  scope: string
): Promise<OperacaoSessionRow> {
  const { data } = await supabase
    .from("operacao_ai_sessions")
    .select("turns, chat, pending, undo_snapshot, undo_saved_at")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("scope", scope)
    .maybeSingle();
  if (!data) return EMPTY_ROW;
  return {
    turns: (data.turns as string[] | null) ?? [],
    chat: (data.chat as AiChatEntry[] | null) ?? [],
    pending: (data.pending as PendingProposal | null) ?? null,
    undo_snapshot: data.undo_snapshot ?? null,
    undo_saved_at: (data.undo_saved_at as string | null) ?? null,
  };
}

export async function saveRow(
  supabase: Supabase,
  orgId: string,
  userId: string,
  scope: string,
  row: OperacaoSessionRow
): Promise<string | null> {
  const { error } = await supabase.from("operacao_ai_sessions").upsert(
    {
      organization_id: orgId,
      user_id: userId,
      scope,
      turns: row.turns.slice(-TURNS_STORED_CAP),
      chat: row.chat.slice(-CHAT_STORED_CAP),
      pending: row.pending,
      undo_snapshot: row.undo_snapshot,
      undo_saved_at: row.undo_saved_at,
    },
    { onConflict: "organization_id,user_id,scope" }
  );
  return error ? error.message : null;
}

export function stateFrom(
  row: OperacaoSessionRow,
  hasUndoSupport: boolean,
  applied?: boolean
): OperacaoAiState {
  return {
    ok: true,
    chat: row.chat,
    pendingSummary: row.pending?.summary,
    pendingTarget: row.pending?.target,
    hasUndo: hasUndoSupport && row.undo_snapshot != null,
    ...(applied !== undefined ? { applied } : {}),
  };
}

export function gateError(message: string): OperacaoAiState {
  return { ok: false, message, chat: [], hasUndo: false };
}

/**
 * Um turno da conversa: manda a mensagem nova + os turnos DO BANCO ao handler
 * do escopo e persiste o resultado. O turno entra em `turns` mesmo quando
 * falha (o contexto do usuário não se perde por erro do modelo — igual à
 * 0098).
 */
export async function runOperacaoAiTurnCore(
  scope: string,
  target: string,
  message: string
): Promise<OperacaoAiState> {
  const gate = await gateOperacaoAi(scope);
  if (!gate.ok) return gateError(gate.message);

  const alvo = gate.handler.normalizeTarget(target ?? "");
  if (!alvo) {
    return gateError(
      "Escolha na tela sobre o que a conversa é (o item selecionado) antes de pedir algo."
    );
  }
  const text = (message ?? "").trim();
  if (!text) return gateError("Descreva o que você quer.");

  const row = await loadRow(gate.supabase, gate.orgId, gate.userId, scope);

  // A prévia pendente só volta ao modelo quando é do MESMO alvo: reinjetar a
  // proposta de outro domínio/plano faria a IA "ajustar" o que o usuário nem
  // está vendo.
  const pendingJson =
    row.pending && row.pending.target === alvo ? row.pending.json : undefined;

  const res = await gate.handler.turn({
    target: alvo,
    description: text,
    priorTurns: row.turns,
    pendingJson,
  });

  const next: OperacaoSessionRow = {
    ...row,
    turns: [...row.turns, text],
    chat: [...row.chat, { kind: "user", text }],
  };

  if (res.ok && res.json) {
    next.pending = { target: alvo, json: res.json, summary: res.summary ?? [] };
    next.chat.push({
      kind: "ok",
      text: res.message ?? "Prévia pronta — revise e clique em Aplicar.",
      summary: [
        ...(res.summary ?? []),
        ...(res.warnings ?? []).map((w) => `Aviso: ${w}`),
      ],
    });
  } else {
    next.chat.push({
      kind: "error",
      text: res.message ?? "Falha na geração.",
      errors: res.errors,
    });
  }

  const saveErr = await saveRow(
    gate.supabase,
    gate.orgId,
    gate.userId,
    scope,
    next
  );
  const state = stateFrom(next, gate.handler.restore != null);
  return saveErr
    ? { ...state, message: `Falha ao salvar a sessão: ${saveErr}` }
    : state;
}
