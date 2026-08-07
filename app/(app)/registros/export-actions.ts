"use server";
// Versão: 1.1 | Data: 07/08/2026
// v1.1 (07/08/2026): paridade de ORDENAÇÃO com a tela — `ordenar`/`dir`
//   validados pelo MESMO helper da página (lib/records/list-sort) e aplicados
//   em cada lote (+ tiebreak por id); o CSV sai na ordem exibida. O conjunto
//   de colunas do export segue o da v1.0 (divergência conhecida: não reflete
//   as colunas dirigidas por dados da tela).
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
import { parseRecordListSort, sortColumnExpr } from "@/lib/records/list-sort";
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
  // Ordenação ativa da tela (re-validada aqui pelo mesmo helper da página).
  ordenar?: string;
  dir?: string;
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

  // Colunas custom da fonte visíveis ao papel — buscadas ANTES do laço: a
  // ordenação valida contra o catálogo (mesmo helper da página).
  const { data: fieldsData } = await supabase
    .from("field_definitions")
    .select(
      "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, formula, sort_order, applies_to, source_system, source_field_id, currency_code, currency_mode, show_as_percent"
    )
    // Linhas core (0086) entram MESMO ocultas: o olho do /campos é aplicado
      // no merge (buildAvailableFields) — sem a linha, o hardcoded reapareceria.
      .or("show_in_builder.eq.true,source_system.eq.core")
    .order("sort_order", { ascending: true });
  const fields = ((fieldsData ?? []) as FieldDefinition[]).filter(
    (f) =>
      f.data_type !== "calculado_agg" &&
      // Linhas core (0086) são overrides das colunas núcleo — nunca coluna custom.
      !isCoreDef(f) &&
      fieldAppliesToSource(f.applies_to, fonte) &&
      (isAdmin || hasAnyRole(roles, f.visible_to_roles as RoleKey[]))
  );

  // Catálogo de VALIDAÇÃO do sort: qualquer custom visível ao papel (a tela
  // pode ordenar por coluna populada de outra base, fora de `fields`).
  const sortCatalog = ((fieldsData ?? []) as FieldDefinition[]).filter(
    (f) =>
      f.data_type !== "calculado_agg" &&
      !isCoreDef(f) &&
      (isAdmin || hasAnyRole(roles, f.visible_to_roles as RoleKey[]))
  );
  const sort = parseRecordListSort(
    params.ordenar ?? "",
    params.dir ?? "",
    sortCatalog
  );

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

    const ordered = (
      sort
        ? query.order(sortColumnExpr(sort, sortCatalog), {
            ascending: sort.dir === "asc",
            nullsFirst: false,
          })
        : query.order("source_created_at", {
            ascending: false,
            nullsFirst: false,
          })
    )
      // Tiebreak estável entre lotes (mesma técnica da página).
      .order("id", { ascending: true });
    const { data, count, error } = await ordered.range(from, from + BATCH - 1);
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
