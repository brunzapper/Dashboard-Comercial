// Versão: 1.2 | Data: 09/07/2026
// Campos personalizados (field_definitions). Só admin (manage_field_definitions).
// v1.1 (05/07/2026): implementado o CRUD (Fase 4) — antes era placeholder.
// v1.2 (09/07/2026): Fase 8 — seção de Correspondências de colunas (globais).
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition } from "@/lib/records/types";
import { loadCorrespondences } from "@/lib/correspondences";
import { loadMatchRules } from "@/lib/matching";
import { currencyOptionsFrom, loadEnabledCurrencies } from "@/lib/widgets/currency";
import {
  SOURCE_KEYS,
  fieldAppliesToSource,
  type SourceKey,
} from "@/lib/sources";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { FieldsManager } from "@/components/campos/fields-manager";
import {
  CorrespondencesManager,
  type RefOption,
} from "@/components/campos/correspondences-manager";
import { MatchesManager } from "@/components/campos/matches-manager";

export default async function CamposPage() {
  await requirePermission("manage_field_definitions");

  const supabase = await createClient();
  const [{ data }, correspondences, matchRules, currencies] = await Promise.all([
    supabase
      .from("field_definitions")
      .select(
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, source_system, source_field_id, show_in_builder, formula, currency_code, currency_mode, sort_order, applies_to, write_back"
      )
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true }),
    loadCorrespondences(supabase),
    loadMatchRules(supabase),
    loadEnabledCurrencies(supabase),
  ]);

  const fields = (data ?? []) as FieldDefinition[];
  const currencyOptions = currencyOptionsFrom(currencies);

  // Candidatos por fonte p/ correspondências: colunas do núcleo + campos
  // personalizados que se aplicam àquela fonte (applies_to).
  const coreOptions: RefOption[] = CORE_FIELDS.map((f) => ({
    ref: f.field,
    label: f.label,
  }));
  const candidatesBySource = Object.fromEntries(
    SOURCE_KEYS.map((key) => [
      key,
      [
        ...coreOptions,
        ...fields
          .filter((f) => fieldAppliesToSource(f.applies_to, key))
          .map((f) => ({ ref: `custom:${f.field_key}`, label: f.label })),
      ],
    ])
  ) as Record<SourceKey, RefOption[]>;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Campos</h1>
          <p className="text-muted-foreground text-sm">
            Crie colunas personalizadas (texto, número, moeda, data, seleção,
            booleano ou calculado) e defina quem vê e quem edita cada uma. As
            colunas descobertas no Bitrix aparecem aqui automaticamente; use o
            botão &quot;Exibir&quot; para escolher quais vão para os seletores.
          </p>
        </div>
        <FieldsManager fields={fields} currencyOptions={currencyOptions} />
      </div>

      <CorrespondencesManager
        correspondences={correspondences}
        candidatesBySource={candidatesBySource}
      />

      <MatchesManager rules={matchRules} candidatesBySource={candidatesBySource} />
    </div>
  );
}
