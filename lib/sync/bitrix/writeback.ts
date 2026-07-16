// Versão: 1.0 | Data: 11/07/2026
// Write-back configurável para o Bitrix (fila em background). Ao editar um campo
// marcado (field_definitions.write_back), a edição salva no Supabase e uma linha
// 'pending' entra em bitrix_writeback_queue (enqueueWriteBacks). O tick agendado
// drena a fila (drainWritebackQueue): converte o valor DE VOLTA para o formato do
// Bitrix (o mapper guarda rótulos/números resolvidos, não ids) e chama
// crm.deal/lead.update. A edição local nunca é perdida por falha do Bitrix — o
// erro fica registrado (last_error/attempts) e vira 'error' após MAX_ATTEMPTS.
//
// Colisão read/write: após o write-back OK, o valor local == Bitrix, então o
// próximo reconcile adota o valor do Bitrix (idempotente). isProtected preserva a
// edição local até lá — nenhuma limpeza extra de field_modified_at é necessária.
import type { SupabaseClient } from "@supabase/supabase-js";

import { BitrixClient } from "./client";
import { BitrixLookups, type BitrixFieldMeta } from "./lookups";

const BATCH = 25;
const MAX_ATTEMPTS = 5;

export type WriteBackEntity = "deal" | "lead";

export interface WriteBackChange {
  fieldKey: string;
  sourceFieldId: string;
  label: string | null;
  newValue: unknown;
}

/** Insere linhas 'pending' na fila (uma por campo alterado com write_back). */
export async function enqueueWriteBacks(
  db: SupabaseClient,
  params: {
    recordId: string;
    entity: WriteBackEntity;
    sourceId: string;
    createdBy: string | null;
    changes: WriteBackChange[];
  }
): Promise<void> {
  if (params.changes.length === 0) return;
  await db.from("bitrix_writeback_queue").insert(
    params.changes.map((c) => ({
      record_id: params.recordId,
      entity: params.entity,
      source_id: params.sourceId,
      field_key: c.fieldKey,
      source_field_id: c.sourceFieldId,
      label: c.label,
      new_value: c.newValue ?? null,
      status: "pending" as const,
      created_by: params.createdBy,
    }))
  );
}

interface QueueRow {
  id: string;
  entity: WriteBackEntity;
  source_id: string;
  field_key: string;
  source_field_id: string;
  new_value: unknown;
  attempts: number;
}

// Erro de conversão que NÃO se resolve com retentativa (ex.: campo somente-leitura
// no Bitrix, ou rótulo de enum inexistente) — marca 'error' direto. Exportado
// para o fluxo de CRIAÇÃO (lib/sync/bitrix/create.ts) distinguir campos que devem
// ser pulados do payload de crm.*.add.
export class WriteBackFatal extends Error {}

// Converte o valor armazenado no record DE VOLTA para o formato que o Bitrix
// espera, usando o tipo do campo (crm.*.fields). O mapper resolve ids→rótulos na
// leitura; aqui fazemos o caminho inverso. Exportado para reuso na criação de
// entidades (crm.*.add), que monta o mesmo payload de `fields`.
export function toBitrixValue(meta: BitrixFieldMeta, value: unknown): unknown {
  if (meta.isReadOnly) {
    throw new WriteBackFatal(`Campo ${meta.fieldId} é somente-leitura no Bitrix.`);
  }
  if (value == null || value === "") return "";

  switch (meta.type) {
    case "enumeration": {
      const labelToId = new Map(
        (meta.items ?? []).map((i) => [i.VALUE, i.ID] as const)
      );
      const one = (label: string): string => {
        const id = labelToId.get(label);
        if (id == null) {
          throw new WriteBackFatal(
            `Opção "${label}" não existe no campo ${meta.fieldId} do Bitrix.`
          );
        }
        return id;
      };
      if (meta.isMultiple) {
        const labels = Array.isArray(value)
          ? (value as unknown[]).map(String)
          : String(value).split(",").map((s) => s.trim()).filter(Boolean);
        return labels.map(one);
      }
      return one(String(value));
    }
    case "boolean":
      return value === true || value === "Y" || value === "true" ? "Y" : "N";
    case "money":
      // Bitrix aceita o número puro (usa a moeda base do campo/negócio).
      return String(value);
    case "date":
    case "datetime":
      return String(value);
    default:
      return typeof value === "number" ? value : String(value);
  }
}

/**
 * Drena a fila de write-back respeitando um orçamento de tempo (deadline, ms
 * epoch). Retorna { done, errors } dos itens processados nesta passada.
 */
export async function drainWritebackQueue(
  db: SupabaseClient,
  deadline: number
): Promise<{ done: number; errors: number }> {
  const { data } = await db
    .from("bitrix_writeback_queue")
    .select("id, entity, source_id, field_key, source_field_id, new_value, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH);
  const rows = (data ?? []) as QueueRow[];
  if (rows.length === 0) return { done: 0, errors: 0 };

  const client = new BitrixClient();
  const lookups = new BitrixLookups(client, db);
  await lookups.preload();
  const metaByEntity: Record<WriteBackEntity, Map<string, BitrixFieldMeta>> = {
    deal: new Map(lookups.dealFieldMetas().map((m) => [m.fieldId, m])),
    lead: new Map(lookups.leadFieldMetas().map((m) => [m.fieldId, m])),
  };

  let done = 0;
  let errors = 0;
  const now = () => new Date().toISOString();

  for (const row of rows) {
    if (Date.now() >= deadline) break;

    try {
      const meta = metaByEntity[row.entity].get(row.source_field_id);
      if (!meta) {
        throw new WriteBackFatal(
          `Campo ${row.source_field_id} não existe no schema de ${row.entity} do Bitrix.`
        );
      }
      const bitrixValue = toBitrixValue(meta, row.new_value);
      const method = row.entity === "deal" ? "crm.deal.update" : "crm.lead.update";
      await client.call(method, {
        id: row.source_id,
        fields: { [row.source_field_id]: bitrixValue },
      });
      await db
        .from("bitrix_writeback_queue")
        .update({ status: "done", processed_at: now(), last_error: null })
        .eq("id", row.id);
      done += 1;
    } catch (e) {
      const msg = (e as Error).message;
      const attempts = row.attempts + 1;
      // Erro fatal (conversão/somente-leitura): não adianta repetir.
      const terminal = e instanceof WriteBackFatal || attempts >= MAX_ATTEMPTS;
      await db
        .from("bitrix_writeback_queue")
        .update({
          attempts,
          last_error: msg,
          status: terminal ? "error" : "pending",
          processed_at: terminal ? now() : null,
        })
        .eq("id", row.id);
      errors += 1;
    }
  }

  return { done, errors };
}
