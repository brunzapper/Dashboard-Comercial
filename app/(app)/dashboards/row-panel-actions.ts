// Versão: 1.0 | Data: 09/09/2026
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
  message?: string;
}

const EMPTY: RowPanelData = { title: "", fields: [], tasks: [], attributes: [] };

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

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, due_date, completed_at, series_occurrence")
    .eq("record_id", recordId)
    .order("due_date", { ascending: true })
    .limit(100);

  const attributes = (await loadRecordAttributes(supabase, recordId)).map((a) => ({
    ...a,
    label: attributeLabel(a.attributeKey),
  }));

  return {
    title: (record.title as string) ?? "",
    fields,
    tasks: (tasks ?? []).map((t) => ({
      id: t.id as string,
      title: (t.title as string) ?? "",
      dueDate: (t.due_date as string | null) ?? null,
      done: t.completed_at != null,
      occurrence: (t.series_occurrence as number | null) ?? null,
    })),
    attributes,
  };
}
