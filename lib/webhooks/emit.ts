// Versão: 1.0 | Data: 17/07/2026
// Emissão de eventos de webhook de SAÍDA (outbox, padrão da 0032): insere o
// evento + uma entrega 'pending' por endpoint ativo que casa o tipo; o tick
// (/api/webhooks/tick) entrega com retry/backoff. GARANTIA: esta função NUNCA
// lança — falha aqui não pode derrubar a action que salvou o dado do usuário.
// Endpoints são cacheados por 30s por instância (serverless warm): mudanças na
// UI valem em ≤30s na emissão (o botão "evento de teste" bypassa o cache).
import { createServiceClient } from "@/lib/supabase/service";
import type { WebhookEventType } from "@/lib/webhooks/events";

interface CachedEndpoint {
  id: string;
  event_types: string[];
}

const CACHE_TTL_MS = 30_000;
// ISOLAMENTO multi-org (0090): o cache é POR organização — endpoints de uma org
// nunca podem receber o payload de um registro de outra. A chave "" cobre o
// caminho legado/single-tenant (organizationId ausente = todos os endpoints).
const endpointCache = new Map<string, { at: number; endpoints: CachedEndpoint[] }>();

async function loadActiveEndpoints(
  db: ReturnType<typeof createServiceClient>,
  organizationId: string | null
): Promise<CachedEndpoint[]> {
  const key = organizationId ?? "";
  const now = Date.now();
  const cached = endpointCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.endpoints;
  }
  let query = db.from("webhook_endpoints").select("id, event_types").eq("active", true);
  // Sem org (pré-migração/single-tenant) mantém o comportamento antigo; com org,
  // recorta os endpoints da própria org.
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const endpoints = (data ?? []).map((e) => ({
    id: e.id as string,
    event_types: (e.event_types as string[] | null) ?? [],
  }));
  endpointCache.set(key, { at: now, endpoints });
  return endpoints;
}

/** Invalida o cache (usado pelas actions de Integrações após criar/editar). */
export function invalidateEndpointCache(): void {
  endpointCache.clear();
}

/**
 * Emite um evento de webhook. Fire-and-forget do ponto de vista da action
 * chamadora (nunca lança), mas os inserts são aguardados — em serverless a
 * lambda pode congelar antes de um write realmente "solto" chegar ao banco.
 */
export async function emitWebhookEvent(
  type: WebhookEventType,
  data: Record<string, unknown>,
  organizationId: string | null = null
): Promise<void> {
  try {
    const db = createServiceClient();
    const endpoints = await loadActiveEndpoints(db, organizationId);
    const matching = endpoints.filter(
      (e) => e.event_types.length === 0 || e.event_types.includes(type)
    );
    if (matching.length === 0) return; // sem destino: não acumula evento morto

    const { data: ev, error } = await db
      .from("webhook_events")
      .insert({
        event_type: type,
        payload: data,
        // Carimbo de org (0090): o insert é via service role (bypassa a RLS) —
        // sem o carimbo o evento nasceria na org default (Zapper).
        ...(organizationId ? { organization_id: organizationId } : {}),
      })
      .select("id")
      .single();
    if (error || !ev) return;

    await db.from("webhook_deliveries").insert(
      matching.map((m) => ({
        event_id: ev.id as string,
        endpoint_id: m.id,
      }))
    );
  } catch {
    /* nunca quebra a action chamadora. */
  }
}
