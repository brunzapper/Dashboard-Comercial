// Versão: 1.0 | Data: 17/07/2026
// Catálogo dos tipos de evento de webhook de SAÍDA. Adicionar um tipo novo é
// só estender o array (sem migração — webhook_events.event_type é text e
// webhook_endpoints.event_types é text[]). Quem emite: as server actions de
// registros/tarefas/comentários via emitWebhookEvent (lib/webhooks/emit.ts).
// Sync (lib/sync/*), import e a rota de ingest NÃO emitem — evita tempestade
// de eventos em reconciles e loop entrada→saída entre sistemas.

export const WEBHOOK_EVENT_TYPES = [
  "record.created",
  "record.updated",
  "task.created",
  "task.updated",
  "task.completed",
  "task.deleted",
  "comment.created",
  "comment.updated",
  "comment.deleted",
  "test.ping",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(s: string): s is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(s);
}

// Envelope entregue ao receptor (corpo do POST):
//   { id, type, created_at, data }
// `data` carrega ids + um resumo das mudanças ({field, old_value, new_value}[]
// nos updates) — nunca o dump completo de custom_fields.
export interface WebhookEnvelope {
  id: string;
  type: WebhookEventType;
  created_at: string;
  data: Record<string, unknown>;
}
