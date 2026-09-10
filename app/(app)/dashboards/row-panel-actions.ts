// Versão: 1.3 | Data: 10/09/2026
// v1.3 (10/09/2026): só vocabulário — o substantivo da ocorrência
//   da série saiu do código e virou dado (SeriesConfig.noun, e
//   tasks.occurrence_noun por tarefa).
// v1.2 (09/09/2026): a lista de tarefas do painel deixou de ser uma projeção
//   read-only artesanal e passou a ser o `TaskList` canônico (checkbox de
//   concluir, lápis de editar, DueBadge). A nota de "somente leitura" abaixo
//   segue valendo para o DETALHE do registro — reusar o editor de tarefa que o
//   app inteiro usa é o oposto de uma régua paralela; era a projeção de 4
//   campos que impedia qualquer ação.
// v1.1 (09/09/2026): as tarefas do painel são PAGINADAS. Um registro sob
//   série periódica acumula dezenas de tarefas, e trazer 100 de uma vez
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
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import type { OptionItem } from "@/lib/records/types";
import { fieldAppliesToSource } from "@/lib/sources";
import { attributeLabel, type RecordAttribute } from "@/lib/attributes/registry";
import { loadRecordAttributes } from "@/lib/attributes/load";

export interface RowDetailField {
  key: string;
  label: string;
  value: string;
}

/**
 * v1.2: a tarefa INTEIRA. A projeção de 4 campos que existia aqui era o que
 * tornava a lista inerte — sem `phase`, `due_time`, `responsible_id` etc. não
 * há como abrir o editor nem concluir.
 */
export type RowTask = TaskRow;

export interface RowPanelData {
  title: string;
  fields: RowDetailField[];
  tasks: RowTask[];
  attributes: (RecordAttribute & { label: string })[];
  /** Quantas tarefas o registro tem no total (o botão "carregar mais" precisa). */
  taskTotal: number;
  /** Responsáveis ativos — o `TaskFormContext` do editor (v1.2). */
  responsibles: OptionItem[];
  message?: string;
}

export type RowTaskOrder = "asc" | "desc";

const EMPTY: RowPanelData = {
  title: "",
  fields: [],
  tasks: [],
  attributes: [],
  taskTotal: 0,
  responsibles: [],
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
    .select(TASK_COLS_WITH_RECORD, { count: "exact" })
    .eq("record_id", recordId)
    .order("due_date", { ascending: asc, nullsFirst: false })
    .range(offset, offset + ROW_TASKS_PAGE - 1);

  return {
    tasks: (data ?? []) as unknown as RowTask[],
    total: count ?? 0,
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
  // acompanhamento é o que acabou de acontecer, não a tarefa de 2 anos atrás).
  // v1.2: os responsáveis vêm junto — o editor de tarefa precisa da lista.
  const [firstPage, attrRows, { data: resps }] = await Promise.all([
    loadRowTasks(recordId, { offset: 0, order: "desc" }),
    loadRecordAttributes(supabase, recordId),
    supabase
      .from("responsibles")
      .select("id, display_name")
      .is("canonical_id", null)
      .eq("active", true)
      .order("display_name"),
  ]);

  const attributes = attrRows.map((a) => ({
    ...a,
    label: attributeLabel(a.attributeKey),
  }));

  return {
    title: (record.title as string) ?? "",
    fields,
    tasks: firstPage.tasks,
    taskTotal: firstPage.total,
    responsibles: (resps ?? []).map((r) => ({
      id: r.id as string,
      label: (r.display_name as string) ?? "",
    })),
    attributes,
  };
}
