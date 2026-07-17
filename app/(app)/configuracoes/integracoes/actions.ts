// Versão: 1.0 | Data: 17/07/2026
// Server Actions de Configurações → Integrações (admin): chaves de API de
// ENTRADA (api_keys — POST /api/ingest/<fonte>) e endpoints de webhook de
// SAÍDA (webhook_endpoints + log de entregas). Leituras com o client do
// usuário (RLS: select só admin); escritas com o service client (as tabelas
// não têm policy de escrita) — o mesmo split de snapshot-actions.ts.
// Segredos: o plaintext (dck_/whsec_) aparece UMA vez, na resposta da action
// de criação — nunca é persistido em claro nem volta em listagens.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadSources } from "@/lib/config/sources";
import { CORE_IMPORT_COLUMNS, type ColumnMapping } from "@/lib/import/csv";
import { generateApiKey, generateWebhookSecret } from "@/lib/integrations/keys";
import { encryptSecret } from "@/lib/crypto/secretbox";
import { isWebhookEventType } from "@/lib/webhooks/events";
import { invalidateEndpointCache } from "@/lib/webhooks/emit";
import { attemptDelivery, validateEndpointUrl } from "@/lib/webhooks/deliver";

export interface ActionState {
  ok?: boolean;
  message?: string;
}

async function ensureAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores." };
  }
  return { ok: true, userId: session.user.id };
}

function revalidate() {
  revalidatePath("/configuracoes/integracoes");
}

// ===================== Chaves de API (entrada) =====================

export interface CreateApiKeyInput {
  label: string;
  sourceKey: string;
  // JSON de ColumnMapping[] (opcional na criação; obrigatório p/ modo rows).
  mappingJson?: string;
  // Colunas (csvColumn) que formam a chave de dedup; vazio = linha inteira.
  dedupColumns?: string[];
}

export interface CreateApiKeyResult extends ActionState {
  // Exibida UMA única vez — o banco guarda só o sha256.
  plaintext?: string;
}

function parseMapping(
  raw: string | undefined
): { ok: true; mapping: ColumnMapping[] | null } | { ok: false; message: string } {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, mapping: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "Mapeamento: JSON inválido." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, message: "Mapeamento: envie um array de colunas." };
  }
  const mapping: ColumnMapping[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, message: "Mapeamento: item inválido." };
    }
    const m = item as Record<string, unknown>;
    const csvColumn = typeof m.csvColumn === "string" ? m.csvColumn.trim() : "";
    const target = typeof m.target === "string" ? m.target.trim() : "";
    if (!csvColumn || !target) {
      return {
        ok: false,
        message: 'Mapeamento: cada item precisa de "csvColumn" e "target".',
      };
    }
    // Mesma whitelist do importCsvChunk (nunca aceitar alvo core arbitrário).
    const valid =
      target === "ignore" ||
      target === "responsible" ||
      (target.startsWith("core:") &&
        CORE_IMPORT_COLUMNS.has(target.slice("core:".length))) ||
      (target.startsWith("custom:") && target.length > "custom:".length);
    if (!valid) {
      return { ok: false, message: `Mapeamento: alvo inválido: ${target}` };
    }
    mapping.push({
      csvColumn,
      target,
      dataType: typeof m.dataType === "string" ? m.dataType : undefined,
    });
  }
  return { ok: true, mapping };
}

export async function createApiKey(
  input: CreateApiKeyInput
): Promise<CreateApiKeyResult> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const label = String(input.label ?? "").trim();
  if (!label) return { ok: false, message: "Informe um nome para a chave." };

  const db = createServiceClient();
  const sources = await loadSources(db);
  const source = sources.find((s) => s.key === input.sourceKey);
  if (!source) return { ok: false, message: "Fonte inválida." };

  const parsed = parseMapping(input.mappingJson);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  // custom:<key> precisa existir (crie os campos antes, no import ou em Fontes).
  if (parsed.mapping) {
    const customKeys = parsed.mapping
      .filter((m) => m.target.startsWith("custom:"))
      .map((m) => m.target.slice("custom:".length));
    if (customKeys.length > 0) {
      const { data: defs } = await db
        .from("field_definitions")
        .select("field_key")
        .in("field_key", customKeys);
      const found = new Set((defs ?? []).map((d) => d.field_key as string));
      const missing = customKeys.filter((k) => !found.has(k));
      if (missing.length > 0) {
        return {
          ok: false,
          message: `Campos inexistentes: ${missing.join(", ")} — crie-os antes (import de CSV ou Fontes).`,
        };
      }
    }
  }

  const dedup = (input.dedupColumns ?? [])
    .map((c) => String(c).trim())
    .filter((c) => c !== "");
  if (dedup.length > 0 && parsed.mapping) {
    const cols = new Set(parsed.mapping.map((m) => m.csvColumn));
    const unknown = dedup.filter((c) => !cols.has(c));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `Colunas de dedup fora do mapeamento: ${unknown.join(", ")}`,
      };
    }
  }

  const key = generateApiKey();
  const { error } = await db.from("api_keys").insert({
    key_hash: key.hash,
    key_prefix: key.prefix,
    label,
    source_key: source.key,
    mapping: parsed.mapping,
    dedup_columns: dedup.length > 0 ? dedup : null,
    created_by: auth.userId,
  });
  if (error) return { ok: false, message: `Falha ao criar: ${error.message}` };

  revalidate();
  return { ok: true, plaintext: key.plaintext };
}

export async function revokeApiKey(id: string): Promise<ActionState> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const db = createServiceClient();
  const { error } = await db
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidate();
  return { ok: true, message: "Chave revogada." };
}

// ===================== Endpoints de webhook (saída) =====================

export interface EndpointInput {
  name: string;
  url: string;
  eventTypes: string[];
}

export interface CreateEndpointResult extends ActionState {
  // Segredo whsec_ exibido UMA vez (o receptor precisa dele p/ verificar a
  // assinatura); no banco fica só o ciphertext.
  secret?: string;
}

function cleanEndpointInput(
  input: EndpointInput
): { ok: true; name: string; url: string; eventTypes: string[] } | { ok: false; message: string } {
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, message: "Informe um nome." };
  const url = String(input.url ?? "").trim();
  const urlError = validateEndpointUrl(url);
  if (urlError) return { ok: false, message: urlError };
  const eventTypes = (input.eventTypes ?? []).filter(isWebhookEventType);
  return { ok: true, name, url, eventTypes };
}

export async function createWebhookEndpoint(
  input: EndpointInput
): Promise<CreateEndpointResult> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const clean = cleanEndpointInput(input);
  if (!clean.ok) return { ok: false, message: clean.message };

  const secret = generateWebhookSecret();
  const db = createServiceClient();
  const { error } = await db.from("webhook_endpoints").insert({
    name: clean.name,
    url: clean.url,
    event_types: clean.eventTypes,
    secret_ciphertext: encryptSecret(secret),
    created_by: auth.userId,
  });
  if (error) return { ok: false, message: `Falha ao criar: ${error.message}` };

  invalidateEndpointCache();
  revalidate();
  return { ok: true, secret };
}

export async function updateWebhookEndpoint(
  id: string,
  input: EndpointInput
): Promise<ActionState> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const clean = cleanEndpointInput(input);
  if (!clean.ok) return { ok: false, message: clean.message };

  const db = createServiceClient();
  const { error } = await db
    .from("webhook_endpoints")
    .update({ name: clean.name, url: clean.url, event_types: clean.eventTypes })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  invalidateEndpointCache();
  revalidate();
  return { ok: true, message: "Endpoint atualizado." };
}

export async function setWebhookEndpointActive(
  id: string,
  active: boolean
): Promise<ActionState> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const db = createServiceClient();
  const { error } = await db
    .from("webhook_endpoints")
    .update(
      active
        ? { active: true, disabled_reason: null, consecutive_failures: 0 }
        : { active: false, disabled_reason: "desativado manualmente" }
    )
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  if (!active) {
    // Entregas pendentes de endpoint inativo nunca mais seriam drenadas.
    await db
      .from("webhook_deliveries")
      .update({ status: "dead", last_error: "endpoint desativado" })
      .eq("endpoint_id", id)
      .eq("status", "pending");
  }
  invalidateEndpointCache();
  revalidate();
  return { ok: true };
}

/** Gera um segredo novo (invalida o anterior). Exibido UMA vez. */
export async function rollWebhookSecret(
  id: string
): Promise<CreateEndpointResult> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const secret = generateWebhookSecret();
  const db = createServiceClient();
  const { error } = await db
    .from("webhook_endpoints")
    .update({ secret_ciphertext: encryptSecret(secret) })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidate();
  return { ok: true, secret };
}

export async function deleteWebhookEndpoint(id: string): Promise<ActionState> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const db = createServiceClient();
  // Cascade apaga as entregas; eventos órfãos saem na retenção do tick.
  const { error } = await db.from("webhook_endpoints").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  invalidateEndpointCache();
  revalidate();
  return { ok: true, message: "Endpoint excluído." };
}

export interface DeliveryListItem {
  id: string;
  event_type: string;
  status: string;
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

/** Últimas 50 entregas do endpoint (leitura via RLS: select só admin). */
export async function listRecentDeliveries(
  endpointId: string
): Promise<DeliveryListItem[]> {
  const auth = await ensureAdmin();
  if (!auth.ok) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("webhook_deliveries")
    .select(
      "id, status, attempts, response_status, last_error, created_at, delivered_at, webhook_events (event_type)"
    )
    .eq("endpoint_id", endpointId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((d) => ({
    id: d.id as string,
    event_type:
      ((d.webhook_events as { event_type?: string } | null)?.event_type as string) ??
      "?",
    status: d.status as string,
    attempts: d.attempts as number,
    response_status: (d.response_status as number | null) ?? null,
    last_error: (d.last_error as string | null) ?? null,
    created_at: d.created_at as string,
    delivered_at: (d.delivered_at as string | null) ?? null,
  }));
}

export interface TestEventResult extends ActionState {
  status?: number;
}

/**
 * Dispara um test.ping INLINE (bypassa cache de emissão e o tick): insere
 * evento + entrega e tenta entregar agora — resultado imediato na UI.
 */
export async function sendTestEvent(endpointId: string): Promise<TestEventResult> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const db = createServiceClient();

  const { data: ep } = await db
    .from("webhook_endpoints")
    .select("id, url, secret_ciphertext, consecutive_failures")
    .eq("id", endpointId)
    .maybeSingle();
  if (!ep) return { ok: false, message: "Endpoint não encontrado." };

  const { data: ev, error: evErr } = await db
    .from("webhook_events")
    .insert({
      event_type: "test.ping",
      payload: { message: "Evento de teste do Dashboard Comercial" },
    })
    .select("id, event_type, payload, created_at")
    .single();
  if (evErr || !ev) return { ok: false, message: evErr?.message ?? "Falha." };

  const { data: delivery, error: dErr } = await db
    .from("webhook_deliveries")
    .insert({ event_id: ev.id, endpoint_id: endpointId })
    .select("id, attempts")
    .single();
  if (dErr || !delivery) return { ok: false, message: dErr?.message ?? "Falha." };

  const outcome = await attemptDelivery(
    db,
    {
      id: delivery.id as string,
      attempts: delivery.attempts as number,
      event: {
        id: ev.id as string,
        event_type: ev.event_type as string,
        payload: ev.payload as Record<string, unknown>,
        created_at: ev.created_at as string,
      },
    },
    {
      id: ep.id as string,
      url: ep.url as string,
      secret_ciphertext: ep.secret_ciphertext as string,
      consecutive_failures: ep.consecutive_failures as number,
    }
  );
  revalidate();
  if (!outcome.ok) {
    return {
      ok: false,
      status: outcome.status,
      message: `Falha na entrega: ${outcome.error ?? "erro"}`,
    };
  }
  return { ok: true, status: outcome.status, message: "Evento entregue." };
}
