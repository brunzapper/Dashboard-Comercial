// Versão: 1.2 | Data: 07/08/2026
// v1.2 (07/08/2026): record.restored — com a Lixeira (0121), record.deleted
//   passa a ser emitido no ENVIO à lixeira (o registro some das leituras);
//   restaurar emite record.restored; a purga definitiva não emite nada.
// v1.1 (27/07/2026): record.deleted — a exclusão em massa do kanban (admin)
//   remove registros de verdade; sem o evento, integrações ficariam cegas.
// Catálogo dos tipos de evento de webhook de SAÍDA. Adicionar um tipo novo é
// só estender o array (sem migração — webhook_events.event_type é text e
// webhook_endpoints.event_types é text[]). Quem emite: as server actions de
// registros/tarefas/comentários via emitWebhookEvent (lib/webhooks/emit.ts).
// Sync (lib/sync/*), import e a rota de ingest NÃO emitem — evita tempestade
// de eventos em reconciles e loop entrada→saída entre sistemas.

export const WEBHOOK_EVENT_TYPES = [
  "record.created",
  "record.updated",
  "record.deleted",
  "record.restored",
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
