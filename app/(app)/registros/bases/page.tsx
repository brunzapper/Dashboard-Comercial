// Versão: 2.4 | Data: 28/07/2026
// Registros → Bases (admin).
// v2.4 (28/07/2026): campo de período por BASE aceita campo custom de DATA
//   (0110) e o picker (bases E subs) oferece "só colunas com dados": probe
//   PostgREST não-mock (lib/config/period-field-probe.ts) + montagem pura
//   (lib/source-date-fields.ts); fallback core p/ base sem linhas; valor salvo
//   sempre presente. Fix: select de field_definitions ganha source_system e os
//   overrides core (0086) saem dos pickers (isCoreDef — filtro em JS).
// v2.3 (27/07/2026): página movida de /configuracoes/fontes para
//   /registros/bases (config vive no ambiente dela). A CHAVE de área segue
//   "fontes" (histórica — overrides gravados em user_access_overrides).
// v2.2 (26/07/2026): PASTAS (0107) — seção de pastas de bases (agrupamento de
//   exibição + ordem manual) acima do catálogo; o formulário da base ganha o
//   campo "Pasta".
// v2.1 (19/07/2026): SUB-FONTES (0078) — seção de sub-fontes (fonte derivada de
//   uma pai, recortada por um filtro). Carrega field_definitions p/ montar as
//   opções de campo do editor de filtro por fonte pai (applies_to).
// v2.0 (16/07/2026): fontes DINÂMICAS — CRUD do catálogo (data_sources):
//   criar/editar/excluir fontes, nome curto por fonte e campo de período;
//   mantém o rótulo dos campos "gerais" (sync_config).
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { requireSettingsArea } from "@/lib/auth/access";
import { Button } from "@/components/ui/button";
import { loadSources } from "@/lib/config/sources";
import { loadSourceFolders } from "@/lib/config/source-folders";
import { loadSourceLabels } from "@/lib/config/source-labels";
import { probeFilledPeriodFields } from "@/lib/config/period-field-probe";
import { isCoreDef } from "@/lib/records/core-defs";
import {
  buildCustomDateFieldOptions,
  buildPeriodFieldOptions,
  ensurePeriodOption,
} from "@/lib/source-date-fields";
import { fieldAppliesToSource } from "@/lib/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import type { FieldDefinition } from "@/lib/records/types";
import type { ComboboxOption } from "@/components/ui/combobox";
import { SourceFoldersManager } from "@/components/configuracoes/source-folders-manager";
import { SourcesManager } from "@/components/configuracoes/sources-manager";
import { SubSourcesManager } from "@/components/configuracoes/sub-sources-manager";
import { SourceLabelsManager } from "@/components/configuracoes/source-labels-manager";
import {
  AutoOperationsManager,
  type AutoOperationsConfigRow,
} from "@/components/configuracoes/auto-operations-manager";

export default async function FontesPage() {
  await requireSettingsArea("fontes");
  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const folders = await loadSourceFolders(supabase);
  const labels = await loadSourceLabels(supabase, sources);
  const { data: fieldsData } = await supabase
    .from("field_definitions")
    .select("field_key, label, data_type, applies_to, source_system")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  const fields = (fieldsData ?? []) as FieldDefinition[];

  // Opções de campo do editor de filtro por fonte PAI (raiz): colunas do núcleo
  // + campos personalizados que se aplicam ao record_type da pai. Overrides
  // core (0086) ficam de fora — a coluna já entra por coreOptions e
  // `custom:<coluna core>` resolveria custom_fields->>'...', sempre null.
  const roots = sources.filter((s) => !s.parentKey);
  const coreOptions: ComboboxOption[] = CORE_FIELDS.map((f) => ({
    value: f.field,
    label: f.label,
  }));
  const fieldOptionsByParent: Record<string, ComboboxOption[]> =
    Object.fromEntries(
      roots.map((s) => [
        s.key,
        [
          ...coreOptions,
          ...fields
            .filter(
              (f) =>
                !isCoreDef(f) &&
                fieldAppliesToSource(f.applies_to, s.key, sources)
            )
            .map((f) => ({
              value: `custom:${f.field_key}`,
              label: f.label,
            })),
        ],
      ])
    );

  // Sub-operações automáticas (0106): configs + opções de operação-pai.
  const [{ data: autoOpData }, { data: opsData }] = await Promise.all([
    supabase
      .from("source_auto_operations")
      .select(
        "source_key, parent_operation_id, name_field, value_field, target_field, target_sources, profile_op, enabled"
      )
      .order("source_key", { ascending: true }),
    supabase
      .from("operations")
      .select("id, name")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);
  const autoOpConfigs = (autoOpData ?? []) as AutoOperationsConfigRow[];
  const operationOptions: ComboboxOption[] = (opsData ?? []).map((o) => ({
    value: o.id as string,
    label: o.name as string,
  }));

  // Campo de período por base (0082/0110): candidatos custom de DATA por pai
  // (rótulos + probe) → lista "só colunas com dados" do picker (bases e subs).
  const customDateOptionsByParent: Record<string, ComboboxOption[]> =
    Object.fromEntries(
      roots.map((s) => [s.key, buildCustomDateFieldOptions(fields, s.key, sources)])
    );
  // Probe não-mock por base (Promise.all entre bases; página admin, custo ok).
  const probes = Object.fromEntries(
    await Promise.all(
      roots.map(
        async (s) =>
          [
            s.key,
            await probeFilledPeriodFields(
              supabase,
              s.recordType,
              customDateOptionsByParent[s.key].map((o) =>
                o.value.slice("custom:".length)
              )
            ),
          ] as const
      )
    )
  );
  // Lista filtrada por pai (picker das subs — o valor salvo DA SUB é injetado
  // client-side no componente, pois o mapa é por pai).
  const periodOptionsByParent: Record<string, ComboboxOption[]> =
    Object.fromEntries(
      roots.map((s) => [
        s.key,
        buildPeriodFieldOptions({
          customOptions: customDateOptionsByParent[s.key],
          hasRows: probes[s.key].hasRows,
          filled: probes[s.key].filled,
        }),
      ])
    );
  // Por base: mesma lista + o valor salvo DA base sempre presente.
  const periodOptionsBySource: Record<string, ComboboxOption[]> =
    Object.fromEntries(
      roots.map((s) => [
        s.key,
        ensurePeriodOption(
          periodOptionsByParent[s.key],
          s.defaultPeriodField,
          customDateOptionsByParent[s.key]
        ),
      ])
    );

  return (
    <div className="flex flex-col gap-8">
      {/* pr-8: afasta o botão do sino fixo (TaskBell, topo-direito) */}
      <div className="flex items-start justify-between gap-4 pr-8">
        <div>
          <h1 className="text-2xl font-semibold">Bases</h1>
          <p className="text-muted-foreground text-sm">
            Catálogo das bases de dados do produto: as internas (Bitrix e
            planilha do Estudo) e as personalizadas, criadas aqui ou pelo import
            de CSV em Registros.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/registros">Voltar a Registros</Link>
        </Button>
      </div>
      <SourceFoldersManager folders={folders} sources={sources} />
      <SourcesManager
        sources={sources}
        folders={folders}
        periodOptionsBySource={periodOptionsBySource}
      />
      <SubSourcesManager
        sources={sources}
        fieldOptionsByParent={fieldOptionsByParent}
        dateFieldOptionsByParent={customDateOptionsByParent}
        periodOptionsByParent={periodOptionsByParent}
      />
      <AutoOperationsManager
        sources={sources}
        configs={autoOpConfigs}
        operationOptions={operationOptions}
        fieldOptionsByParent={fieldOptionsByParent}
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
