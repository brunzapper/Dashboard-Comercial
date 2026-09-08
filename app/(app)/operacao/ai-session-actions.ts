// Versão: 1.0 | Data: 07/09/2026
// Server Actions do painel de IA da Operação — wrappers finos dos helpers de
// lib/ai/operacao/session.ts (gate e persistência moram lá; nada de caminho
// paralelo). Módulo "use server" NUNCA re-exporta tipos: o compilador emite
// `export type` como re-export de VALOR e derruba TODAS as actions da página
// em runtime — o painel importa os tipos com `import type` direto do núcleo.
//
// O Aplicar lê o JSON DO BANCO (nada bruto viaja do cliente) e confere o alvo
// contra o que a UI tem selecionado: a linha é por ESCOPO, então uma prévia
// gerada com o domínio X não pode ser aplicada depois que o usuário trocou
// para o Y.
"use server";

import { revalidatePath } from "next/cache";

import {
  gateError,
  gateOperacaoAi,
  loadRow,
  runOperacaoAiTurnCore,
  saveRow,
  stateFrom,
  type OperacaoAiState,
} from "@/lib/ai/operacao/session";

export async function loadOperacaoAiSession(
  scope: string
): Promise<OperacaoAiState> {
  const gate = await gateOperacaoAi(scope);
  if (!gate.ok) return gateError(gate.message);
  const row = await loadRow(gate.supabase, gate.orgId, gate.userId, scope);
  return stateFrom(row, gate.handler.restore != null);
}

export async function runOperacaoAiTurn(
  scope: string,
  target: string,
  message: string
): Promise<OperacaoAiState> {
  return runOperacaoAiTurnCore(scope, target, message);
}

export async function applyOperacaoAiPending(
  scope: string,
  target: string
): Promise<OperacaoAiState> {
  const gate = await gateOperacaoAi(scope);
  if (!gate.ok) return gateError(gate.message);

  const row = await loadRow(gate.supabase, gate.orgId, gate.userId, scope);
  if (!row.pending) return gateError("Não há prévia para aplicar.");

  const alvo = gate.handler.normalizeTarget(target ?? "");
  if (!alvo || alvo !== row.pending.target) {
    return {
      ...stateFrom(row, gate.handler.restore != null),
      ok: false,
      message: `Esta prévia foi gerada para "${row.pending.target}" — volte para ele na tela ou descarte a prévia.`,
    };
  }

  const res = await gate.handler.apply(alvo, row.pending.json);
  const next = { ...row };
  if (res.ok) {
    next.pending = null;
    if (res.snapshot !== undefined) {
      next.undo_snapshot = res.snapshot;
      next.undo_saved_at = new Date().toISOString();
    }
  }
  next.chat = [
    ...row.chat,
    res.ok
      ? { kind: "ok", text: res.message ?? "Aplicado." }
      : {
          kind: "error",
          text: res.message ?? "Falha ao aplicar.",
          errors: res.errors,
        },
  ];

  const saveErr = await saveRow(
    gate.supabase,
    gate.orgId,
    gate.userId,
    scope,
    next
  );
  if (res.ok) revalidatePath(gate.handler.meta.href);
  const state = stateFrom(next, gate.handler.restore != null, res.ok);
  return saveErr
    ? { ...state, message: `Falha ao salvar a sessão: ${saveErr}` }
    : state;
}

export async function discardOperacaoAiPending(
  scope: string
): Promise<OperacaoAiState> {
  const gate = await gateOperacaoAi(scope);
  if (!gate.ok) return gateError(gate.message);
  const row = await loadRow(gate.supabase, gate.orgId, gate.userId, scope);
  const next = { ...row, pending: null };
  const saveErr = await saveRow(
    gate.supabase,
    gate.orgId,
    gate.userId,
    scope,
    next
  );
  const state = stateFrom(next, gate.handler.restore != null);
  return saveErr ? { ...state, message: saveErr } : state;
}

/** Zera a conversa mas PRESERVA o Desfazer (a última aplicação segue valendo). */
export async function resetOperacaoAiSession(
  scope: string
): Promise<OperacaoAiState> {
  const gate = await gateOperacaoAi(scope);
  if (!gate.ok) return gateError(gate.message);
  const row = await loadRow(gate.supabase, gate.orgId, gate.userId, scope);
  const next = { ...row, turns: [], chat: [], pending: null };
  const saveErr = await saveRow(
    gate.supabase,
    gate.orgId,
    gate.userId,
    scope,
    next
  );
  const state = stateFrom(next, gate.handler.restore != null);
  return saveErr ? { ...state, message: saveErr } : state;
}

export async function undoOperacaoAiSession(
  scope: string
): Promise<OperacaoAiState> {
  const gate = await gateOperacaoAi(scope);
  if (!gate.ok) return gateError(gate.message);
  const restore = gate.handler.restore;
  if (!restore) return gateError("Esta área não oferece desfazer.");

  const row = await loadRow(gate.supabase, gate.orgId, gate.userId, scope);
  if (row.undo_snapshot == null) return gateError("Não há o que desfazer.");

  const res = await restore(row.undo_snapshot);
  const next = { ...row };
  if (res.ok) {
    next.undo_snapshot = null;
    next.undo_saved_at = null;
  }
  next.chat = [
    ...row.chat,
    res.ok
      ? { kind: "ok", text: res.message ?? "Desfeito." }
      : { kind: "error", text: res.message ?? "Falha ao desfazer." },
  ];
  const saveErr = await saveRow(
    gate.supabase,
    gate.orgId,
    gate.userId,
    scope,
    next
  );
  if (res.ok) revalidatePath(gate.handler.meta.href);
  const state = stateFrom(next, true, res.ok);
  return saveErr ? { ...state, message: saveErr } : state;
}
