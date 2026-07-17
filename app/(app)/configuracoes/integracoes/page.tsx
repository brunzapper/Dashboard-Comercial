// Versão: 1.0 | Data: 17/07/2026
// Configurações → Integrações (admin): gestão de webhooks.
//   - Chaves de API (ENTRADA): sistemas externos empurram dados via
//     POST /api/ingest/<fonte> com Authorization: Bearer dck_...
//   - Endpoints (SAÍDA): URLs https notificadas (com assinatura HMAC) quando
//     registros/tarefas/comentários mudam.
// Leituras aqui usam o client do usuário — a RLS (0074) libera select só p/
// admin; segredos nunca aparecem (o banco guarda hash/ciphertext).
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { ApiKeysManager, type ApiKeyListItem } from "@/components/admin/api-keys-manager";
import {
  WebhookEndpointsManager,
  type EndpointListItem,
} from "@/components/admin/webhook-endpoints-manager";

export default async function IntegracoesPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [sources, keysRes, endpointsRes] = await Promise.all([
    loadSources(supabase),
    supabase
      .from("api_keys")
      .select(
        "id, key_prefix, label, source_key, mapping, last_used_at, revoked_at, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("webhook_endpoints")
      .select(
        "id, name, url, event_types, active, disabled_reason, consecutive_failures, last_success_at, last_failure_at, created_at"
      )
      .order("created_at", { ascending: false }),
  ]);

  const keys: ApiKeyListItem[] = (keysRes.data ?? []).map((k) => ({
    id: k.id as string,
    keyPrefix: k.key_prefix as string,
    label: k.label as string,
    sourceKey: k.source_key as string,
    hasMapping: k.mapping != null,
    lastUsedAt: (k.last_used_at as string | null) ?? null,
    revokedAt: (k.revoked_at as string | null) ?? null,
    createdAt: k.created_at as string,
  }));

  const endpoints: EndpointListItem[] = (endpointsRes.data ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    url: e.url as string,
    eventTypes: (e.event_types as string[] | null) ?? [],
    active: Boolean(e.active),
    disabledReason: (e.disabled_reason as string | null) ?? null,
    consecutiveFailures: (e.consecutive_failures as number) ?? 0,
    lastSuccessAt: (e.last_success_at as string | null) ?? null,
    lastFailureAt: (e.last_failure_at as string | null) ?? null,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Integrações</h1>
        <p className="text-muted-foreground text-sm">
          Conecte sistemas externos via webhooks: chaves de API para RECEBER
          dados (push para /api/ingest) e endpoints para ENVIAR notificações
          assinadas quando registros, tarefas ou comentários mudam. Detalhes e
          exemplos em docs/webhooks.md.
        </p>
      </div>
      <ApiKeysManager keys={keys} sources={sources.map((s) => ({ key: s.key, label: s.label }))} />
      <WebhookEndpointsManager endpoints={endpoints} />
    </div>
  );
}
