// Versão: 1.1 | Data: 20/07/2026
// Tela de Operações (admin) — Fase 6B.
// v1.1 (20/07/2026): carrega o FILTRO DE PERFIL (operations.filter, 0083) e
// monta as opções de campo (núcleo + custom com rótulo) e de fonte para o
// editor de condições do perfil.
import { createClient } from "@/lib/supabase/server";
import { requireSettingsArea } from "@/lib/auth/access";
import { loadSources } from "@/lib/config/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import type { WidgetFilter } from "@/lib/widgets/types";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  OperationsManager,
  type OperationRow,
} from "@/components/admin/operations-manager";

export default async function OperacoesPage() {
  await requireSettingsArea("operacoes");
  const supabase = await createClient();
  const [{ data }, { data: fieldsData }, sources] = await Promise.all([
    supabase
      .from("operations")
      .select("id, name, active, parent_operation_id, filter")
      .order("name"),
    supabase
      .from("field_definitions")
      .select("field_key, label")
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true }),
    loadSources(supabase),
  ]);

  const operations: OperationRow[] = (data ?? []).map((o) => ({
    id: o.id as string,
    name: o.name as string,
    active: Boolean(o.active),
    parent_operation_id: (o.parent_operation_id as string) ?? null,
    filter: Array.isArray(o.filter) ? (o.filter as WidgetFilter[]) : [],
  }));

  const fieldOptions: ComboboxOption[] = [
    ...CORE_FIELDS.map((f) => ({ value: f.field, label: f.label })),
    ...(fieldsData ?? []).map((f) => ({
      value: `custom:${f.field_key as string}`,
      label: (f.label as string) || (f.field_key as string),
    })),
  ];
  const sourceOptions: ComboboxOption[] = sources.map((s) => ({
    value: s.key,
    label: s.label,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Operações</h1>
        <p className="text-muted-foreground text-sm">
          Crie operações, organize-as em árvore e defina o PERFIL de dados de
          cada uma (filtros de inclusão/exclusão). O filtro de Operação dos
          dashboards aplica os responsáveis vinculados + o perfil.
        </p>
      </div>
      <OperationsManager
        operations={operations}
        fieldOptions={fieldOptions}
        sourceOptions={sourceOptions}
      />
    </div>
  );
}
