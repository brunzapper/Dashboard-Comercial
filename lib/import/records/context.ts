// Versão: 1.1 | Data: 31/07/2026
// Contexto server-side da inserção de registros por IA: monta o catálogo de
// campos ACEITOS de uma base manual com o MESMO gating do createRecord
// (lib/records/actions.ts) — customs editáveis pelo papel × applies_to, sem
// calculados, linhas core (0086) como override de rótulo/options da coluna
// crua — mais responsáveis/operações ativos (resolução de nome). Consultas com
// o client RLS do usuário (org/visibilidade de graça).
// v1.1 (31/07/2026): loadRecordsUpdateContext — contexto do contrato
// registros-update (atualização em massa): aceita QUALQUER base do catálogo,
// SUB-fontes incluídas (o gate real é edit_record_values + editable_by_roles
// + RLS de records, não manual_entry), alvos incluem campos de Sync do Bitrix
// (paridade com /registros, que os edita via forceSync — marcados `sync`) e
// monta também o universo de FILTROS (colunas core consultáveis + customs
// visíveis pelo papel + relações com nomes).
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
import type {
  RecordsUpdateContext,
  UpdateFilterFieldSpec,
} from "@/lib/import/records/update-types";

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
  // Só no contexto de UPDATE (select estendido).
  visible_to_roles?: string[] | null;
  source_field_id?: string | null;
}

// Colunas do núcleo na ordem de EDITABLE_CORE_COLUMNS (title primeiro), com
// override core (0086) de rótulo/options. Compartilhado pelos dois contextos.
function coreFieldSpecs(coreOverrides: Map<string, DefRow>): EntryFieldSpec[] {
  const fields: EntryFieldSpec[] = [];
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
  return fields;
}

function namedList(
  rows: { id: string; name: string | null }[] | null | undefined
): { id: string; name: string }[] {
  return (rows ?? [])
    .map((r) => ({ id: r.id, name: r.name ?? "" }))
    .filter((r) => r.name.trim() !== "");
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

  const responsibles = namedList(
    ((respData ?? []) as { id: string; display_name: string | null }[]).map(
      (r) => ({ id: r.id, name: r.display_name })
    )
  );
  const operations = namedList(
    (opsData ?? []) as { id: string; name: string | null }[]
  );

  const fields: EntryFieldSpec[] = coreFieldSpecs(coreOverrides);

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

// ================= Contexto do contrato registros-update =================

export type RecordsUpdateContextResult =
  | { ok: true; ctx: RecordsUpdateContext; sourceDef: SourceDef }
  | { ok: false; message: string };

// Colunas core aceitas em FILTROS: as consultáveis do modo lista
// (record-list.ts filtra por CORE_FIELDS + record_type), MENOS as que não
// fazem sentido com a base fixa (record_type/source_system — a base vem do
// seletor) e related_lead_id (FK sem resolução por nome).
const FILTER_CORE_EXCLUDED = new Set([
  "record_type",
  "source_system",
  "related_lead_id",
]);

/**
 * Contexto do fluxo "Atualizar com IA" (registros-update): aceita QUALQUER
 * base do catálogo, inclusive SUB-fontes — diferente do insert, o gate não é
 * manual_entry (não criamos linha; a RLS records_update + editable_by_roles
 * são a muralha da escrita). Alvos = mesmo gating do entry + campos de Sync
 * do Bitrix (`sync: true`; paridade com /registros via forceSync). Filtros =
 * colunas core consultáveis + customs VISÍVEIS pelo papel + relações.
 */
export async function loadRecordsUpdateContext(
  supabase: Supabase,
  sourceKey: string,
  roles: string[]
): Promise<RecordsUpdateContextResult> {
  const sources = await loadSources(supabase);
  const sourceDef = sources.find((s) => s.key === sourceKey);
  if (!sourceDef) return { ok: false, message: "Base inválida." };

  const [{ data: defsData }, { data: respData }, { data: opsData }] =
    await Promise.all([
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, options, editable_by_roles, visible_to_roles, applies_to, source_system, source_field_id, sort_order"
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

  const responsibles = namedList(
    ((respData ?? []) as { id: string; display_name: string | null }[]).map(
      (r) => ({ id: r.id, name: r.display_name })
    )
  );
  const operations = namedList(
    (opsData ?? []) as { id: string; name: string | null }[]
  );

  const isAdmin = roles.includes("admin");

  // ---- ALVOS de "alteracoes" ----
  const fields: EntryFieldSpec[] = coreFieldSpecs(coreOverrides);
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
  for (const d of defs) {
    if (isCoreDef(d)) continue;
    if (d.data_type === "calculado" || d.data_type === "calculado_agg") continue;
    if (!fieldAppliesToSource(d.applies_to, sourceDef.key, sources)) continue;
    const roleAllows = (d.editable_by_roles ?? []).some((r) => roles.includes(r));
    // Campo de SYNC do Bitrix é alvo válido mesmo sem editable_by_roles —
    // paridade com /registros (forceSync). Escrita LOCAL; a prévia avisa.
    const isBitrixSync =
      d.source_system === "bitrix" && Boolean(d.source_field_id);
    if (!roleAllows && !isBitrixSync) continue;
    fields.push({
      key: `custom:${d.field_key}`,
      label: d.label ?? d.field_key,
      kind: "custom",
      dataType: d.data_type,
      ...(d.data_type === "selecao"
        ? { options: d.options ?? [], strictOptions: true as const }
        : {}),
      ...(isBitrixSync ? { sync: true as const } : {}),
    });
  }

  // ---- Universo de FILTROS ----
  const filterFields: UpdateFilterFieldSpec[] = [];
  for (const f of CORE_FIELDS) {
    if (FILTER_CORE_EXCLUDED.has(f.field)) continue;
    if (f.field === "responsible_id" || f.field === "operation_id") {
      filterFields.push({
        key: f.field,
        label: coreOverrides.get(f.field)?.label ?? f.label,
        dataType: "relacao",
        options: (f.field === "responsible_id" ? responsibles : operations).map(
          (r) => r.name
        ),
      });
      continue;
    }
    const override = coreOverrides.get(f.field);
    const dataType: DataType = f.isDate
      ? "data"
      : f.isNumeric
        ? "numero"
        : "texto";
    const options =
      override?.data_type === "selecao" && (override.options?.length ?? 0) > 0
        ? (override.options ?? undefined)
        : undefined;
    filterFields.push({
      key: f.field,
      label: override?.label ?? f.label,
      dataType,
      ...(options ? { options } : {}),
    });
  }
  for (const d of defs) {
    if (isCoreDef(d)) continue;
    // calculado_agg não tem valor por registro; calculado TEM (filtrável).
    if (d.data_type === "calculado_agg") continue;
    if (!fieldAppliesToSource(d.applies_to, sourceDef.key, sources)) continue;
    // ACL de leitura por papel (mesma régua da page de /registros): campo
    // restrito fora do universo de filtros p/ não vazar valores via prévia.
    const visible =
      isAdmin || (d.visible_to_roles ?? []).some((r) => roles.includes(r));
    if (!visible) continue;
    filterFields.push({
      key: `custom:${d.field_key}`,
      label: d.label ?? d.field_key,
      dataType: d.data_type,
      ...(d.data_type === "selecao" && (d.options?.length ?? 0) > 0
        ? { options: d.options ?? [] }
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
      isSub: Boolean(sourceDef.parentKey),
      fields,
      filterFields,
      responsibles,
      operations,
    },
  };
}
