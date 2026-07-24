// Versão: 1.0 | Data: 15/07/2026
// Server Actions dos SNAPSHOTS (link público congelado de uma aba).
// Autorização: dono do dashboard ou admin — checada aqui (erro amigável) E
// reforçada pela RLS de public.snapshots (0056), pois toda escrita usa o
// client do usuário. A ÚNICA exceção é o refresh, que precisa da service role
// (copia registros e consulta o RPC do snapshot) — e só roda DEPOIS de o
// client do usuário provar acesso à linha. O token em claro aparece UMA vez,
// no retorno de createSnapshot; nunca armazenamos nem devolvemos token_hash.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateToken, hashToken } from "@/lib/snapshots/token";
import { computeNextRefreshAt, isValidTime } from "@/lib/snapshots/schedule";
import { refreshSnapshot } from "@/lib/snapshots/refresh";
import {
  SNAPSHOT_LIST_COLS,
  type RefreshMode,
  type SnapshotListItem,
} from "@/lib/snapshots/types";
import { loadSources } from "@/lib/config/sources";
import { applySourceScope } from "@/lib/config/source-scope";
import {
  PERIOD_ALL,
  PERIOD_PRESETS,
  type SavedPeriod,
} from "@/lib/widgets/period";
import type { DashboardSettings } from "@/lib/widgets/types";

export interface SnapshotActionState {
  ok?: boolean;
  message?: string;
}

export interface SnapshotInput {
  name: string;
  tabId: string;
  // null = todos. Arrays vazios são normalizados para null.
  allowedResponsibleIds: string[] | null;
  allowedOperationIds: string[] | null;
  // record_type ('lead' | 'negocio' | 'venda_site').
  allowedSources: string[] | null;
  allowQuickFilters: boolean;
  allowWidgetFilters: boolean;
  refreshMode: RefreshMode;
  refreshTime?: string | null;
  refreshWeekday?: number | null;
  // Filtro de período do dashboard congelado no snapshot (0059).
  // undefined = não tocar (edição mantém o gravado); null = todo o período.
  defaultPeriod?: SavedPeriod | null;
  // TTL opcional do link público (0097): dias a partir de AGORA até a
  // expiração. undefined = não tocar (edição); null/0 = sem expiração;
  // N>0 = expira em N dias.
  expiresInDays?: number | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFRESH_MODES: RefreshMode[] = ["manual", "hourly", "daily", "weekly"];

// Normaliza/valida uma lista de restrição: [] → null (= todos); item inválido
// derruba a ação (nunca gravar restrição malformada num acesso público).
function cleanIdList(
  raw: string[] | null | undefined,
  label: string
): { ok: true; value: string[] | null } | { ok: false; message: string } {
  if (!raw || raw.length === 0) return { ok: true, value: null };
  const vals = raw.map(String);
  if (vals.some((v) => !UUID_RE.test(v))) {
    return { ok: false, message: `Restrição de ${label} inválida.` };
  }
  return { ok: true, value: [...new Set(vals)] };
}

function cleanSources(
  raw: string[] | null | undefined,
  // record_types válidos, derivados do CATÁLOGO (data_sources) do chamador.
  validRecordTypes: Set<string>
): { ok: true; value: string[] | null } | { ok: false; message: string } {
  if (!raw || raw.length === 0) return { ok: true, value: null };
  const vals = raw.map(String);
  if (vals.some((v) => !validRecordTypes.has(v))) {
    return { ok: false, message: "Restrição de bases inválida." };
  }
  return { ok: true, value: [...new Set(vals)] };
}

// Normaliza/valida o período congelado: undefined → não tocar; null/sem
// conteúdo (ou "todo o período" explícito) → null; senão só as chaves
// conhecidas, validadas — o valor alimenta o viewer PÚBLICO, nunca gravar
// shape arbitrário.
const PERIOD_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function cleanPeriod(
  raw: SavedPeriod | null | undefined
):
  | { ok: true; value: SavedPeriod | null | undefined }
  | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  const periodo = String(raw.periodo ?? "").trim();
  const de = String(raw.de ?? "").trim();
  const ate = String(raw.ate ?? "").trim();
  const campo = String(raw.campo ?? "").trim();
  if (
    (periodo && periodo !== PERIOD_ALL && !(periodo in PERIOD_PRESETS)) ||
    (de && !PERIOD_DATE_RE.test(de)) ||
    (ate && !PERIOD_DATE_RE.test(ate)) ||
    campo.length > 200
  ) {
    return { ok: false, message: "Período congelado inválido." };
  }
  const hasContent = Boolean((periodo && periodo !== PERIOD_ALL) || de || ate);
  if (!hasContent) return { ok: true, value: null };
  const value: SavedPeriod = {};
  if (periodo) value.periodo = periodo;
  if (de) value.de = de;
  if (ate) value.ate = ate;
  if (campo) value.campo = campo;
  return { ok: true, value };
}

// TTL opcional do link público (0097). Recebe DIAS a partir de agora e devolve
// o instante absoluto (ISO) gravado em snapshots.expires_at.
//   undefined → não tocar (edição preserva o gravado)
//   null / 0  → sem expiração (grava null)
//   N > 0     → expira em N dias
const MAX_EXPIRY_DAYS = 3650; // teto de sanidade (~10 anos)
function cleanExpiry(
  raw: number | null | undefined
):
  | { ok: true; value: string | null | undefined }
  | { ok: false; message: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 0 || days > MAX_EXPIRY_DAYS) {
    return { ok: false, message: "Prazo de expiração inválido." };
  }
  if (days === 0) return { ok: true, value: null };
  return {
    ok: true,
    value: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function cleanSchedule(input: {
  refreshMode: RefreshMode;
  refreshTime?: string | null;
  refreshWeekday?: number | null;
}):
  | {
      ok: true;
      mode: RefreshMode;
      time: string | null;
      weekday: number | null;
      nextAt: string | null;
    }
  | { ok: false; message: string } {
  const mode = input.refreshMode;
  if (!REFRESH_MODES.includes(mode)) {
    return { ok: false, message: "Agendamento inválido." };
  }
  let time: string | null = null;
  let weekday: number | null = null;
  if (mode === "daily" || mode === "weekly") {
    if (!isValidTime(input.refreshTime)) {
      return { ok: false, message: "Informe o horário (HH:MM)." };
    }
    time = input.refreshTime;
  }
  if (mode === "weekly") {
    const wd = Number(input.refreshWeekday);
    if (!Number.isInteger(wd) || wd < 1 || wd > 7) {
      return { ok: false, message: "Informe o dia da semana." };
    }
    weekday = wd;
  }
  const nextAt =
    computeNextRefreshAt(mode, time, weekday)?.toISOString() ?? null;
  return { ok: true, mode, time, weekday, nextAt };
}

// Dono do dashboard ou admin? (erro amigável; a RLS é a barreira definitiva)
async function canManageDashboard(
  dashboardId: string
): Promise<
  | { ok: true; settings: DashboardSettings }
  | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, owner_user_id, settings")
    .eq("id", dashboardId)
    .maybeSingle();
  if (!dash) return { ok: false, message: "Dashboard não encontrado." };
  const isOwner = dash.owner_user_id === session.user.id;
  const isAdmin = session.roles.includes("admin");
  if (!isOwner && !isAdmin) {
    return { ok: false, message: "Apenas o dono ou um admin gerencia snapshots." };
  }
  return { ok: true, settings: (dash.settings ?? {}) as DashboardSettings };
}

// Carrega um snapshot COM O CLIENT DO USUÁRIO (RLS prova o acesso) — pré-
// requisito de qualquer ação que depois use a service role.
async function loadOwnSnapshot(
  snapshotId: string
): Promise<
  | { ok: true; snapshot: SnapshotListItem }
  | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("snapshots")
    .select(SNAPSHOT_LIST_COLS)
    .eq("id", snapshotId)
    .maybeSingle();
  if (!data) return { ok: false, message: "Snapshot não encontrado." };
  return { ok: true, snapshot: data as unknown as SnapshotListItem };
}

function revalidateSnapshotViews(dashboardId: string) {
  revalidatePath(`/dashboards/${dashboardId}`);
  revalidatePath("/configuracoes/snapshots");
}

// ---------------- Criação ----------------

export interface CreateSnapshotResult extends SnapshotActionState {
  snapshotId?: string;
  /** Token em claro — exibido UMA única vez; não é recuperável depois. */
  token?: string;
}

export async function createSnapshot(
  dashboardId: string,
  input: SnapshotInput
): Promise<CreateSnapshotResult> {
  const access = await canManageDashboard(dashboardId);
  if (!access.ok) return { ok: false, message: access.message };

  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, message: "Informe um nome para o snapshot." };

  const tabs = access.settings.tabs ?? [];
  const tabId = String(input.tabId ?? "");
  if (tabId && !tabs.some((t) => t.id === tabId)) {
    return { ok: false, message: "Aba inválida." };
  }
  if (!tabId && tabs.length > 0) {
    return { ok: false, message: "Escolha a aba do snapshot." };
  }

  const supabase = await createClient();
  const catalog = await loadSources(supabase);
  const resp = cleanIdList(input.allowedResponsibleIds, "responsáveis");
  if (!resp.ok) return { ok: false, message: resp.message };
  const ops = cleanIdList(input.allowedOperationIds, "operações");
  if (!ops.ok) return { ok: false, message: ops.message };
  const sources = cleanSources(
    input.allowedSources,
    new Set(catalog.map((s) => s.recordType))
  );
  if (!sources.ok) return { ok: false, message: sources.message };
  const schedule = cleanSchedule(input);
  if (!schedule.ok) return { ok: false, message: schedule.message };
  const period = cleanPeriod(input.defaultPeriod);
  if (!period.ok) return { ok: false, message: period.message };
  // Na criação, ausência de prazo = sem expiração (null), não "não tocar".
  const expiry = cleanExpiry(input.expiresInDays ?? null);
  if (!expiry.ok) return { ok: false, message: expiry.message };

  const token = generateToken();
  const session = await getSessionInfo();
  const { data: created, error } = await supabase
    .from("snapshots")
    .insert({
      dashboard_id: dashboardId,
      tab_id: tabId,
      name,
      token_hash: hashToken(token),
      allowed_responsible_ids: resp.value,
      allowed_operation_ids: ops.value,
      allowed_sources: sources.value,
      allow_quick_filters: Boolean(input.allowQuickFilters),
      allow_widget_filters: Boolean(input.allowWidgetFilters),
      refresh_mode: schedule.mode,
      refresh_time: schedule.time,
      refresh_weekday: schedule.weekday,
      next_refresh_at: schedule.nextAt,
      default_period: period.value ?? null,
      expires_at: expiry.value ?? null,
      created_by: session?.user.id ?? null,
    })
    .select("id")
    .single();
  if (error || !created) {
    return { ok: false, message: error?.message ?? "Falha ao criar snapshot." };
  }

  // Primeiro congelamento (service role — acesso já provado acima).
  const refreshed = await refreshSnapshot(createServiceClient(), created.id);
  revalidateSnapshotViews(dashboardId);
  return {
    ok: true,
    snapshotId: created.id as string,
    token,
    message: refreshed.ok
      ? undefined
      : `Snapshot criado, mas o primeiro congelamento falhou: ${refreshed.error}`,
  };
}

// ---------------- Edição ----------------

export async function updateSnapshot(
  snapshotId: string,
  input: SnapshotInput
): Promise<SnapshotActionState> {
  const own = await loadOwnSnapshot(snapshotId);
  if (!own.ok) return { ok: false, message: own.message };
  const current = own.snapshot;

  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, message: "Informe um nome para o snapshot." };
  const supabase = await createClient();
  const catalog = await loadSources(supabase);
  const resp = cleanIdList(input.allowedResponsibleIds, "responsáveis");
  if (!resp.ok) return { ok: false, message: resp.message };
  const ops = cleanIdList(input.allowedOperationIds, "operações");
  if (!ops.ok) return { ok: false, message: ops.message };
  const sources = cleanSources(
    input.allowedSources,
    new Set(catalog.map((s) => s.recordType))
  );
  if (!sources.ok) return { ok: false, message: sources.message };
  const schedule = cleanSchedule(input);
  if (!schedule.ok) return { ok: false, message: schedule.message };
  const period = cleanPeriod(input.defaultPeriod);
  if (!period.ok) return { ok: false, message: period.message };
  // Edição: undefined = não tocar; null/0 = limpar; N>0 = novo prazo.
  const expiry = cleanExpiry(input.expiresInDays);
  if (!expiry.ok) return { ok: false, message: expiry.message };

  const { error } = await supabase
    .from("snapshots")
    .update({
      name,
      allowed_responsible_ids: resp.value,
      allowed_operation_ids: ops.value,
      allowed_sources: sources.value,
      allow_quick_filters: Boolean(input.allowQuickFilters),
      allow_widget_filters: Boolean(input.allowWidgetFilters),
      refresh_mode: schedule.mode,
      refresh_time: schedule.time,
      refresh_weekday: schedule.weekday,
      next_refresh_at: schedule.nextAt,
      // Período congelado: só muda quando o form pede a substituição (o
      // filtro é aplicado em tempo de consulta — não exige recongelar).
      ...(period.value !== undefined ? { default_period: period.value } : {}),
      // TTL: só muda quando o form envia expiresInDays (undefined = preserva).
      ...(expiry.value !== undefined ? { expires_at: expiry.value } : {}),
    })
    .eq("id", snapshotId);
  if (error) return { ok: false, message: error.message };

  // Restrição mudou → recongela NA HORA (revogar um responsável do snapshot
  // não pode esperar a agenda; o dataset antigo continuaria exposto).
  const restrictionsChanged =
    JSON.stringify(current.allowed_responsible_ids) !==
      JSON.stringify(resp.value) ||
    JSON.stringify(current.allowed_operation_ids) !==
      JSON.stringify(ops.value) ||
    JSON.stringify(current.allowed_sources) !== JSON.stringify(sources.value);
  if (restrictionsChanged) {
    const refreshed = await refreshSnapshot(createServiceClient(), snapshotId);
    if (!refreshed.ok) {
      revalidateSnapshotViews(current.dashboard_id);
      return {
        ok: false,
        message: `Restrições salvas, mas o recongelamento falhou: ${refreshed.error}`,
      };
    }
  }
  revalidateSnapshotViews(current.dashboard_id);
  return { ok: true };
}

// ---------------- Pausar / retomar / atualizar / revogar ----------------

export async function pauseSnapshot(
  snapshotId: string
): Promise<SnapshotActionState> {
  return setSnapshotStatus(snapshotId, "paused");
}

export async function resumeSnapshot(
  snapshotId: string
): Promise<SnapshotActionState> {
  return setSnapshotStatus(snapshotId, "active");
}

async function setSnapshotStatus(
  snapshotId: string,
  status: "active" | "paused"
): Promise<SnapshotActionState> {
  const own = await loadOwnSnapshot(snapshotId);
  if (!own.ok) return { ok: false, message: own.message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("snapshots")
    .update({ status })
    .eq("id", snapshotId);
  if (error) return { ok: false, message: error.message };
  revalidateSnapshotViews(own.snapshot.dashboard_id);
  return { ok: true };
}

export async function refreshSnapshotNow(
  snapshotId: string
): Promise<SnapshotActionState> {
  const own = await loadOwnSnapshot(snapshotId);
  if (!own.ok) return { ok: false, message: own.message };
  const refreshed = await refreshSnapshot(createServiceClient(), snapshotId);
  revalidateSnapshotViews(own.snapshot.dashboard_id);
  if (!refreshed.ok) {
    return { ok: false, message: `Atualização falhou: ${refreshed.error}` };
  }
  return { ok: true };
}

/** Revoga (EXCLUI) um snapshot: o link morre na hora e o dataset congelado é
 *  apagado em cascata. Irreversível. */
export async function revokeSnapshot(
  snapshotId: string
): Promise<SnapshotActionState> {
  const own = await loadOwnSnapshot(snapshotId);
  if (!own.ok) return { ok: false, message: own.message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("snapshots")
    .delete()
    .eq("id", snapshotId);
  if (error) return { ok: false, message: error.message };
  revalidateSnapshotViews(own.snapshot.dashboard_id);
  return { ok: true };
}

// ---------------- Listagens ----------------

export async function listSnapshots(
  dashboardId: string
): Promise<SnapshotListItem[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("snapshots")
    .select(SNAPSHOT_LIST_COLS)
    .eq("dashboard_id", dashboardId)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as SnapshotListItem[];
}

export interface SnapshotWithDashboard extends SnapshotListItem {
  dashboardName: string;
}

/** Todos os snapshots (Configurações → Snapshots; admin). */
export async function listAllSnapshots(): Promise<SnapshotWithDashboard[]> {
  const session = await getSessionInfo();
  if (!session?.roles.includes("admin")) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("snapshots")
    .select(SNAPSHOT_LIST_COLS)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as SnapshotListItem[];
  if (rows.length === 0) return [];
  const dashIds = [...new Set(rows.map((s) => s.dashboard_id))];
  const { data: dashes } = await supabase
    .from("dashboards")
    .select("id, name")
    .in("id", dashIds);
  const nameById = new Map(
    (dashes ?? []).map((d) => [d.id as string, (d.name as string) ?? "—"])
  );
  return rows.map((s) => ({
    ...s,
    dashboardName: nameById.get(s.dashboard_id) ?? "—",
  }));
}

// ---------------- Opções do formulário ----------------

export interface SnapshotFormOptions {
  tabs: { id: string; name: string }[];
  responsibles: { value: string; label: string }[];
  operations: { value: string; label: string }[];
  sources: { value: string; label: string }[];
}

export async function getSnapshotFormOptions(
  dashboardId: string
): Promise<SnapshotFormOptions> {
  const access = await canManageDashboard(dashboardId);
  if (!access.ok) {
    return { tabs: [], responsibles: [], operations: [], sources: [] };
  }
  const supabase = await createClient();
  const [{ data: resp }, { data: ops }, catalog] = await Promise.all([
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
    loadSources(supabase),
  ]);
  return {
    tabs: (access.settings.tabs ?? []).map((t) => ({ id: t.id, name: t.name })),
    responsibles: (resp ?? []).map((r) => ({
      value: r.id as string,
      label: (r.display_name as string) ?? "—",
    })),
    operations: (ops ?? []).map((o) => ({
      value: o.id as string,
      label: (o.name as string) ?? "—",
    })),
    // value = record_type (o que a restrição grava); label = nome da fonte.
    // Escopo de BASES do board (⋮ → "Bases"): a oferta de restrição segue o
    // catálogo efetivo do dashboard (validação em cleanSources segue global —
    // restrição gravada antes do escopo continua válida).
    sources: applySourceScope(catalog, access.settings.sourceScope).map((s) => ({
      value: s.recordType,
      label: s.label,
    })),
  };
}
