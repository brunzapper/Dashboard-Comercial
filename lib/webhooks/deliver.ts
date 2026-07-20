// Versão: 1.1 | Data: 20/07/2026
// v1.1 (20/07/2026): claim atômico no dreno (CAS via next_attempt_at) — ticks
//   sobrepostos não entregam mais a mesma delivery em duplicata.
// Entrega de webhooks de SAÍDA — SÓ NO SERVIDOR (tick e "evento de teste").
// Assinatura estilo Stripe: header x-webhook-signature: t=<unix>,v1=<hmac hex>,
// onde v1 = HMAC-SHA256(secret, `${t}.${corpo}`) — o timestamp assinado mata
// replay (receptor tolera ~300s; snippet de verificação em docs/webhooks.md).
// Retry: backoff exponencial por tentativa; 'dead' após MAX_ATTEMPTS; endpoint
// com AUTO_DISABLE_AFTER falhas consecutivas é desativado (religa na UI).
// SSRF: só https, hostname não-local e DNS resolvendo para IP público — o
// TOCTOU de DNS-rebinding entre o check e o fetch fica como risco ACEITO
// (endpoints são cadastrados só por admin; a Vercel não enxerga rede privada).
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret } from "@/lib/crypto/secretbox";
import type { WebhookEnvelope, WebhookEventType } from "@/lib/webhooks/events";

// Minutos até a próxima tentativa, indexado por (attempts - 1). Depois: dead.
const BACKOFF_MINUTES = [1, 5, 15, 60, 240, 720, 1440];
export const MAX_ATTEMPTS = 8;
export const AUTO_DISABLE_AFTER = 20; // falhas CONSECUTIVAS do endpoint
const REQUEST_TIMEOUT_MS = 10_000;
// Lease do claim atômico do dreno (v1.1) — cobre com folga o timeout de 10s.
const CLAIM_LEASE_MS = 2 * 60_000;

// ============ Assinatura ============

/** HMAC-SHA256 hex de `${ts}.${body}` (o que o receptor deve recomputar). */
export function signBody(secret: string, body: string, ts: number): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

// ============ Guarda SSRF ============

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 (CGNAT)
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  const low = ip.toLowerCase();
  // v4 mapeado em v6 (::ffff:10.0.0.1) cai na regra v4.
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return (
    low === "::" ||
    low === "::1" ||
    low.startsWith("fc") || // fc00::/7 (ULA)
    low.startsWith("fd") ||
    low.startsWith("fe8") || // fe80::/10 (link-local)
    low.startsWith("fe9") ||
    low.startsWith("fea") ||
    low.startsWith("feb")
  );
}

/**
 * Validação de CRIAÇÃO (UI): estrutura da URL, sem resolver DNS.
 * Retorna mensagem de erro ou null se ok.
 */
export function validateEndpointUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "URL inválida.";
  }
  if (url.protocol !== "https:") return "A URL deve usar https.";
  if (url.username || url.password) return "URL não pode conter credenciais.";
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return "Host local não é permitido.";
  }
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0 && isPrivateIp(host.replace(/^\[|\]$/g, ""))) {
    return "IP privado/reservado não é permitido.";
  }
  return null;
}

/** Checagem de DESPACHO: resolve o host e nega IP privado/reservado. Lança. */
async function assertPublicHost(raw: string): Promise<void> {
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) throw new Error("destino em IP privado/reservado");
    return;
  }
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (addrs.length === 0) throw new Error("host não resolve");
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error("destino resolve para IP privado/reservado");
    }
  }
}

// ============ Entrega ============

export interface DeliverableEndpoint {
  id: string;
  url: string;
  secret_ciphertext: string;
  consecutive_failures: number;
}

export interface DeliverableDelivery {
  id: string;
  attempts: number;
  event: {
    id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: string;
  };
}

export interface DeliveryOutcome {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Tenta entregar UMA delivery e persiste o resultado (delivered / pending com
 * backoff / dead) + contadores do endpoint (auto-disable). Não lança.
 */
export async function attemptDelivery(
  db: SupabaseClient,
  delivery: DeliverableDelivery,
  endpoint: DeliverableEndpoint
): Promise<DeliveryOutcome> {
  let status: number | undefined;
  let errorMsg: string | undefined;

  try {
    const secret = decryptSecret(endpoint.secret_ciphertext);
    const envelope: WebhookEnvelope = {
      id: delivery.event.id,
      type: delivery.event.event_type as WebhookEventType,
      created_at: delivery.event.created_at,
      data: delivery.event.payload,
    };
    const body = JSON.stringify(envelope);
    const ts = Math.floor(Date.now() / 1000);

    await assertPublicHost(endpoint.url);
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-id": delivery.event.id,
        "x-webhook-delivery": delivery.id,
        "x-webhook-event": delivery.event.event_type,
        "x-webhook-signature": `t=${ts},v1=${signBody(secret, body, ts)}`,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error", // redirect poderia driblar a guarda SSRF
    });
    status = res.status;
    if (!res.ok) errorMsg = `HTTP ${res.status}`;
  } catch (e) {
    errorMsg = (e as Error).message;
  }

  const now = new Date().toISOString();
  if (!errorMsg) {
    await db
      .from("webhook_deliveries")
      .update({
        status: "delivered",
        attempts: delivery.attempts + 1,
        response_status: status ?? null,
        last_error: null,
        delivered_at: now,
      })
      .eq("id", delivery.id);
    await db
      .from("webhook_endpoints")
      .update({ consecutive_failures: 0, last_success_at: now })
      .eq("id", endpoint.id);
    return { ok: true, status };
  }

  // Falha: agenda retry (backoff) ou mata após MAX_ATTEMPTS.
  const attempts = delivery.attempts + 1;
  const dead = attempts >= MAX_ATTEMPTS;
  const backoffMin = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  await db
    .from("webhook_deliveries")
    .update({
      status: dead ? "dead" : "pending",
      attempts,
      response_status: status ?? null,
      last_error: errorMsg.slice(0, 500),
      next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
    })
    .eq("id", delivery.id);

  const failures = endpoint.consecutive_failures + 1;
  const disable = failures >= AUTO_DISABLE_AFTER;
  await db
    .from("webhook_endpoints")
    .update({
      consecutive_failures: failures,
      last_failure_at: now,
      ...(disable
        ? { active: false, disabled_reason: "auto: falhas consecutivas" }
        : {}),
    })
    .eq("id", endpoint.id);
  if (disable) {
    // Sem endpoint ativo as pendentes nunca mais seriam drenadas — encerra.
    await db
      .from("webhook_deliveries")
      .update({ status: "dead", last_error: "endpoint desativado (falhas consecutivas)" })
      .eq("endpoint_id", endpoint.id)
      .eq("status", "pending");
  }
  return { ok: false, status, error: errorMsg };
}

/**
 * Drena entregas vencidas (status pending, next_attempt_at <= agora, endpoint
 * ativo) até estourar o deadline. Retorna contadores para o log do tick.
 */
export async function drainDeliveries(
  db: SupabaseClient,
  deadline: number
): Promise<{ sent: number; failed: number; dead: number }> {
  const counters = { sent: 0, failed: 0, dead: 0 };
  const BATCH = 25;

  while (Date.now() < deadline) {
    const { data: due, error } = await db
      .from("webhook_deliveries")
      .select(
        `id, attempts, status,
         webhook_events!inner (id, event_type, payload, created_at),
         webhook_endpoints!inner (id, url, secret_ciphertext, consecutive_failures, active)`
      )
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .eq("webhook_endpoints.active", true)
      .order("next_attempt_at", { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    if (!due || due.length === 0) break;

    for (const row of due) {
      if (Date.now() >= deadline) return counters;
      const ev = row.webhook_events as unknown as DeliverableDelivery["event"];
      const ep = row.webhook_endpoints as unknown as DeliverableEndpoint & {
        active: boolean;
      };
      if (!ep.active) continue; // desativado por uma entrega anterior do lote
      // v20/07/2026: claim atômico — dois ticks sobrepostos selecionavam as
      // MESMAS entregas e entregavam o webhook em duplicata. O claim empurra
      // next_attempt_at um lease à frente SÓ se a entrega ainda está vencida e
      // pendente; quem perde pula. Crash pós-claim: a entrega volta sozinha
      // quando o lease vence (sem contar attempt).
      const { data: claimed } = await db
        .from("webhook_deliveries")
        .update({
          next_attempt_at: new Date(Date.now() + CLAIM_LEASE_MS).toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "pending")
        .lte("next_attempt_at", new Date().toISOString())
        .select("id");
      if (!claimed || claimed.length === 0) continue;
      const outcome = await attemptDelivery(
        db,
        { id: row.id as string, attempts: row.attempts as number, event: ev },
        ep
      );
      if (outcome.ok) counters.sent += 1;
      else if ((row.attempts as number) + 1 >= MAX_ATTEMPTS) counters.dead += 1;
      else counters.failed += 1;
    }
    if (due.length < BATCH) break; // fila esvaziou; falhas re-agendadas ficam p/ o próximo tick
  }
  return counters;
}
