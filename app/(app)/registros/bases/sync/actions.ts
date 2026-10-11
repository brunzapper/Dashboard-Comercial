// Versão: 1.0 | Data: 11/10/2026
// Server Actions da TRIAGEM de novas Bases de Sync (Registros → Novas bases de
// Sync, 0155). Fluxo: descobrir os processos inteligentes do portal → avaliar
// a amostra → SOLICITAR → ajustar → APROVAR (cria a Base). Nada vira Base sem a
// aprovação, e a aprovação re-valida o rascunho pelo MESMO parse que a tela usa.
//
// Gate: admin + área `fontes` não negada (a mesma régua das Bases). A RLS de
// `sync_source_requests` (admin da org) e a de `data_sources` são a muralha.
// As chamadas ao Bitrix usam o webhook do servidor — nunca atravessa ao
// cliente.
"use server";

import { redirect } from "next/navigation";

import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createJob } from "@/lib/sync/bitrix/runner";
import { BitrixClient } from "@/lib/sync/bitrix/client";
import { dynamicEntity } from "@/lib/sync/bitrix/entities";
import { BitrixLookups } from "@/lib/sync/bitrix/lookups";
import {
  countSpaItems,
  listSpaTypes,
  loadSpaSchema,
  syncSpaFieldCatalog,
} from "@/lib/sync/bitrix/spa";
import {
  defaultSpaRequestConfig,
  parseSpaRequestConfig,
  requestConfigError,
  toSourceConfig,
  type SpaRequestConfig,
} from "@/lib/sync/bitrix/spa-config";
import { buildSpaPreview, type SpaPreview } from "@/lib/sync/bitrix/spa-preview";
import type {
  SpaCandidate,
  SpaCandidateStatus,
  SpaRequestRow,
  TriageResult,
} from "@/lib/sync/bitrix/spa-triage-types";
import { createServiceClient } from "@/lib/supabase/service";

async function requireTriage() {
  const session = await requireRole("admin");
  if (await isSettingsAreaDenied("fontes")) redirect("/");
  return session;
}

function errMsg(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

/** Solicitações da org (mais recente primeiro). */
async function loadRequests(): Promise<SpaRequestRow[]> {
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  let q = supabase
    .from("sync_source_requests")
    .select("id, entity_type_id, title, status, config, note, source_key, created_at, decided_at")
    .eq("provider", "bitrix_spa")
    .order("created_at", { ascending: false });
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    entityTypeId: Number(r.entity_type_id),
    title: r.title as string,
    status: r.status as SpaCandidateStatus,
    config: parseSpaRequestConfig(r.config, { title: r.title as string }),
    note: (r.note as string | null) ?? null,
    sourceKey: (r.source_key as string | null) ?? null,
    createdAt: r.created_at as string,
    decidedAt: (r.decided_at as string | null) ?? null,
  }));
}

/** Processos do portal com a situação de cada um na triagem. */
export async function listSpaCandidates(): Promise<
  TriageResult<{ candidates: SpaCandidate[]; requests: SpaRequestRow[] }>
> {
  await requireTriage();
  try {
    const client = new BitrixClient();
    const types = await listSpaTypes(client);
    const requests = await loadRequests();
    const supabase = await createClient();
    const { data: bases } = await supabase
      .from("data_sources")
      .select("key, bitrix_entity_type_id")
      .not("bitrix_entity_type_id", "is", null);
    const baseByType = new Map(
      (bases ?? []).map((b) => [Number(b.bitrix_entity_type_id), b.key as string])
    );
    const candidates: SpaCandidate[] = [];
    for (const t of types) {
      // O mais recente decide a situação; Base existente vence tudo.
      const req = requests.find((r) => r.entityTypeId === t.entityTypeId) ?? null;
      const sourceKey = baseByType.get(t.entityTypeId) ?? null;
      candidates.push({
        entityTypeId: t.entityTypeId,
        title: t.title,
        total: await countSpaItems(client, t.entityTypeId),
        status: sourceKey ? "approved" : (req?.status ?? "none"),
        requestId: req?.id ?? null,
        sourceKey,
      });
    }
    return { ok: true, data: { candidates, requests } };
  } catch (e) {
    return { ok: false, message: `Não foi possível ler o Bitrix: ${errMsg(e)}` };
  }
}

/** Fuso das Bases do Bitrix já configuradas (o portal é um só). */
async function bitrixTimezone(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("data_sources")
    .select("timezone")
    .in("record_type", ["lead", "negocio"])
    .not("timezone", "is", null)
    .limit(1);
  return (data?.[0]?.timezone as string | undefined) ?? null;
}

/**
 * Amostra ao vivo de um processo + o rascunho sugerido (quando ainda não há
 * solicitação). Não grava nada.
 */
export async function loadSpaPreview(
  entityTypeId: number,
  categoryIds: string[] = []
): Promise<TriageResult<{ preview: SpaPreview; suggested: SpaRequestConfig }>> {
  await requireTriage();
  if (!Number.isInteger(entityTypeId) || entityTypeId <= 0) {
    return { ok: false, message: "Processo inválido." };
  }
  try {
    const client = new BitrixClient();
    const lookups = new BitrixLookups(client, await createClient());
    await lookups.preload();
    const types = await listSpaTypes(client);
    const type = types.find((t) => t.entityTypeId === entityTypeId);
    if (!type) return { ok: false, message: "Processo não encontrado no portal." };
    const timezone = await bitrixTimezone();
    const preview = await buildSpaPreview(client, lookups, entityTypeId, {
      categoryIds,
      timezone,
    });
    const suggested = defaultSpaRequestConfig(
      type,
      preview.fields
        .filter((f) => !f.technical)
        .map((f) => ({ id: f.id, title: f.title, type: f.type })),
      timezone
    );
    return { ok: true, data: { preview, suggested } };
  } catch (e) {
    return { ok: false, message: `Não foi possível montar a amostra: ${errMsg(e)}` };
  }
}

/** Abre a solicitação (status pendente) com o rascunho atual. */
export async function requestSpaSource(
  entityTypeId: number,
  title: string,
  rawConfig: unknown
): Promise<TriageResult<{ id: string }>> {
  const session = await requireTriage();
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Selecione uma organização." };
  const config = parseSpaRequestConfig(rawConfig, { title });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sync_source_requests")
    .insert({
      organization_id: orgId,
      provider: "bitrix_spa",
      entity_type_id: entityTypeId,
      title: title.slice(0, 200),
      config,
      requested_by: session.user.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Já existe uma solicitação aberta para este processo." };
    }
    return { ok: false, message: `Falha ao solicitar: ${error.message}` };
  }
  return { ok: true, data: { id: data.id as string } };
}

/** Salva os ajustes de uma solicitação PENDENTE. */
export async function saveSpaRequest(
  requestId: string,
  rawConfig: unknown
): Promise<TriageResult<{ config: SpaRequestConfig }>> {
  await requireTriage();
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("sync_source_requests")
    .select("id, title, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { ok: false, message: "Solicitação não encontrada." };
  if (req.status !== "pending") {
    return { ok: false, message: "Só solicitação pendente pode ser ajustada." };
  }
  const config = parseSpaRequestConfig(rawConfig, { title: req.title as string });
  const { error } = await supabase
    .from("sync_source_requests")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  return { ok: true, data: { config } };
}

/** Recusa a solicitação (a Base não é criada; dá para solicitar de novo). */
export async function rejectSpaRequest(
  requestId: string,
  note: string
): Promise<TriageResult<null>> {
  const session = await requireTriage();
  const supabase = await createClient();
  const { error } = await supabase
    .from("sync_source_requests")
    .update({
      status: "rejected",
      note: note.trim().slice(0, 500) || null,
      decided_by: session.user.id,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) return { ok: false, message: `Falha ao recusar: ${error.message}` };
  return { ok: true, data: null };
}

/**
 * APROVA: cria a Base (data_sources com o processo), cataloga os campos
 * escolhidos e dispara a carga. Re-valida o rascunho salvo (nunca o do
 * navegador): quem aprova aprova o que está na solicitação.
 */
export async function approveSpaRequest(
  requestId: string
): Promise<TriageResult<{ sourceKey: string; jobStarted: boolean }>> {
  const session = await requireTriage();
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Selecione uma organização." };
  const supabase = await createClient();
  const { data: req } = await supabase
    .from("sync_source_requests")
    .select("id, entity_type_id, title, status, config")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return { ok: false, message: "Solicitação não encontrada." };
  if (req.status !== "pending") {
    return { ok: false, message: "Esta solicitação já foi decidida." };
  }
  const entityTypeId = Number(req.entity_type_id);
  const config = parseSpaRequestConfig(req.config, { title: req.title as string });
  const invalid = requestConfigError(config);
  if (invalid) return { ok: false, message: invalid };

  // O processo ainda existe? (o schema é necessário para o catálogo)
  const client = new BitrixClient();
  let schema;
  try {
    schema = await loadSpaSchema(client, entityTypeId);
  } catch (e) {
    return { ok: false, message: `Não foi possível ler o processo: ${errMsg(e)}` };
  }

  const { data: dup } = await supabase
    .from("data_sources")
    .select("key")
    .eq("bitrix_entity_type_id", entityTypeId)
    .limit(1);
  if (dup && dup.length > 0) {
    return { ok: false, message: `Este processo já é a Base "${dup[0].key}".` };
  }

  // key/record_type são GLOBAIS: colisão invisível vira sufixo (padrão das Bases).
  let finalKey = config.key;
  let insertError: { code?: string; message: string } | null = null;
  for (let n = 1; n <= 5; n++) {
    if (n > 1) finalKey = `${config.key.slice(0, 37)}_${n}`;
    const { error } = await supabase.from("data_sources").insert({
      key: finalKey,
      record_type: finalKey,
      label: config.label,
      short_label: config.shortLabel || config.label,
      default_period_field: config.periodField,
      builtin: false,
      manual_entry: false,
      timezone: config.timezone,
      bitrix_activity_owner: config.mirrorActivities
        ? dynamicEntity(entityTypeId)
        : null,
      bitrix_entity_type_id: entityTypeId,
      bitrix_spa_config: toSourceConfig(config),
      organization_id: orgId,
    });
    insertError = error;
    if (!error || error.code !== "23505") break;
  }
  if (insertError) {
    return { ok: false, message: `Falha ao criar a Base: ${insertError.message}` };
  }

  // Catálogo dos campos escolhidos (o sync o refresca a cada job).
  try {
    const lookups = new BitrixLookups(client, supabase);
    await lookups.preload();
    await syncSpaFieldCatalog(
      supabase,
      {
        key: finalKey,
        recordType: finalKey,
        label: config.label,
        orgId,
        entityTypeId,
        timezone: config.timezone,
        config: toSourceConfig(config),
        loaded: false,
      },
      schema,
      lookups.sourceNames()
    );
  } catch (e) {
    console.warn("[sync-triagem] catálogo da Base nova falhou:", errMsg(e));
  }

  await supabase
    .from("sync_source_requests")
    .update({
      status: "approved",
      source_key: finalKey,
      decided_by: session.user.id,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  // Carga: job só desta Base. Se outro job estiver rodando, ele é reusado e a
  // carga completa sai no próximo (bitrix_spa_loaded_at segue nulo).
  let jobStarted = false;
  try {
    // sync_jobs é service-role (o mesmo cliente do startSyncJob).
    const { reused } = await createJob(createServiceClient(), "reconcile", 3, "manual", session.user.id, {
      sourceKeys: [finalKey],
    });
    jobStarted = !reused;
  } catch (e) {
    console.warn("[sync-triagem] job de carga não iniciou:", errMsg(e));
  }
  return { ok: true, data: { sourceKey: finalKey, jobStarted } };
}
