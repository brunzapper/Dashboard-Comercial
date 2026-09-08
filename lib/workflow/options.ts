// Versão: 1.0 | Data: 08/09/2026
// Carga das OPÇÕES dos campos `selecao` de um esquema de Workflow (0125).
//
// Regra do subsistema: opção sai do que o sistema JÁ COMPUTOU — nenhuma
// chamada ao CRM na renderização do formulário. As origens do Bitrix e as
// etapas de lead são materializadas nas `options` do catálogo de campos pelo
// syncFieldCatalog (lib/sync/bitrix/catalog.ts); os responsáveis saem da
// mesma leitura de lib/config/responsible-options.ts (ativos PRINCIPAIS,
// canonical_id null — apelidos colapsam, invariante 20).
//
// Consequência aceita e visível: lista vazia significa "o sync ainda não rodou
// desde que este campo passou a existir", e a UI diz isso — melhor que um
// dropdown inventado a partir dos valores que por acaso apareceram nos
// registros.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkflowDefinition, WorkflowOptionsSource } from "./types";

export type WorkflowOptionsMap = Record<string, string[]>;

/** field_key do catálogo que materializa cada origem. */
const CATALOG_FIELD_BY_SOURCE: Partial<
  Record<WorkflowOptionsSource, { fieldKey: string; core: boolean }>
> = {
  // Campo curado do sync (custom): options = lookups.sourceNames().
  "bitrix:sources": { fieldKey: "fonte", core: false },
  // Linha CORE da 0086: options = lookups.statusNames('lead') desde 08/09/2026.
  "bitrix:lead_status": { fieldKey: "stage", core: true },
};

async function loadCatalogOptions(
  db: SupabaseClient,
  orgId: string | null,
  fieldKey: string,
  core: boolean
): Promise<string[]> {
  let query = db
    .from("field_definitions")
    .select("field_key, options, source_system")
    .eq("field_key", fieldKey);
  if (orgId) query = query.eq("organization_id", orgId);
  const { data, error } = await query;
  if (error || !data) return [];
  // Linha core (0086) e campo custom podem coexistir com o mesmo field_key em
  // catálogos antigos — escolhe explicitamente o lado pedido, nunca o primeiro.
  const row = data.find((r) =>
    core ? r.source_system === "core" : r.source_system !== "core"
  );
  const opts = row?.options;
  if (!Array.isArray(opts)) return [];
  return opts.filter((o): o is string => typeof o === "string" && o !== "");
}

async function loadResponsibleOptions(
  db: SupabaseClient,
  orgId: string | null
): Promise<string[]> {
  let query = db
    .from("responsibles")
    .select("display_name")
    .eq("active", true)
    .is("canonical_id", null);
  if (orgId) query = query.eq("organization_id", orgId);
  const { data, error } = await query;
  if (error || !data) return [];
  const names = new Set<string>();
  for (const r of data) {
    const name = ((r.display_name as string | null) ?? "").trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Opções por CHAVE DE CAMPO do esquema (não por origem): o formulário só
 * precisa de `options[field.key]`, e um campo `static` já traz a lista dele.
 * Cada origem é consultada UMA vez, mesmo com vários campos apontando p/ ela.
 */
export async function loadWorkflowOptions(
  db: SupabaseClient,
  orgId: string | null,
  def: WorkflowDefinition
): Promise<WorkflowOptionsMap> {
  const needed = new Set<WorkflowOptionsSource>();
  for (const f of def.form.fields) {
    if (f.optionsSource && f.optionsSource !== "static") needed.add(f.optionsSource);
  }

  const bySource = new Map<WorkflowOptionsSource, string[]>();
  await Promise.all(
    [...needed].map(async (source) => {
      if (source === "responsibles") {
        bySource.set(source, await loadResponsibleOptions(db, orgId));
        return;
      }
      const catalog = CATALOG_FIELD_BY_SOURCE[source];
      if (!catalog) {
        bySource.set(source, []);
        return;
      }
      bySource.set(
        source,
        await loadCatalogOptions(db, orgId, catalog.fieldKey, catalog.core)
      );
    })
  );

  const out: WorkflowOptionsMap = {};
  for (const f of def.form.fields) {
    if (!f.optionsSource) continue;
    out[f.key] =
      f.optionsSource === "static"
        ? (f.options ?? [])
        : (bySource.get(f.optionsSource) ?? []);
  }
  return out;
}
