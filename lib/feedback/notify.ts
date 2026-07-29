// Versão: 1.0 | Data: 29/07/2026
// Helper ÚNICO de feedback para gravações fora de formulário: envolve a
// promise de uma server action e emite toast SÓ na falha (sucesso permanece
// silencioso — política do docs/arquitetura.md §4.10). Cobre os três formatos
// de retorno existentes: ActionState { ok?, message? } (dashboards/actions),
// { ok: boolean; message? } (kanban/configurações) e Promise<void>.
// Rejeição (rede/exceção) nunca é relançada: resolve `undefined` e avisa.
"use client";

import { toast } from "sonner";

type ActionLike = { ok?: boolean; message?: string } | void | null | undefined;

const CONNECTION_MESSAGE = "Falha de conexão. Tente novamente.";

/** Toast de erro padronizado (contexto no título, detalhe na descrição). */
export function notifyActionError(context: string, message?: string | null) {
  toast.error(context, message ? { description: message } : undefined);
}

/**
 * Aguarda a action e toasta na falha. `context` descreve a ação em pt-BR
 * (ex.: "Não foi possível salvar o layout"). Retorna o resultado da action,
 * ou `undefined` quando a promise rejeitou — o chamador decide se reverte
 * estado otimista checando `res?.ok === false || res === undefined`.
 */
export async function notifyOnError<T extends ActionLike>(
  promise: Promise<T>,
  context: string
): Promise<T | undefined> {
  try {
    const res = await promise;
    if (res && typeof res === "object" && res.ok === false) {
      notifyActionError(context, res.message);
    }
    return res;
  } catch {
    notifyActionError(context, CONNECTION_MESSAGE);
    return undefined;
  }
}
