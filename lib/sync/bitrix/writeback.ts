// Versão: 1.1 | Data: 08/09/2026
// v1.1 (08/09/2026): toBitrixValue passa a converter o tipo `crm_status`
//   (SOURCE_ID, STATUS_ID) de RÓTULO para CÓDIGO. Antes esses campos caíam no
//   `default:` e viajavam como texto — o Bitrix espera "UC_EN7PZM", não
//   "CEO-Led Outbound", e a gravação era silenciosamente ignorada/errada. O
//   mapa rótulo→código é OPCIONAL (3º parâmetro): sem ele o comportamento fica
//   byte-idêntico ao da v1.0, então nenhum call site existente muda. Quem tem
//   o mapa: o drain (que já dá preload nos lookups) e o executor de Workflow
//   (0125), que o lê do cache `bitrix_status_codes` em sync_config.
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

/**
 * Mapa rótulo→código dos campos `crm_status` (v1.1). Uma entrada por família,
 * porque o mesmo código ("NEW") existe em famílias diferentes: `sources` são as
 * origens (SOURCE_ID de lead e deal), `leadStatuses` as etapas de lead
 * (STATUS_ID) e `dealStages` as etapas de negócio (STAGE_ID).
 */
export interface BitrixStatusCodes {
  sources?: Record<string, string>;
  leadStatuses?: Record<string, string>;
  dealStages?: Record<string, string>;
}

/** Família de `crm_status` a que um fieldId pertence. O schema do Bitrix diz o
 *  TIPO (crm_status) mas não a família, e o campo é sempre um destes três. */
function statusFamilyOf(
  fieldId: string
): keyof BitrixStatusCodes | null {
  if (fieldId === "SOURCE_ID") return "sources";
  if (fieldId === "STATUS_ID") return "leadStatuses";
  if (fieldId === "STAGE_ID") return "dealStages";
  return null;
}

// Converte o valor armazenado no record DE VOLTA para o formato que o Bitrix
// espera, usando o tipo do campo (crm.*.fields). O mapper resolve ids→rótulos na
// leitura; aqui fazemos o caminho inverso. Exportado para reuso na criação de
// entidades (crm.*.add), que monta o mesmo payload de `fields`.
// v1.1 (08/09/2026): `statusCodes` é OPCIONAL — ausente, `crm_status` degrada
// para o comportamento da v1.0 (manda a string como veio).
export function toBitrixValue(
  meta: BitrixFieldMeta,
  value: unknown,
  statusCodes?: BitrixStatusCodes
): unknown {
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
    // v1.1 (08/09/2026): SOURCE_ID/STATUS_ID/STAGE_ID. O record guarda o RÓTULO
    // (o mapper resolveu na leitura via crm.status.list); o Bitrix quer o
    // código. Valor que JÁ é um código conhecido passa direto — é o caso de um
    // esquema de Workflow que fixou "NEW" na definição.
    case "crm_status": {
      const family = statusFamilyOf(meta.fieldId);
      const map = family ? statusCodes?.[family] : undefined;
      if (!map) return String(value); // sem mapa: degrada como na v1.0
      const label = String(value);
      const code = map[label];
      if (code != null) return code;
      if (Object.values(map).includes(label)) return label;
      throw new WriteBackFatal(
        `Opção "${label}" não existe no campo ${meta.fieldId} do Bitrix.`
      );
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
  const statusCodes = lookups.statusCodes(); // v1.1 (08/09/2026)
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
      // v1.1 (08/09/2026): o drain já deu preload nos lookups — passa o mapa
      // rótulo→código para SOURCE_ID/STATUS_ID/STAGE_ID chegarem certos.
      const bitrixValue = toBitrixValue(meta, row.new_value, statusCodes);
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
