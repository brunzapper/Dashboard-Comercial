// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): as tarefas do painel são PAGINADAS. Um registro sob
//   cobrança periódica acumula dezenas de tarefas, e trazer 100 de uma vez
//   (sem "carregar mais") entregava uma parede e ainda assim escondia o
//   resto. Agora vem uma página e a contagem total; `loadRowTasks` traz as
//   seguintes na direção da ordem escolhida.
// O que o CLIQUE numa linha da tabela abre: o detalhe do registro, as tarefas
// dele, ou a lista de atributos (as funcionalidades penduradas nele).
//
// O detalhe é SOMENTE LEITURA de propósito: o pedido é "abrir o detalhamento,
// com todos os campos" — ver, não editar. Editar continua tendo o lugar dele
// (/registros), com o formulário inteiro e as guardas de escrita; um segundo
// editor no dashboard seria a régua paralela que a invariante 25 proíbe.
//
// A peneira de ACL é obrigatória: `records.custom_fields` é UMA coluna jsonb, a
// RLS não esconde uma CHAVE dela, e escolher o que RENDERIZAR esconderia o dado
// da tela mas não do payload. Mesmo caminho da agenda (`redactRestrictedFields`).
"use server";

import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { getSessionInfo } from "@/lib/auth/session";
import { isCoreDef } from "@/lib/records/core-defs";
import {
  redactRestrictedFields,
  restrictedFieldKeys,
} from "@/lib/records/field-acl";
import type { FieldDefinition } from "@/lib/records/types";
import { ROW_TASKS_PAGE } from "@/lib/records/row-panel";
import { createClient } from "@/lib/supabase/server";
import { fieldAppliesToSource } from "@/lib/sources";
import { attributeLabel, type RecordAttribute } from "@/lib/attributes/registry";
import { loadRecordAttributes } from "@/lib/attributes/load";

export interface RowDetailField {
  key: string;
  label: string;
  value: string;
}

export interface RowTask {
  id: string;
  title: string;
  dueDate: string | null;
  done: boolean;
  /** Cobrança da série (N) ou null para tarefa manual. */
  occurrence: number | null;
}

export interface RowPanelData {
  title: string;
  fields: RowDetailField[];
  tasks: RowTask[];
  attributes: (RecordAttribute & { label: string })[];
  /** Quantas tarefas o registro tem no total (o botão "carregar mais" precisa). */
  taskTotal: number;
  message?: string;
}

export type RowTaskOrder = "asc" | "desc";

const EMPTY: RowPanelData = {
  title: "",
  fields: [],
  tasks: [],
  attributes: [],
  taskTotal: 0,
};

/**
 * Uma página de tarefas do registro. Sem prazo vai para o FIM nas duas ordens
 * (`nullsFirst: false`): tarefa sem data não é "a mais antiga" nem "a mais
 * recente" — ela simplesmente não está na linha do tempo.
 */
export async function loadRowTasks(
  recordId: string,
  opts: { offset?: number; order?: RowTaskOrder } = {}
): Promise<{ tasks: RowTask[]; total: number }> {
  const session = await getSessionInfo();
  if (!session) return { tasks: [], total: 0 };
  const supabase = await createClient();
  const offset = Math.max(0, opts.offset ?? 0);
  const asc = (opts.order ?? "desc") === "asc";

  const { data, count } = await supabase
    .from("tasks")
    .select("id, title, due_date, completed_at, series_occurrence", {
      count: "exact",
    })
    .eq("record_id", recordId)
    .order("due_date", { ascending: asc, nullsFirst: false })
    .range(offset, offset + ROW_TASKS_PAGE - 1);

  return { tasks: (data ?? []).map(toRowTask), total: count ?? 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRowTask(t: any): RowTask {
  return {
    id: t.id as string,
    title: (t.title as string) ?? "",
    dueDate: (t.due_date as string | null) ?? null,
    done: t.completed_at != null,
    occurrence: (t.series_occurrence as number | null) ?? null,
  };
}

/** Tudo que o painel do clique mostra, numa ida só. */
export async function loadRowPanel(recordId: string): Promise<RowPanelData> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, message: "Sessão expirada." };
  const supabase = await createClient();

  const { data: record } = await supabase
    .from("records")
    .select("*")
    .eq("id", recordId)
    .maybeSingle();
  // Não distinguimos "não existe" de "você não pode ver": a RLS já decidiu, e
  // a mensagem é a mesma dos dois lados de propósito.
  if (!record) return { ...EMPTY, message: "Registro não encontrado." };

  const { data: defsData } = await supabase
    .from("field_definitions")
    .select(
      "id, field_key, label, data_type, options, visible_to_roles, applies_to, source_system, sort_order"
    )
    .order("sort_order", { ascending: true });
  const defs = (defsData ?? []) as FieldDefinition[];

  const roles = session.roles as RoleKey[];
  const isAdmin = session.roles.includes("admin");
  const denied = restrictedFieldKeys(defs, roles, isAdmin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [safe] = redactRestrictedFields([record as any], denied);

  const source = (record.record_type as string) ?? "";
  const custom = (safe.custom_fields ?? {}) as Record<string, unknown>;
  const fields: RowDetailField[] = defs
    .filter(
      (f) =>
        !isCoreDef(f) &&
        fieldAppliesToSource(f.applies_to, source) &&
        (isAdmin || hasAnyRole(roles, f.visible_to_roles as RoleKey[]))
    )
    .map((f) => ({
      key: f.field_key,
      label: f.label ?? f.field_key,
      value: custom[f.field_key] == null ? "" : String(custom[f.field_key]),
    }))
    // Campo vazio não vira linha: o detalhe é para LER, e uma parede de
    // rótulos sem valor esconde o que tem valor.
    .filter((f) => f.value !== "");

  // Primeira página: mais recentes primeiro (o que se quer ver ao abrir um
  // acompanhamento é o que acabou de acontecer, não a cobrança de 2 anos atrás).
  const firstPage = await loadRowTasks(recordId, { offset: 0, order: "desc" });

  const attributes = (await loadRecordAttributes(supabase, recordId)).map((a) => ({
    ...a,
    label: attributeLabel(a.attributeKey),
  }));

  return {
    title: (record.title as string) ?? "",
    fields,
    tasks: firstPage.tasks,
    taskTotal: firstPage.total,
    attributes,
  };
}
