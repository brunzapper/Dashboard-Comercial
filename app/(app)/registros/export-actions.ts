"use server";
// Versão: 1.0 | Data: 17/07/2026
// Exportação CSV da tela de Registros: reexecuta a MESMA query filtrada da
// página (client do usuário → RLS decide o que sai) sem paginação de tela,
// varrendo em lotes de 1000 até o teto. Devolve headers+rows já em string
// (convenção reimportável de lib/export/record-cells.ts); o client monta e
// baixa o arquivo (lib/export/csv.ts).
import { getSessionInfo } from "@/lib/auth/session";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import {
  fieldAppliesToSource,
  isKnownSource,
  toRecordType,
  type SourceKey,
} from "@/lib/sources";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { isCoreDef } from "@/lib/records/core-defs";
import {
  recordCellValue,
  recordRefLabel,
  type RecordLabels,
} from "@/lib/export/record-cells";

// Teto de linhas por export — acima disso pedimos para filtrar (payload de
// server action e memória do browser têm limite prático).
const EXPORT_MAX_ROWS = 20000;
const BATCH = 1000;

// Colunas core exportadas, na ordem da tabela da tela.
const CORE_EXPORT_REFS = [
  "title",
  "pipeline",
  "stage",
  "value",
  "mrr",
  "currency",
  "sale_type",
  "channel",
  "closed",
  "closed_at",
  "opened_at",
  "source_created_at",
  "responsible_id",
  "operation_id",
  "related_lead_id",
  "lead_time_days",
] as const;

const EXPORT_COLS =
  "id, record_type, source_system, title, pipeline, stage, value, mrr, currency, " +
  "sale_type, channel, closed, closed_at, opened_at, source_created_at, " +
  "responsible_id, operation_id, related_lead_id, lead_time_days, custom_fields";

export interface ExportRecordsParams {
  fonte: string;
  etapa?: string;
  responsavel?: string;
  de?: string;
  ate?: string;
  busca?: string;
}

export type ExportCsvResult =
  | { ok: true; headers: string[]; rows: string[][] }
  | { ok: false; message: string };

export async function exportRecordsCsv(
  params: ExportRecordsParams
): Promise<ExportCsvResult> {
  const session = await getSessionInfo();
  const roles = session?.roles ?? [];
  const isAdmin = roles.includes("admin");
  // Mesmo gate da página /registros.
  if (!isAdmin && !roles.includes("gestor")) {
    return { ok: false, message: "Sem permissão para exportar registros." };
  }

  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const fonte: SourceKey = isKnownSource(params.fonte, sources)
    ? params.fonte
    : (sources[0]?.key ?? "leads");
  const recordType = toRecordType(fonte);

  // Varre em lotes (mesma ordenação da tela); o 1º lote traz o count p/ o teto.
  const records: RecordRow[] = [];
  for (let from = 0; ; from += BATCH) {
    let query = supabase
      .from("records")
      .select(EXPORT_COLS, from === 0 ? { count: "exact" } : undefined)
      .eq("record_type", recordType)
      .eq("is_mock", false);
    if (params.etapa) query = query.ilike("stage", `%${params.etapa}%`);
    if (params.responsavel) {
      query = query.eq("responsible_id", params.responsavel);
    }
    if (params.de) query = query.gte("source_created_at", params.de);
    if (params.ate) {
      query = query.lte("source_created_at", `${params.ate}T23:59:59`);
    }
    if (params.busca) query = query.ilike("title", `%${params.busca}%`);

    const { data, count, error } = await query
      .order("source_created_at", { ascending: false, nullsFirst: false })
      .range(from, from + BATCH - 1);
    if (error) return { ok: false, message: error.message };

    if (from === 0) {
      const total = count ?? 0;
      if (total === 0) {
        return { ok: false, message: "Nenhum registro com os filtros atuais." };
      }
      if (total > EXPORT_MAX_ROWS) {
        return {
          ok: false,
          message: `${total} registros excedem o teto de ${EXPORT_MAX_ROWS}. Refine os filtros (período, etapa, responsável) e tente de novo.`,
        };
      }
    }
    records.push(...((data ?? []) as unknown as RecordRow[]));
    if (!data || data.length < BATCH) break;
  }

  // Colunas custom da fonte visíveis ao papel (mesma regra da página).
  const { data: fieldsData } = await supabase
    .from("field_definitions")
    .select(
      "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, formula, sort_order, applies_to, source_system, source_field_id, currency_code, currency_mode, show_as_percent"
    )
    .eq("show_in_builder", true)
    .order("sort_order", { ascending: true });
  const fields = ((fieldsData ?? []) as FieldDefinition[]).filter(
    (f) =>
      f.data_type !== "calculado_agg" &&
      // Linhas core (0086) são overrides das colunas núcleo — nunca coluna custom.
      !isCoreDef(f) &&
      fieldAppliesToSource(f.applies_to, fonte) &&
      (isAdmin || hasAnyRole(roles, f.visible_to_roles as RoleKey[]))
  );

  // Rótulos de FKs (responsável/operação/lead relacionado).
  const [{ data: respData }, { data: opsData }] = await Promise.all([
    supabase.from("responsibles").select("id, display_name"),
    supabase.from("operations").select("id, name"),
  ]);
  const leadIds = Array.from(
    new Set(records.map((r) => r.related_lead_id).filter(Boolean) as string[])
  );
  const leadLabels: Record<string, string> = {};
  for (let i = 0; i < leadIds.length; i += BATCH) {
    const { data: leads } = await supabase
      .from("records")
      .select("id, title")
      .in("id", leadIds.slice(i, i + BATCH));
    for (const l of leads ?? []) {
      leadLabels[l.id as string] = (l.title as string) ?? "";
    }
  }
  const labels: RecordLabels = {
    responsibles: Object.fromEntries(
      (respData ?? []).map((r) => [r.id as string, r.display_name as string])
    ),
    operations: Object.fromEntries(
      (opsData ?? []).map((o) => [o.id as string, o.name as string])
    ),
    leads: leadLabels,
  };

  const headers = [
    ...CORE_EXPORT_REFS.map((ref) => recordRefLabel(ref, fields)),
    ...fields.map((f) => f.label),
  ];
  const rows = records.map((r) => [
    ...CORE_EXPORT_REFS.map((ref) =>
      recordCellValue(r, ref, fields, labels, { csv: true })
    ),
    ...fields.map((f) =>
      recordCellValue(r, `custom:${f.field_key}`, fields, labels, { csv: true })
    ),
  ]);

  return { ok: true, headers, rows };
}
