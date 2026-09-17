// Versão: 1.1 | Data: 17/09/2026
// v1.1 (17/09/2026): a LINHA da sessão saiu para lib/ai/manual-base-session.ts.
//   Um arquivo "use server" só pode exportar funções async — constantes e
//   helpers síncronos não cabem —, e com as funções de leitura/escrita aqui o
//   núcleo do turno e este arquivo se importavam em círculo.
// As ações da conversa do assistente da BASE MANUAL (0142).
//
// O SERVIDOR é a fonte de verdade: os turnos e a PRÉVIA vivem na linha, e o
// apply lê o JSON DAQUI, nunca de um argumento do cliente. Sem isso, um
// cliente poderia mandar aplicar um JSON que nunca passou por prévia nenhuma.
//
// O TURNO não mora aqui — ele entra pela rota NDJSON
// (app/api/registros/base-manual/ai-turn), porque uma Server Action de dois
// minutos congelaria a fila do cliente inteira e a vítima seria justamente a
// grade que a pessoa está editando ao lado. O que fica em action é o que é
// curto e mutação: abrir o fio, aplicar, colar, descartar.
"use server";

import { revalidatePath } from "next/cache";

import {
  EMPTY_MANUAL_BASE_SESSION,
  manualBaseSessionKey,
  readManualBaseSessionRow,
  toManualBaseSessionState,
  writeManualBaseSessionRow,
  type ManualBaseSessionRow,
  type ManualBaseSessionState,
} from "@/lib/ai/manual-base-session";
import {
  applyManualBaseCore,
  buildManualBasePromptCore,
  previewManualBaseCore,
  type ApplyManualBaseState,
} from "@/lib/ai/manual-base";

/** Estado atual da conversa (abrir o painel). */
export async function loadManualBaseSession(): Promise<ManualBaseSessionState> {
  const k = await manualBaseSessionKey();
  if (!k.ok) return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  return toManualBaseSessionState(await readManualBaseSessionRow(k));
}

/** Colar JSON de IA EXTERNA: mesma prévia, mesmo validador, sem IA. */
export async function pasteManualBaseJson(
  raw: string
): Promise<ManualBaseSessionState> {
  const k = await manualBaseSessionKey();
  if (!k.ok) return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  const row = await readManualBaseSessionRow(k);
  const res = await previewManualBaseCore(raw);
  if (!res.ok || !res.pendingJson) {
    return {
      ...toManualBaseSessionState(row),
      ok: false,
      message: res.message,
      errors: res.errors,
    };
  }
  const next: ManualBaseSessionRow = {
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
  await writeManualBaseSessionRow(k, next);
  return toManualBaseSessionState(next);
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
  const k = await manualBaseSessionKey();
  if (!k.ok) return { ok: false, message: k.message };
  const row = await readManualBaseSessionRow(k);
  if (!row.pending) return { ok: false, message: "Não há prévia para aplicar." };

  const res = await applyManualBaseCore(row.pending.json);
  // Falha PARCIAL mantém a prévia: o usuário vê o que não entrou e decide.
  const tudoAplicado = res.ok && res.appliedCount === res.results?.length;
  const next: ManualBaseSessionRow = {
    turns: row.turns,
    chat: [...row.chat, { role: "assistant", text: res.message ?? "Aplicado." }],
    pending: tudoAplicado ? null : row.pending,
  };
  await writeManualBaseSessionRow(k, next);
  revalidatePath("/registros/base-manual");
  return { ...res, session: toManualBaseSessionState(next) };
}

/** Descarta a prévia sem aplicar. */
export async function discardManualBasePending(): Promise<ManualBaseSessionState> {
  const k = await manualBaseSessionKey();
  if (!k.ok) return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  const row = await readManualBaseSessionRow(k);
  const next: ManualBaseSessionRow = { ...row, pending: null };
  await writeManualBaseSessionRow(k, next);
  return toManualBaseSessionState(next);
}

/** Recomeça a conversa (zera turnos e log; a prévia vai junto). */
export async function resetManualBaseSession(): Promise<ManualBaseSessionState> {
  const k = await manualBaseSessionKey();
  if (!k.ok) return { ...EMPTY_MANUAL_BASE_SESSION, ok: false, message: k.message };
  const next: ManualBaseSessionRow = { turns: [], chat: [], pending: null };
  await writeManualBaseSessionRow(k, next);
  return toManualBaseSessionState(next);
}
