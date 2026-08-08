// Versão: 2.0 | Data: 07/08/2026
// Registros: listagem com filtros + edição por permissão + campos dinâmicos.
// v2.0 (07/08/2026): 100% dos campos + ordenação.
//   - Colunas dirigidas por DADOS: registros_populated_refs (0120) informa as
//     colunas núcleo e chaves custom populadas na base; a tabela mostra toda
//     coluna com dados e oculta campo vazio que não pertence à base. O olho
//     (show_in_builder) DEIXOU de afetar Registros — vale só nos dropdowns do
//     construtor; o ACL por papel (visible_to_roles) segue intacto.
//   - Painel de detalhe recebe o catálogo COMPLETO (detailFields/offBaseDefs/
//     coreDefs/knownFieldKeys) — 100% dos campos consultáveis ao abrir.
//   - Ordenação server-side por URL (`ordenar`/`dir`, lib/records/list-sort):
//     whitelist núcleo + custom da fonte; tiebreak por id p/ paginação estável.
// v1.9 (31/07/2026): botão "Atualizar com IA" (RecordsAiUpdateSheet) em
//   QUALQUER base/sub p/ quem tem edit_record_values — atualização em massa
//   (contrato registros-update) com prévia server-side obrigatória; funciona
//   sem IA configurada (fluxo copiar-prompt → colar-JSON).
// v1.8 (30/07/2026): botão "Inserir com IA" (RecordsAiInsertSheet) nas bases
//   manuais quando a org tem IA configurada (loadOrgAiConfigPublic) — até 10
//   registros por leva com prévia obrigatória; maxDuration 60→300 (turno da IA
//   tem orçamento de 240s, como na Home).
// v1.7 (27/07/2026): botões "Bases" e "Log" no header — as páginas de config
//   moveram de /configuracoes/* para /registros/{bases,log}; visibilidade via
//   checkSettingsArea (papel × overrides — mesma audiência das abas antigas).
// v1.6 (26/07/2026): PASTAS (0107) — navegação hierárquica Pasta → Base →
//   Sub-base: fileira de pastas (só quando há pasta criada), fileira com as
//   bases da pasta ativa e seletor "Base completa | sub..." quando a base tem
//   sub-bases. Tudo URL-driven pelo `?fonte=` de sempre (pasta ativa DERIVA da
//   base ativa — links antigos seguem funcionando); sem pastas, degrada para
//   as abas planas (agora só raízes — subs no 3º nível).
// v1.5 (18/07/2026): badge de write-backs pendentes (WritebackPendingBadge) —
//   mostra "N aguardando envio ao Bitrix" com link p/ Registros → Log.
// v1.2 (05/07/2026): Fase 4 — listagem/filtros/edição (antes só o SyncPanel).
// v1.3 (09/07/2026): Fase 8 — abas por fonte (Leads/Deals/Estudo). Cada aba
//   filtra por record_type e mostra só as colunas daquela fonte (applies_to).
// v1.4 (16/07/2026): botão "Novo registro" quando a fonte da aba permite
//   criação manual (manual_entry, 0061) e o usuário tem edit_record_values.
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { checkSettingsArea } from "@/lib/auth/access";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition, OptionItem, RecordRow } from "@/lib/records/types";
import { splitCoreDefs } from "@/lib/records/core-defs";
import {
  parsePopulatedRefs,
  tableCoreColumns,
  tableCustomFields,
} from "@/lib/records/detail-fields";
import { parseRecordListSort, sortColumnExpr } from "@/lib/records/list-sort";
import {
  fieldAppliesToSource,
  isKnownSource,
  isSubSource,
  parentKeyOf,
  recordTypeOf,
  sourcePredicate,
  subSourcesOf,
  type SourceKey,
} from "@/lib/sources";
import {
  groupSourcesByFolder,
  IMPLICIT_FOLDER_LABEL,
} from "@/lib/source-folders";
import { loadSources } from "@/lib/config/sources";
import { loadSourceFolders } from "@/lib/config/source-folders";
import {
  buildResponsibleCanon,
  collapseResponsibleOptions,
  expandResponsibleIds,
  loadResponsibleCanon,
} from "@/lib/config/responsible-canon";
import { cn } from "@/lib/utils";
import { getActiveOrgId } from "@/lib/auth/org";
import { loadOrgAiConfigPublic } from "@/lib/ai/config";
import { SyncPanel } from "@/components/sync/sync-panel";
import { WritebackPendingBadge } from "@/components/sync/writeback-pending-badge";
import { ExportCsvButton } from "@/components/registros/export-csv-button";
import { FiltersBar } from "@/components/registros/filters-bar";
import { RecordCreateSheet } from "@/components/registros/record-create-sheet";
import { RecordsAiInsertSheet } from "@/components/registros/ai-insert-sheet";
import { RecordsAiUpdateSheet } from "@/components/registros/ai-update-sheet";
import { RecordsTable } from "@/components/registros/records-table";
import { Button } from "@/components/ui/button";

// Rede de segurança p/ as Server Actions desta página. 300 cobre o turno da
// inserção por IA (laço com orçamento de 240s, como na Home); no plano
// gratuito o teto real segue ~60s.
export const maxDuration = 300;

const PAGE_SIZE = 50;
const RECORD_COLS =
  "id, record_type, source_system, title, pipeline, stage, stage_semantic, value, mrr, currency, sale_type, channel, closed, closed_at, opened_at, source_created_at, responsible_id, operation_id, related_lead_id, lead_time_days, custom_fields, last_synced_at, locally_modified_at";

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Registros" };

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

  // Links p/ as páginas de config do ambiente (Bases/Log) — papel × overrides.
  const [canSeeBases, canSeeLog] = await Promise.all([
    checkSettingsArea("fontes"),
    checkSettingsArea("log"),
  ]);

  const supabase = await createClient();

  // Catálogo de fontes (abas): builtins + fontes criadas (data_sources) +
  // pastas (0107 — agrupam a navegação; [] sem migração/pasta).
  const sources = await loadSources(supabase);
  const folders = await loadSourceFolders(supabase);
  const fonteRaw = str(sp.fonte);
  const fonte: SourceKey = isKnownSource(fonteRaw, sources)
    ? fonteRaw
    : (sources[0]?.key ?? "leads");
  // SUB-FONTES (0078): sub → record_type da PAI (recordTypeOf); a aba mostra as
  // linhas da pai recortadas pelo filtro da sub (aplicado abaixo).
  const recordType = recordTypeOf(fonte, sources);
  const fonteDef = sources.find((s) => s.key === fonte);
  const subFilter = isSubSource(fonte, sources)
    ? sourcePredicate(fonte, sources)
    : [];

  // Catálogo de campos, responsáveis/operações ativos e colunas POPULADAS na
  // base (registros_populated_refs, 0120) — buscados ANTES da query de
  // registros: a ordenação valida contra o catálogo da fonte e as colunas da
  // tabela derivam das populadas.
  const [
    { data: fieldsData },
    { data: respData },
    { data: opsData },
    populatedRes,
  ] = await Promise.all([
    supabase
      .from("field_definitions")
      .select(
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, sort_order, applies_to, source_system, source_field_id, write_back, currency_code, currency_mode, show_as_percent"
      )
      // TODAS as defs (07/08/2026): o olho (show_in_builder) não recorta mais
      // Registros — colunas saem das POPULADAS; linhas core (0086) dão
      // rótulo/ordem às colunas núcleo.
      .order("sort_order", { ascending: true }),
    supabase
      .from("responsibles")
      .select("id, display_name, bitrix_user_id, canonical_id")
      .eq("active", true)
      .order("display_name"),
    supabase
      .from("operations")
      .select("id, name")
      .eq("active", true)
      .order("name"),
    supabase.rpc("registros_populated_refs", { p_record_type: recordType }),
  ]);

  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const { custom: customDefs, core } = splitCoreDefs(allFields);
  const coreDefs = [...core.values()];
  // RPC indisponível/erro ⇒ null: a tabela cai no conjunto legado de colunas.
  const populated = populatedRes.error
    ? null
    : parsePopulatedRefs(populatedRes.data);

  // ACL por papel (visible_to_roles) aplicado na camada de app: os metadados
  // de campo são legíveis por qualquer autenticado (RLS afrouxada), então
  // filtramos as colunas restritas aqui para não vazar valores ao gestor.
  // Admin vê tudo.
  const visibleTo = (f: FieldDefinition) =>
    isAdmin || hasAnyRole(userRoles, f.visible_to_roles as RoleKey[]);
  const appliesTo = (f: FieldDefinition) =>
    fieldAppliesToSource(f.applies_to, fonte, sources);

  // Colunas custom da tabela: aplica-se à base OU populada nela
  // ('calculado_agg' não tem valor por registro — nunca vira coluna).
  const fields = tableCustomFields(customDefs, {
    applies: appliesTo,
    visible: visibleTo,
    populatedCustom: new Set(populated?.custom ?? []),
  });
  // Colunas núcleo populadas; fallback (sem RPC/migração) = conjunto legado.
  const legacyCore = [
    ...(fonte === "deals" ? ["pipeline"] : []),
    "stage",
    "responsible_id",
    ...(fonte === "deals" || fonte === "estudo" ? ["mrr"] : []),
    "value",
    "currency",
    "source_created_at",
  ];
  const coreColumns = tableCoreColumns(populated, coreDefs, legacyCore);
  // Chaves populadas SEM definição alguma → colunas read-only.
  const defKeys = new Set(customDefs.map((f) => f.field_key));
  const orphanColumns = (populated?.custom ?? [])
    .filter((k) => !defKeys.has(k))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  // Catálogo do painel de detalhe (100% dos campos): campos da base (mesmo sem
  // dado) + de outras bases (o painel só exibe estes quando o registro tem
  // valor neles).
  const detailFields = customDefs.filter(
    (f) => f.data_type !== "calculado_agg" && visibleTo(f) && appliesTo(f)
  );
  const offBaseDefs = customDefs.filter(
    (f) => f.data_type !== "calculado_agg" && visibleTo(f) && !appliesTo(f)
  );
  // PRÉ-ACL de propósito: chave com definição nunca é tratada como órfã no
  // painel — valor de campo restrito por papel não vaza via "Outros dados".
  const knownFieldKeys = customDefs.map((f) => f.field_key);

  // Ordenação por URL, validada contra o catálogo da fonte (inválida ⇒ padrão).
  const sort = parseRecordListSort(str(sp.ordenar), str(sp.dir), fields);

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
    // Lixeira (0121): soft delete fora da listagem — só /registros/lixeira.
    .is("deleted_at", null);
  query = (
    sort
      ? query.order(sortColumnExpr(sort, fields), {
          ascending: sort.dir === "asc",
          nullsFirst: false,
        })
      : query.order("source_created_at", {
          ascending: false,
          nullsFirst: false,
        })
  )
    // Tiebreak estável p/ paginação (mesma técnica do modo lista de widgets).
    .order("id", { ascending: true })
    .range(from, to);
  if (etapa) query = query.ilike("stage", `%${etapa}%`);
  // Agrupamento (0101): filtrar por um responsável alcança o grupo inteiro
  // (apelidos ∪ principal) — mesmo recorte dos widgets.
  if (responsavel) {
    const group = expandResponsibleIds(
      [responsavel],
      await loadResponsibleCanon(supabase)
    );
    query =
      group.length > 1
        ? query.in("responsible_id", group)
        : query.eq("responsible_id", responsavel);
  }
  if (de) query = query.gte("source_created_at", de);
  if (ate) query = query.lte("source_created_at", `${ate}T23:59:59`);
  if (busca) query = query.ilike("title", `%${busca}%`);
  // Predicado da sub-fonte (todas as condições em E).
  for (const f of subFilter) {
    const col = f.field.startsWith("custom:")
      ? `custom_fields->>${f.field.slice(7)}`
      : f.field;
    const v = f.value as string;
    if (f.op === "eq") query = query.eq(col, v);
    else if (f.op === "neq") query = query.neq(col, v);
    else if (f.op === "gt") query = query.gt(col, v);
    else if (f.op === "gte") query = query.gte(col, v);
    else if (f.op === "lt") query = query.lt(col, v);
    else if (f.op === "lte") query = query.lte(col, v);
    else if (f.op === "ilike") query = query.ilike(col, `%${String(v ?? "")}%`);
    else if (f.op === "in")
      query = query.in(col, (Array.isArray(f.value) ? f.value : [f.value]) as string[]);
    else if (f.op === "is_null") query = query.is(col, null);
    else if (f.op === "not_null") query = query.not(col, "is", null);
  }

  const { data: recordsData, count } = await query;
  const records = (recordsData ?? []) as unknown as RecordRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const responsibles: OptionItem[] = (respData ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
    // Só os com usuário Bitrix entram no dropdown write-back do formulário.
    bitrixLinked: Boolean(r.bitrix_user_id),
  }));
  // Agrupamento (0101): o dropdown de FILTRO colapsa apelidos no principal
  // (uma seleção alcança o grupo); form/tabela seguem com a lista completa —
  // atribuição/write-back grava o responsável REAL.
  const respRows = (respData ?? []) as unknown as {
    id: string;
    canonical_id?: string | null;
  }[];
  const keepInFilter = new Set(
    collapseResponsibleOptions(
      respRows.map((r) => ({ value: r.id })),
      buildResponsibleCanon(respRows)
    ).map((o) => o.value)
  );
  const filterResponsibles: OptionItem[] = responsibles.filter((r) =>
    keepInFilter.has(r.id)
  );
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

  // IA por org (0096): habilita o botão "Inserir com IA" nas bases manuais.
  // Só a config PÚBLICA (provider/model/hasKey) — a chave nunca sai do server.
  const orgId = await getActiveOrgId();
  const ai = orgId ? await loadOrgAiConfigPublic(orgId) : null;

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
    // Eco do sort VALIDADO (nunca o cru da URL): paginação/abas o preservam;
    // ao trocar de aba o server re-valida contra a nova fonte e cai no padrão.
    if (sort) {
      params.set("ordenar", sort.ref);
      params.set("dir", sort.dir);
    }
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

  // Navegação Pasta → Base → Sub-base (0107): TUDO deriva da fonte ativa
  // (`?fonte=`, já validada/fallback acima) — links antigos seguem valendo e
  // não há param novo. Sem pasta criada, só a fileira de bases aparece
  // (agora apenas raízes — as subs moram no 3º nível).
  const rootKey = parentKeyOf(fonte, sources) ?? fonte;
  const folderGroups = groupSourcesByFolder(folders, sources);
  const showFolders = folderGroups.some((g) => g.folder != null);
  const activeGroup =
    folderGroups.find((g) => g.roots.some((r) => r.key === rootKey)) ??
    folderGroups[0];
  const subTabs = subSourcesOf(rootKey, sources);

  return (
    <div className="flex flex-col gap-6">
      {/* pr-8: afasta o cluster de botões do sino fixo (TaskBell, topo-direito) */}
      <div className="flex items-start justify-between gap-4 pr-8">
        <div>
          <h1 className="text-2xl font-semibold">Registros</h1>
          <p className="text-muted-foreground text-sm">
            {total} registro(s). Edite responsável, operação, lead e campos
            personalizados conforme suas permissões.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Criação usa o catálogo da BASE (detailFields — inclui campos com
              olho desligado; o form filtra os editáveis pelo papel), nunca as
              colunas da tabela (que podem ter campos de outra base
              só-populados). */}
          {canEditValues && fonteDef?.manualEntry ? (
            <RecordCreateSheet
              source={{ key: fonte, label: fonteDef.label }}
              recordType={fonteDef.recordType}
              fields={detailFields}
              responsibles={responsibles}
              operations={operations}
              userRoles={userRoles}
            />
          ) : null}
          {canEditValues && fonteDef?.manualEntry && ai?.hasKey ? (
            <RecordsAiInsertSheet
              source={{ key: fonte, label: fonteDef.label }}
              ai={ai}
            />
          ) : null}
          {/* Atualização em massa (registros-update): qualquer base/sub — o
              gate real é edit_record_values + RLS; funciona sem IA (fluxo
              copiar-prompt → colar-JSON). */}
          {canEditValues && fonteDef ? (
            <RecordsAiUpdateSheet
              source={{ key: fonte, label: fonteDef.label }}
              ai={ai}
            />
          ) : null}
          <ExportCsvButton
            params={{
              fonte,
              etapa,
              responsavel,
              de,
              ate,
              busca,
              ordenar: sort?.ref,
              dir: sort?.dir,
            }}
          />
          {isAdmin ? (
            <Button asChild variant="outline">
              <Link href="/registros/importar">Importar CSV</Link>
            </Button>
          ) : null}
          {canSeeBases ? (
            <Button asChild variant="outline">
              <Link href="/registros/bases">Bases</Link>
            </Button>
          ) : null}
          {canSeeLog ? (
            <Button asChild variant="outline">
              <Link href="/registros/log">Log</Link>
            </Button>
          ) : null}
          {/* Lixeira (0121): restauração/exclusão definitiva — só admin (o
              mesmo gate das actions de lixeira). */}
          {isAdmin ? (
            <Button asChild variant="outline">
              <Link href="/registros/lixeira">Lixeira</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {isAdmin ? <SyncPanel lastSyncedAt={lastSyncedAt} /> : null}

      {/* Fila de write-back: badge "N aguardando envio ao Bitrix" (some com 0).
          Gestor/admin — mesmo público da página; a RLS da fila reforça. */}
      <WritebackPendingBadge />

      {/* Navegação por base (catálogo dinâmico + pastas 0107):
          pastas → bases da pasta ativa → sub-bases da base ativa. */}
      <div className="flex flex-col gap-2">
        {showFolders ? (
          <div className="flex flex-wrap gap-1.5">
            {folderGroups.map((g) => {
              const active = g === activeGroup;
              const first = g.roots[0];
              return (
                <Link
                  key={g.folder?.id ?? "__sem_pasta__"}
                  href={tabHref(first.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-brand bg-brand text-brand-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {g.folder?.label ?? IMPLICIT_FOLDER_LABEL}
                </Link>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1 border-b">
          {(activeGroup?.roots ?? []).map((s) => {
            const active = s.key === rootKey;
            return (
              <Link
                key={s.key}
                href={tabHref(s.key)}
                className={cn(
                  "-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-brand text-foreground"
                    : "text-muted-foreground border-transparent hover:text-foreground"
                )}
              >
                {s.label}
              </Link>
            );
          })}
        </div>

        {subTabs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              href={tabHref(rootKey)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                fonte === rootKey
                  ? "border-brand bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Base completa
            </Link>
            {subTabs.map((s) => {
              const active = s.key === fonte;
              return (
                <Link
                  key={s.key}
                  href={tabHref(s.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-brand bg-brand text-brand-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s.label}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>

      <FiltersBar responsibles={filterResponsibles} />

      <RecordsTable
        source={fonte}
        sourceLabel={fonteDef?.label ?? fonte}
        records={records}
        fields={fields}
        coreColumns={coreColumns}
        orphanColumns={orphanColumns}
        coreDefs={coreDefs}
        detailFields={detailFields}
        offBaseDefs={offBaseDefs}
        knownFieldKeys={knownFieldKeys}
        sort={sort}
        responsibles={responsibles}
        operations={operations}
        relatedLeadLabels={relatedLeadLabels}
        userRoles={userRoles}
        canEditValues={canEditValues}
        canManageFields={canManageFields}
        canDeleteRecords={isAdmin}
        ai={ai}
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
