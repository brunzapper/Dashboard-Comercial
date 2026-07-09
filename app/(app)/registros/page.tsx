// Versão: 1.2 | Data: 05/07/2026
// Registros: listagem com filtros + edição por permissão + campos dinâmicos.
// v1.2 (05/07/2026): Fase 4 — listagem/filtros/edição (antes só o SyncPanel).
import Link from "next/link";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition, OptionItem, RecordRow } from "@/lib/records/types";
import { Button } from "@/components/ui/button";
import { SyncPanel } from "@/components/sync/sync-panel";
import { FiltersBar } from "@/components/registros/filters-bar";
import { RecordsTable } from "@/components/registros/records-table";

const PAGE_SIZE = 50;
const RECORD_COLS =
  "id, record_type, source_system, title, pipeline, stage, value, mrr, currency, sale_type, channel, closed, closed_at, responsible_id, operation_id, related_lead_id, lead_time_days, custom_fields, last_synced_at, locally_modified_at";

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function RegistrosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tipo = str(sp.tipo);
  const etapa = str(sp.etapa);
  const responsavel = str(sp.responsavel);
  const de = str(sp.de);
  const ate = str(sp.ate);
  const busca = str(sp.busca);
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const session = await getSessionInfo();
  const isAdmin = session?.roles.includes("admin") ?? false;
  const canEditValues = session?.permissions.includes("edit_record_values") ?? false;
  const userRoles = session?.roles ?? [];

  const supabase = await createClient();

  // Filtros + paginação (RLS decide o que o usuário vê).
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabase
    .from("records")
    .select(RECORD_COLS, { count: "exact" })
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .range(from, to);
  if (tipo) query = query.eq("record_type", tipo);
  if (etapa) query = query.ilike("stage", `%${etapa}%`);
  if (responsavel) query = query.eq("responsible_id", responsavel);
  if (de) query = query.gte("source_created_at", de);
  if (ate) query = query.lte("source_created_at", `${ate}T23:59:59`);
  if (busca) query = query.ilike("title", `%${busca}%`);

  const { data: recordsData, count } = await query;
  const records = (recordsData ?? []) as unknown as RecordRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Definições de campo visíveis (RLS), responsáveis e operações ativos.
  const [{ data: fieldsData }, { data: respData }, { data: opsData }] =
    await Promise.all([
      supabase
        .from("field_definitions")
        .select(
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, sort_order"
        )
        .eq("show_in_builder", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("responsibles")
        .select("id, display_name")
        .eq("active", true)
        .order("display_name"),
      supabase
        .from("operations")
        .select("id, name")
        .eq("active", true)
        .order("name"),
    ]);

  const fields = (fieldsData ?? []) as FieldDefinition[];
  const responsibles: OptionItem[] = (respData ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
  }));
  const operations: OptionItem[] = (opsData ?? []).map((o) => ({
    id: o.id as string,
    label: o.name as string,
  }));

  // Rótulos dos leads relacionados presentes na página.
  const leadIds = Array.from(
    new Set(records.map((r) => r.related_lead_id).filter(Boolean) as string[])
  );
  const relatedLeadLabels: Record<string, string> = {};
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from("records")
      .select("id, title")
      .in("id", leadIds);
    for (const l of leads ?? []) {
      relatedLeadLabels[l.id as string] = (l.title as string) ?? "(sem nome)";
    }
  }

  // Último sync (painel admin).
  let lastSyncedAt: string | null = null;
  if (isAdmin) {
    const { data } = await supabase
      .from("records")
      .select("last_synced_at")
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastSyncedAt = (data?.last_synced_at as string | undefined) ?? null;
  }

  function pageHref(target: number): string {
    const params = new URLSearchParams();
    if (tipo) params.set("tipo", tipo);
    if (etapa) params.set("etapa", etapa);
    if (responsavel) params.set("responsavel", responsavel);
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (busca) params.set("busca", busca);
    params.set("page", String(target));
    return `/registros?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Registros</h1>
        <p className="text-muted-foreground text-sm">
          {total} registro(s). Edite responsável, operação, lead e campos
          personalizados conforme suas permissões.
        </p>
      </div>

      {isAdmin ? <SyncPanel lastSyncedAt={lastSyncedAt} /> : null}

      <FiltersBar responsibles={responsibles} />

      <RecordsTable
        records={records}
        fields={fields}
        responsibles={responsibles}
        operations={operations}
        relatedLeadLabels={relatedLeadLabels}
        userRoles={userRoles}
        canEditValues={canEditValues}
      />

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">
            Página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            {page <= 1 ? (
              <Button variant="outline" size="sm" disabled>
                Anterior
              </Button>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref(page - 1)}>Anterior</Link>
              </Button>
            )}
            {page >= totalPages ? (
              <Button variant="outline" size="sm" disabled>
                Próxima
              </Button>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref(page + 1)}>Próxima</Link>
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
