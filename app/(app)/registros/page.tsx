// Versão: 1.4 | Data: 16/07/2026
// Registros: listagem com filtros + edição por permissão + campos dinâmicos.
// v1.2 (05/07/2026): Fase 4 — listagem/filtros/edição (antes só o SyncPanel).
// v1.3 (09/07/2026): Fase 8 — abas por fonte (Leads/Deals/Estudo). Cada aba
//   filtra por record_type e mostra só as colunas daquela fonte (applies_to).
// v1.4 (16/07/2026): botão "Novo registro" quando a fonte da aba permite
//   criação manual (manual_entry, 0061) e o usuário tem edit_record_values.
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition, OptionItem, RecordRow } from "@/lib/records/types";
import {
  fieldAppliesToSource,
  isKnownSource,
  toRecordType,
  type SourceKey,
} from "@/lib/sources";
import { loadSources } from "@/lib/config/sources";
import { cn } from "@/lib/utils";
import { SyncPanel } from "@/components/sync/sync-panel";
import { ExportCsvButton } from "@/components/registros/export-csv-button";
import { FiltersBar } from "@/components/registros/filters-bar";
import { RecordCreateSheet } from "@/components/registros/record-create-sheet";
import { RecordsTable } from "@/components/registros/records-table";
import { Button } from "@/components/ui/button";

// Rede de segurança p/ as Server Actions de sync desta página (o desenho já
// mantém cada passo pequeno; no plano gratuito o teto real é ~60s).
export const maxDuration = 60;

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
  const etapa = str(sp.etapa);
  const responsavel = str(sp.responsavel);
  const de = str(sp.de);
  const ate = str(sp.ate);
  const busca = str(sp.busca);
  const page = Math.max(1, Number(str(sp.page)) || 1);

  const session = await getSessionInfo();
  const isAdmin = session?.roles.includes("admin") ?? false;
  const canEditValues = session?.permissions.includes("edit_record_values") ?? false;
  const canManageFields =
    session?.permissions.includes("manage_field_definitions") ?? false;
  const userRoles = session?.roles ?? [];

  // Só Gestores e Administradores visualizam a página Registros.
  const canViewRegistros = isAdmin || userRoles.includes("gestor");
  if (!canViewRegistros) redirect("/");

  const supabase = await createClient();

  // Catálogo de fontes (abas): builtins + fontes criadas (data_sources).
  const sources = await loadSources(supabase);
  const fonteRaw = str(sp.fonte);
  const fonte: SourceKey = isKnownSource(fonteRaw, sources)
    ? fonteRaw
    : (sources[0]?.key ?? "leads");
  const recordType = toRecordType(fonte);
  const fonteDef = sources.find((s) => s.key === fonte);

  // Filtros + paginação (RLS decide o que o usuário vê).
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabase
    .from("records")
    .select(RECORD_COLS, { count: "exact" })
    .eq("record_type", recordType)
    // Fase 12: leads mock de "Data Reunião" (records.is_mock) ficam fora da
    // listagem e da contagem — só existem para consultas por Data Reunião.
    .eq("is_mock", false)
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .range(from, to);
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
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, sort_order, applies_to, source_system, source_field_id, write_back, currency_code, currency_mode, show_as_percent"
        )
        .eq("show_in_builder", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("responsibles")
        .select("id, display_name, bitrix_user_id")
        .eq("active", true)
        .order("display_name"),
      supabase
        .from("operations")
        .select("id, name")
        .eq("active", true)
        .order("name"),
    ]);

  const allFields = (fieldsData ?? []) as FieldDefinition[];
  // Só as colunas que pertencem à fonte da aba (applies_to) — campos locais/app
  // (applies_to vazio) aparecem em todas. Além disso, o ACL por papel
  // (visible_to_roles) agora é aplicado aqui: os metadados de campo são legíveis
  // por qualquer autenticado (RLS afrouxada), então filtramos as colunas
  // restritas na camada de app para não vazar valores ao gestor. Admin vê tudo.
  const fields = allFields.filter(
    (f) =>
      // 'calculado_agg' não tem valor por registro (é métrica de dashboard) —
      // nunca vira coluna de Registros.
      f.data_type !== "calculado_agg" &&
      fieldAppliesToSource(f.applies_to, fonte) &&
      (isAdmin || hasAnyRole(userRoles, f.visible_to_roles as RoleKey[]))
  );
  const responsibles: OptionItem[] = (respData ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
    // Só os com usuário Bitrix entram no dropdown write-back do formulário.
    bitrixLinked: Boolean(r.bitrix_user_id),
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

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("fonte", fonte);
    if (etapa) params.set("etapa", etapa);
    if (responsavel) params.set("responsavel", responsavel);
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (busca) params.set("busca", busca);
    return params;
  }

  function pageHref(target: number): string {
    const params = buildParams();
    params.set("page", String(target));
    return `/registros?${params.toString()}`;
  }

  // Aba de cada fonte, preservando os filtros atuais (mas voltando à página 1).
  function tabHref(target: SourceKey): string {
    const params = buildParams();
    params.set("fonte", target);
    return `/registros?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Registros</h1>
          <p className="text-muted-foreground text-sm">
            {total} registro(s). Edite responsável, operação, lead e campos
            personalizados conforme suas permissões.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEditValues && fonteDef?.manualEntry ? (
            <RecordCreateSheet
              source={{ key: fonte, label: fonteDef.label }}
              recordType={fonteDef.recordType}
              fields={fields}
              responsibles={responsibles}
              operations={operations}
              userRoles={userRoles}
            />
          ) : null}
          <ExportCsvButton
            params={{ fonte, etapa, responsavel, de, ate, busca }}
          />
          {isAdmin ? (
            <Button asChild variant="outline">
              <Link href="/registros/importar">Importar CSV</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {isAdmin ? <SyncPanel lastSyncedAt={lastSyncedAt} /> : null}

      {/* Abas por fonte (catálogo dinâmico) */}
      <div className="flex flex-wrap gap-1 border-b">
        {sources.map((s) => {
          const active = s.key === fonte;
          return (
            <Link
              key={s.key}
              href={tabHref(s.key)}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <FiltersBar responsibles={responsibles} />

      <RecordsTable
        source={fonte}
        records={records}
        fields={fields}
        responsibles={responsibles}
        operations={operations}
        relatedLeadLabels={relatedLeadLabels}
        userRoles={userRoles}
        canEditValues={canEditValues}
        canManageFields={canManageFields}
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
