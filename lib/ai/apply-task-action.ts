// Versão: 1.1 | Data: 11/09/2026
// v1.1 (11/09/2026): `adiar_sequencia`. Ela é a única ação do contrato que NÃO
// mexe numa tarefa — vai por `snoozeRecordSeries`, que é o mesmo par de metades
// que o diálogo da árvore já usa para encerrar uma sequência. Um caminho
// próprio aqui (apagar + gravar a exceção à mão) seria a régua paralela da
// invariante 25, e é justamente o par de metades que é fácil errar pela metade.
// APLICAR uma ação do contrato `tarefas-edit` — extraído de
// `lib/ai/manage-tasks.ts` quando o "Salvar e analisar" da Tree passou a
// propor editar/concluir/excluir além de criar.
//
// Por que extrair em vez de repetir: este arquivo guarda DUAS armadilhas que
// custaram caro e que uma segunda cópia reencontraria uma a uma.
//
//  1. `updateTask` monta o UPDATE a partir do FormData INTEIRO — chave ausente
//     vira NULL. Editar só a data com um form parcial apagaria descrição,
//     responsável e o VÍNCULO COM O REGISTRO. Por isso o apply parte da LINHA
//     ATUAL e sobrepõe o delta.
//  2. A fase é choke point PRÓPRIO (`moveTaskPhase`); o `updateTask` não a
//     toca. Mudar `phase` no form não move nada.
//
// Nada de escrita nova aqui: cada ação vai pelo choke point que já é dono dela
// (`createTask`/`updateTask`/`moveTaskPhase`/`completeTask`/`deleteTask`), com
// o client RLS do usuário — a muralha é a RLS de `tasks` (0063).
import "server-only";

import {
  completeTask,
  createTask,
  deleteTask,
  moveTaskPhase,
  snoozeRecordSeries,
  updateTask,
} from "@/lib/tasks/actions";
import type { ParsedTaskAction } from "@/lib/import/tasks/types";

/** A linha crua da tarefa — o apply de `editar` precisa dela inteira. */
export interface TaskFullRow {
  id: string;
  title: string;
  description: string | null;
  record_id: string | null;
  board_id: string | null;
  phase: string;
  due_date: string | null;
  due_time: string | null;
  due_time_end: string | null;
  responsible_id: string | null;
  completed_at: string | null;
}

/** Converte o par hora/hora_fim já validado para os campos do form. */
export function timeFields(
  atual: { due_time: string | null; due_time_end: string | null },
  a: { hora?: string | null; hora_fim?: string | null }
): { hora: string; horaFim: string } {
  const hora = a.hora !== undefined ? (a.hora ?? "") : (atual.due_time ?? "");
  // Sem hora inicial não pode haver final (CHECK 0111) — limpar a hora limpa
  // as duas, como faz o form da tela.
  if (!hora) return { hora: "", horaFim: "" };
  const horaFim =
    a.hora_fim !== undefined ? (a.hora_fim ?? "") : (atual.due_time_end ?? "");
  return { hora: hora.slice(0, 5), horaFim: horaFim ? horaFim.slice(0, 5) : "" };
}

export interface ApplyTaskActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Aplica UMA ação. Devolve o resultado do item — falha aqui nunca aborta o
 * lote: o chamador reporta por item, e reenviar às cegas duplicaria.
 *
 * `recordId` é o vínculo do `criar`, e vem SEMPRE do chamador (a UI), nunca do
 * JSON: o contrato `tarefas-edit` não carrega registro de propósito. Ausente =
 * tarefa solta, que é o comportamento de /operacao/tarefas.
 */
export async function applyTaskAction(
  a: ParsedTaskAction,
  opts: { rowById: Map<string, TaskFullRow>; recordId?: string }
): Promise<ApplyTaskActionResult> {
  if (a.acao === "adiar_sequencia") {
    // As duas metades (apagar as abertas antes do dia + gravar a volta) moram
    // no choke point; aqui só se escolhe o registro, que vem do ARGUMENTO.
    if (!opts.recordId) {
      return { ok: false, message: "Sem registro em contexto para adiar." };
    }
    const res = await snoozeRecordSeries(a.serie.key, opts.recordId, a.ate, {
      revalidate: false,
    });
    return res.ok
      ? { ok: true }
      : { ok: false, message: res.message ?? "Falha ao adiar a sequência." };
  }

  if (a.acao === "concluir") {
    const res = await completeTask(a.alvo.id);
    return res.ok ? { ok: true } : { ok: false, message: res.message ?? "Falha ao concluir." };
  }

  if (a.acao === "excluir") {
    // O `deleteTask` já lê o `bitrix_activity_id` ANTES do delete e enfileira
    // o espelho DEPOIS de a RLS deixar passar (0137) — nada a fazer aqui.
    const res = await deleteTask(a.alvo.id);
    return res.ok ? { ok: true } : { ok: false, message: res.message ?? "Falha ao excluir." };
  }

  if (a.acao === "criar") {
    const { hora, horaFim } = timeFields({ due_time: null, due_time_end: null }, a);
    const fd = new FormData();
    fd.set("title", a.titulo);
    if (opts.recordId) fd.set("record_id", opts.recordId);
    if (a.descricao) fd.set("description", a.descricao);
    if (a.data) fd.set("due_date", a.data);
    if (hora) fd.set("due_time", hora);
    if (horaFim) fd.set("due_time_end", horaFim);
    if (a.responsavel) fd.set("responsible_id", a.responsavel.id);
    if (a.quadro) fd.set("board_id", a.quadro.id);
    if (a.fase) fd.set("phase", a.fase.key);
    const res = await createTask({}, fd);
    return res.ok ? { ok: true } : { ok: false, message: res.message ?? "Falha ao criar." };
  }

  // ---- editar (armadilhas 1 e 2 do cabeçalho).
  const atual = opts.rowById.get(a.alvo.id);
  if (!atual) return { ok: false, message: "A tarefa não existe mais." };

  const { hora, horaFim } = timeFields(atual, a);
  const fd = new FormData();
  fd.set("id", atual.id);
  fd.set("title", a.novoTitulo ?? atual.title);
  const descricao = a.descricao !== undefined ? a.descricao : atual.description;
  if (descricao) fd.set("description", descricao);
  const data = a.data !== undefined ? a.data : atual.due_date;
  if (data) fd.set("due_date", data);
  if (hora) fd.set("due_time", hora);
  if (horaFim) fd.set("due_time_end", horaFim);
  const respId =
    a.responsavel !== undefined
      ? (a.responsavel?.id ?? null)
      : atual.responsible_id;
  if (respId) fd.set("responsible_id", respId);
  // Vínculo com registro: preservado SEMPRE (o contrato não o edita).
  if (atual.record_id) fd.set("record_id", atual.record_id);

  const res = await updateTask({}, fd);
  if (!res.ok) return { ok: false, message: res.message ?? "Falha ao salvar." };

  if (a.fase && a.fase.key !== atual.phase) {
    const mv = await moveTaskPhase(atual.id, a.fase.key, a.fase.completes);
    if (!mv.ok) {
      return {
        ok: false,
        message: `Tarefa salva, mas a fase falhou: ${mv.message ?? ""}`.trim(),
      };
    }
  }
  return { ok: true };
}

/** A frase de UMA ação, para a prévia. Dono único do texto do resumo. */
export function summaryOfTaskAction(a: ParsedTaskAction): string {
  if (a.acao === "adiar_sequencia")
    return `adiar a sequência "${a.serie.label}" até ${a.ate}`;
  // A data do alvo entra na frase quando foi ela que desempatou: com três
  // ocorrências de mesmo título, "concluir · Acompanhar deal" não diz qual.
  const quando = (alvo: { data?: string | null }): string =>
    alvo.data === undefined ? "" : alvo.data ? ` (${alvo.data})` : " (sem prazo)";
  if (a.acao === "concluir")
    return `concluir · "${a.alvo.titulo}"${quando(a.alvo)}`;
  if (a.acao === "excluir") return `excluir · "${a.alvo.titulo}"${quando(a.alvo)}`;
  const parts: string[] = [];
  if (a.acao === "criar") {
    parts.push(`criar · "${a.titulo}"`);
    if (a.quadro) parts.push(`quadro: ${a.quadro.nome}`);
  } else {
    parts.push(`editar · "${a.alvo.titulo}"${quando(a.alvo)}`);
    if (a.novoTitulo) parts.push(`renomear p/ "${a.novoTitulo}"`);
  }
  if (a.responsavel !== undefined)
    parts.push(a.responsavel ? `responsável: ${a.responsavel.nome}` : "sem responsável");
  if (a.data !== undefined) parts.push(a.data ? `data: ${a.data}` : "sem prazo");
  if (a.hora !== undefined && a.hora)
    parts.push(a.hora_fim ? `${a.hora}–${a.hora_fim}` : `às ${a.hora}`);
  if (a.fase) parts.push(`fase: ${a.fase.label}`);
  if (a.descricao !== undefined)
    parts.push(a.descricao === null ? "limpar descrição" : "com descrição");
  return parts.join(" · ");
}

/** O título que identifica a ação no resultado por item. */
export const tituloOfTaskAction = (a: ParsedTaskAction): string =>
  a.acao === "criar"
    ? a.titulo
    : a.acao === "adiar_sequencia"
      ? a.serie.label
      : a.alvo.titulo;
