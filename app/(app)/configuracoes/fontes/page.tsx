// Versão: 2.1 | Data: 19/07/2026
// Configurações → Fontes (admin).
// v2.1 (19/07/2026): SUB-FONTES (0078) — seção de sub-fontes (fonte derivada de
//   uma pai, recortada por um filtro). Carrega field_definitions p/ montar as
//   opções de campo do editor de filtro por fonte pai (applies_to).
// v2.0 (16/07/2026): fontes DINÂMICAS — CRUD do catálogo (data_sources):
//   criar/editar/excluir fontes, nome curto por fonte e campo de período;
//   mantém o rótulo dos campos "gerais" (sync_config).
import { createClient } from "@/lib/supabase/server";
import { requireSettingsArea } from "@/lib/auth/access";
import { loadSources } from "@/lib/config/sources";
import { loadSourceLabels } from "@/lib/config/source-labels";
import { fieldAppliesToSource } from "@/lib/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import type { FieldDefinition } from "@/lib/records/types";
import type { ComboboxOption } from "@/components/ui/combobox";
import { SourcesManager } from "@/components/configuracoes/sources-manager";
import { SubSourcesManager } from "@/components/configuracoes/sub-sources-manager";
import { SourceLabelsManager } from "@/components/configuracoes/source-labels-manager";

export default async function FontesPage() {
  await requireSettingsArea("fontes");
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const labels = await loadSourceLabels(supabase, sources);
  const { data: fieldsData } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type, applies_to")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  const fields = (fieldsData ?? []) as FieldDefinition[];

  // Opções de campo do editor de filtro por fonte PAI (raiz): colunas do núcleo
  // + campos personalizados que se aplicam ao record_type da pai.
  const coreOptions: ComboboxOption[] = CORE_FIELDS.map((f) => ({
    value: f.field,
    label: f.label,
  }));
  const fieldOptionsByParent: Record<string, ComboboxOption[]> =
    Object.fromEntries(
      sources
        .filter((s) => !s.parentKey)
        .map((s) => [
          s.key,
          [
            ...coreOptions,
            ...fields
              .filter((f) => fieldAppliesToSource(f.applies_to, s.key, sources))
              .map((f) => ({
                value: `custom:${f.field_key}`,
                label: f.label,
              })),
          ],
        ])
    );

  // Campos personalizados de DATA por pai: opções extras do campo de período
  // da sub-fonte (0082 — 'custom:<key>'; ex.: Data Reunião).
  const dateFieldOptionsByParent: Record<string, ComboboxOption[]> =
    Object.fromEntries(
      sources
        .filter((s) => !s.parentKey)
        .map((s) => [
          s.key,
          fields
            .filter(
              (f) =>
                f.data_type === "data" &&
                fieldAppliesToSource(f.applies_to, s.key, sources)
            )
            .map((f) => ({
              value: `custom:${f.field_key}`,
              label: f.label,
            })),
        ])
    );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Bases</h1>
        <p className="text-muted-foreground text-sm">
          Catálogo das bases de dados do produto: as internas (Bitrix e
          planilha do Estudo) e as personalizadas, criadas aqui ou pelo import
          de CSV em Registros.
        </p>
      </div>
      <SourcesManager sources={sources} />
      <SubSourcesManager
        sources={sources}
        fieldOptionsByParent={fieldOptionsByParent}
        dateFieldOptionsByParent={dateFieldOptionsByParent}
      />
      <div>
        <h2 className="text-lg font-semibold">Rótulos</h2>
        <p className="text-muted-foreground text-sm">
          O nome curto de cada base é editado na própria base, acima.
        </p>
      </div>
      <SourceLabelsManager geral={labels.geral} />
    </div>
  );
}
