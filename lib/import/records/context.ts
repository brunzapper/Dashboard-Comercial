// Versão: 1.0 | Data: 30/07/2026
// Contexto server-side da inserção de registros por IA: monta o catálogo de
// campos ACEITOS de uma base manual com o MESMO gating do createRecord
// (lib/records/actions.ts) — customs editáveis pelo papel × applies_to, sem
// calculados, linhas core (0086) como override de rótulo/options da coluna
// crua — mais responsáveis/operações ativos (resolução de nome). Consultas com
// o client RLS do usuário (org/visibilidade de graça).
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { EDITABLE_CORE_COLUMNS } from "@/lib/config/core-writeback";
import { loadSources } from "@/lib/config/sources";
import { fieldAppliesToSource, type SourceDef } from "@/lib/sources";
import { isCoreDef } from "@/lib/records/core-defs";
import type { DataType } from "@/lib/records/types";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import type {
  EntryFieldSpec,
  RecordsEntryContext,
} from "@/lib/import/records/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const CORE_LABELS = new Map(CORE_FIELDS.map((f) => [f.field, f.label]));

interface DefRow {
  field_key: string;
  label: string | null;
  data_type: DataType;
  options: string[] | null;
  editable_by_roles: string[] | null;
  applies_to: string[] | null;
  source_system: string | null;
  sort_order: number | null;
}

export type RecordsEntryContextResult =
  | { ok: true; ctx: RecordsEntryContext; sourceDef: SourceDef }
  | { ok: false; message: string };

export async function loadRecordsEntryContext(
  supabase: Supabase,
  sourceKey: string,
  roles: string[]
): Promise<RecordsEntryContextResult> {
  const sources = await loadSources(supabase);
  const sourceDef = sources.find((s) => s.key === sourceKey && !s.parentKey);
  if (!sourceDef) return { ok: false, message: "Base inválida." };
  if (!sourceDef.manualEntry) {
    return {
      ok: false,
      message: "Esta base não aceita criação manual de registros.",
    };
  }

  const [{ data: defsData }, { data: respData }, { data: opsData }] =
    await Promise.all([
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, options, editable_by_roles, applies_to, source_system, sort_order"
        )
        .order("sort_order", { ascending: true }),
      supabase
        .from("responsibles")
        .select("id, display_name")
        .eq("active", true)
        .order("display_name"),
      supabase.from("operations").select("id, name").eq("active", true).order("name"),
    ]);
  const defs = (defsData ?? []) as DefRow[];
  const coreOverrides = new Map(
    defs.filter((d) => isCoreDef(d)).map((d) => [d.field_key, d])
  );

  const responsibles = ((respData ?? []) as { id: string; display_name: string | null }[])
    .map((r) => ({ id: r.id, name: r.display_name ?? "" }))
    .filter((r) => r.name.trim() !== "");
  const operations = ((opsData ?? []) as { id: string; name: string | null }[])
    .map((o) => ({ id: o.id, name: o.name ?? "" }))
    .filter((o) => o.name.trim() !== "");

  const fields: EntryFieldSpec[] = [];

  // Colunas do núcleo, na ordem de EDITABLE_CORE_COLUMNS (title primeiro).
  for (const [col, dt] of Object.entries(EDITABLE_CORE_COLUMNS)) {
    const override = coreOverrides.get(col);
    const label = override?.label ?? CORE_LABELS.get(col) ?? col;
    if (col === "currency") {
      fields.push({
        key: col,
        label,
        kind: "core",
        dataType: dt,
        options: CURRENCY_OPTIONS.map((c) => c.value),
        strictOptions: true,
      });
      continue;
    }
    // Override core select-capable (0086): options viram SUGESTÃO (não
    // bloqueiam — o sync reescreve as options do núcleo a cada rodada).
    const softOptions =
      override?.data_type === "selecao" && (override.options?.length ?? 0) > 0
        ? override.options ?? undefined
        : undefined;
    fields.push({
      key: col,
      label,
      kind: "core",
      dataType: dt,
      ...(softOptions
        ? { options: softOptions, strictOptions: false as const }
        : {}),
    });
  }

  fields.push({
    key: "responsible_id",
    label: "Responsável",
    kind: "relation",
    dataType: "relacao",
    options: responsibles.map((r) => r.name),
    strictOptions: true,
  });
  fields.push({
    key: "operation_id",
    label: "Operação",
    kind: "relation",
    dataType: "relacao",
    options: operations.map((o) => o.name),
    strictOptions: true,
  });

  // Customs EDITÁVEIS: mesmo gating do createRecord (papel × applies_to; nunca
  // calculados nem linhas core).
  for (const d of defs) {
    if (isCoreDef(d)) continue;
    if (d.data_type === "calculado" || d.data_type === "calculado_agg") continue;
    if (!fieldAppliesToSource(d.applies_to, sourceDef.key, sources)) continue;
    const roleAllows = (d.editable_by_roles ?? []).some((r) => roles.includes(r));
    if (!roleAllows) continue;
    fields.push({
      key: `custom:${d.field_key}`,
      label: d.label ?? d.field_key,
      kind: "custom",
      dataType: d.data_type,
      ...(d.data_type === "selecao"
        ? { options: d.options ?? [], strictOptions: true as const }
        : {}),
    });
  }

  return {
    ok: true,
    sourceDef,
    ctx: {
      sourceKey: sourceDef.key,
      sourceLabel: sourceDef.label,
      recordType: sourceDef.recordType,
      fields,
      responsibles,
      operations,
    },
  };
}
