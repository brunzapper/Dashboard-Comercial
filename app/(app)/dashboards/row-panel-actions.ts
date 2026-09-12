// Versão: 1.4 | Data: 12/09/2026
// v1.4 (12/09/2026): o DETALHE passou a ser o registro inteiro, e não meia
//   dúzia de campos. Ele filtrava `!isCoreDef(f)` e lia só `custom_fields` —
//   ou seja, derrubava as 18 colunas do NÚCLEO (pipeline, etapa, valor, MRR,
//   responsável, datas…), ignorava campos de outras bases com valor e as
//   chaves órfãs, não formatava nada (String() cru) e ainda escondia os
//   vazios. A montagem agora sai dos MESMOS helpers de /registros
//   (lib/records/detail-fields.ts + lib/export/record-cells.ts): uma régua só
//   para as duas telas. O recorte "só preenchidos × todos" deixou de ser
//   decidido aqui: cada campo vem com `empty` e QUEM DECIDE é o cliente — o
//   interruptor não pode custar uma ida ao servidor.
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
  DETAIL_HEADER_REFS,
  coreDetailRows,
  orphanCustomKeys,
} from "@/lib/records/detail-fields";
import { recordCellValue } from "@/lib/export/record-cells";
import { collectRecordFkLabels } from "@/lib/widgets/fk-labels";
import {
  redactRestrictedFields,
  restrictedFieldKeys,
} from "@/lib/records/field-acl";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { ROW_TASKS_PAGE } from "@/lib/records/row-panel";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/auth/org";
import { loadUserSettings } from "@/lib/config/user-settings";
import { resolveUiPrefs, userUiPrefs } from "@/lib/config/ui-prefs";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import type { OptionItem } from "@/lib/records/types";
import { fieldAppliesToSource } from "@/lib/sources";
import { attributeLabel, type RecordAttribute } from "@/lib/attributes/registry";
import { loadRecordAttributes } from "@/lib/attributes/load";

export interface RowDetailField {
  key: string;
  label: string;
  /** Já FORMATADO (data/moeda/percentual/booleano/FK); vazio vem como "—". */
  value: string;
  /** Sem valor no registro. O cliente decide se exibe (interruptor do painel). */
  empty: boolean;
  /** Seção do painel — a ordem de exibição segue esta. */
  group: "core" | "base" | "outras" | "orfao";
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
  /** Preferência do usuário: já vem resolvida nas 3 camadas (0141). */
  showAllFields: boolean;
  /** A organização travou a personalização dessa escolha. */
  showAllFieldsLocked: boolean;
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
  showAllFields: false,
  showAllFieldsLocked: false,
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

  // As colunas de formatação (moeda/percentual/fórmula) precisam vir: sem elas
  // um valor monetário sairia como número cru, e era assim que o painel
  // aparecia antes.
  const { data: defsData } = await supabase
    .from("field_definitions")
    .select(
      "id, field_key, label, data_type, options, visible_to_roles, applies_to, source_system, sort_order, currency_code, currency_mode, show_as_percent, formula"
    )
    .order("sort_order", { ascending: true });
  const defs = (defsData ?? []) as FieldDefinition[];

  const roles = session.roles as RoleKey[];
  const isAdmin = session.roles.includes("admin");
  const denied = restrictedFieldKeys(defs, roles, isAdmin);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [safe] = redactRestrictedFields([record as any], denied);
  const row = safe as unknown as RecordRow;

  // Rótulos das FKs (responsável/operação/lead) — o núcleo exibe NOME, não id.
  // Mesmo coletor do modo lista: apelido de responsável resolve pelo principal.
  const fkFlat = await collectRecordFkLabels(supabase, [row]);
  const labels = {
    responsibles: fkFlat,
    operations: fkFlat,
    leads: fkFlat,
  };

  const source = (row.record_type as string) ?? "";
  const visible = (f: FieldDefinition) =>
    isAdmin || hasAnyRole(roles, f.visible_to_roles as RoleKey[]);
  const customDefs = defs.filter(
    // `calculado_agg` não tem valor POR REGISTRO (é agregado) — nunca vira
    // linha de detalhe, como em /registros.
    (f) => !isCoreDef(f) && f.data_type !== "calculado_agg"
  );

  const fields: RowDetailField[] = [];

  // 1) Núcleo: as colunas de `records` (título/tipo/base ficam no cabeçalho).
  //    Rótulo e ordem saem das linhas core do /campos (0086) quando existem.
  for (const { ref, label } of coreDetailRows(
    row,
    defs.filter(isCoreDef),
    DETAIL_HEADER_REFS
  )) {
    const value = recordCellValue(row, ref, defs, labels);
    fields.push({ key: ref, label, value, empty: value === "—", group: "core" });
  }

  // 2) Campos da BASE do registro (mesmo sem valor — o vazio é informação:
  //    "existe e não está preenchido"), e 3) campos de OUTRAS bases só quando
  //    o registro tem valor neles (espelho do catálogo de /registros).
  for (const f of customDefs) {
    if (!visible(f)) continue;
    const ref = `custom:${f.field_key}`;
    const value = recordCellValue(row, ref, defs, labels);
    const isEmpty = value === "—";
    const applies = fieldAppliesToSource(f.applies_to, source);
    if (!applies && isEmpty) continue;
    fields.push({
      key: ref,
      label: f.label ?? f.field_key,
      value,
      empty: isEmpty,
      group: applies ? "base" : "outras",
    });
  }

  // 4) Chaves de custom_fields com valor e SEM definição alguma. knownKeys vai
  //    PRÉ-ACL de propósito: campo restrito por papel TEM definição e não pode
  //    vazar por aqui como "órfão".
  const knownKeys = defs.filter((f) => !isCoreDef(f)).map((f) => f.field_key);
  for (const key of orphanCustomKeys(row.custom_fields, knownKeys)) {
    fields.push({
      key: `custom:${key}`,
      label: key,
      value: String(row.custom_fields?.[key] ?? ""),
      empty: false,
      group: "orfao",
    });
  }

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

  // Preferência de exibição junto do payload: o painel é montado fundo na
  // árvore do dashboard, e descer a preferência por props atravessaria meia
  // dúzia de componentes que não têm nada com isso.
  const prefs = resolveUiPrefs(
    userUiPrefs(await loadUserSettings(session.user.id)),
    (await getActiveOrg())?.uiPrefs
  );

  return {
    title: (row.title as string) ?? "",
    fields,
    showAllFields: prefs.values.recordPanelAllFields,
    showAllFieldsLocked: prefs.locked.has("recordPanelAllFields"),
    tasks: firstPage.tasks,
    taskTotal: firstPage.total,
    responsibles: (resps ?? []).map((r) => ({
      id: r.id as string,
      label: (r.display_name as string) ?? "",
    })),
    attributes,
  };
}
