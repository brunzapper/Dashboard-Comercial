// Versão: 1.2 | Data: 31/07/2026
// Tela de Operações (admin) — Fase 6B.
// v1.2 (31/07/2026): assistente "Gerir com IA" (OperationsAiSheet — chat
// interno + fluxo copiar-prompt/colar-JSON de IA externa; maxDuration 300
// p/ os turnos de geração; contrato/apply em lib/ai/manage-operations.ts).
// v1.1 (20/07/2026): carrega o FILTRO DE PERFIL (operations.filter, 0083) e
// monta as opções de campo (núcleo + custom com rótulo) e de fonte para o
// editor de condições do perfil.
import { createClient } from "@/lib/supabase/server";
import { requireSettingsArea } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadOrgAiConfigPublic } from "@/lib/ai/config";
import { loadSources } from "@/lib/config/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import type { WidgetFilter } from "@/lib/widgets/types";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  OperationsManager,
  type OperationRow,
} from "@/components/admin/operations-manager";
import { OperationsAiSheet } from "@/components/admin/operations-ai-sheet";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Operações" };

// Turno de geração da IA pode passar do limite default de execução.
export const maxDuration = 300;

export default async function OperacoesPage() {
  await requireSettingsArea("operacoes");
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const ai = orgId ? await loadOrgAiConfigPublic(orgId) : null;
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operações</h1>
          <p className="text-muted-foreground text-sm">
            Crie operações, organize-as em árvore e defina o PERFIL de dados de
            cada uma (filtros de inclusão/exclusão). O filtro de Operação dos
            dashboards aplica os responsáveis vinculados + o perfil.
          </p>
        </div>
        <OperationsAiSheet ai={ai} />
      </div>
      <OperationsManager
        operations={operations}
        fieldOptions={fieldOptions}
        sourceOptions={sourceOptions}
      />
    </div>
  );
}
