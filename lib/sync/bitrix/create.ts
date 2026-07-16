// Versão: 1.0 | Data: 16/07/2026
// Criação SÍNCRONA de uma entidade no Bitrix (crm.lead.add / crm.deal.add),
// usada pela criação manual de registros quando o usuário marca "Criar também
// no Bitrix". Diferente do write-back de edição (fila + tick, best-effort),
// aqui a chamada é síncrona: precisamos do ID retornado para gravar
// records.source_id e deixar o próximo sync ADOTAR a linha (upsert em
// (source_system,source_id)) sem duplicar.
//
// Monta o payload `fields` a partir das colunas do núcleo (DEAL_CORE/LEAD_CORE)
// + campos personalizados de Sync (source_field_id), convertendo cada valor com
// o MESMO `toBitrixValue` do write-back (rótulo→id de enum, boolean→Y/N, etc.),
// a partir do schema vivo (crm.<entity>.fields). Campo que não converte
// (somente-leitura, enum desconhecido) é dropado do payload e devolvido em
// `skippedFields` — o valor ainda é salvo localmente. Etapa/funil (STAGE_ID/
// CATEGORY_ID) são OMITIDOS de propósito (name→id não resolvido); o Bitrix
// aplica os defaults do pipeline.
import { BitrixClient } from "./client";
import { toBitrixValue, WriteBackFatal } from "./writeback";
import type { BitrixFieldMeta } from "./lookups";
import { DEAL_CORE, LEAD_CORE } from "@/lib/config/bitrix-field-map";

interface RawFieldDef {
  type: string;
  title?: string;
  listLabel?: string;
  formLabel?: string;
  isMultiple?: boolean;
  isReadOnly?: boolean;
  items?: { ID: string; VALUE: string }[];
}

export interface BitrixCreateCore {
  title: string | null;
  value: number | null;
  mrr: number | null; // deal-only (UF)
  currency: string | null;
  channel: string | null; // deal-only (UF enum)
  sale_type: string | null; // deal-only (UF enum)
  closed_at: string | null; // deal-only (CLOSEDATE)
  opened_at: string | null; // deal-only (BEGINDATE)
}

export interface BitrixCreateCustom {
  sourceFieldId: string;
  label: string; // rótulo humano (relatório de campos pulados)
  value: unknown;
}

export async function createBitrixEntity(params: {
  entity: "deal" | "lead";
  core: BitrixCreateCore;
  customs: BitrixCreateCustom[];
  assignedBitrixUserId: string | null;
}): Promise<{ sourceId: string; skippedFields: string[] }> {
  const { entity, core, customs, assignedBitrixUserId } = params;
  const client = new BitrixClient();

  // Só o schema de campos (mais barato que o preload completo, que também puxa
  // status/categorias — desnecessário aqui).
  const raw =
    (await client.call<Record<string, RawFieldDef>>(`crm.${entity}.fields`))
      .result ?? {};
  const metas = new Map<string, BitrixFieldMeta>();
  for (const [fieldId, def] of Object.entries(raw)) {
    if (!def || typeof def !== "object") continue;
    metas.set(fieldId, {
      fieldId,
      title: def.title || def.listLabel || def.formLabel || fieldId,
      type: def.type,
      isMultiple: Boolean(def.isMultiple),
      isReadOnly: Boolean(def.isReadOnly),
      items: def.items,
    });
  }

  const map = entity === "deal" ? DEAL_CORE : LEAD_CORE;
  const pairs: { id: string; label: string; value: unknown }[] = [];
  const pushCore = (id: string | undefined, value: unknown) => {
    if (!id || value == null || value === "") return;
    pairs.push({ id, label: metas.get(id)?.title ?? id, value });
  };

  pushCore(map.title, core.title);
  pushCore(map.value, core.value);
  pushCore(map.currency, core.currency);
  if (entity === "deal") {
    pushCore(DEAL_CORE.mrr, core.mrr);
    pushCore(DEAL_CORE.channel, core.channel);
    pushCore(DEAL_CORE.saleType, core.sale_type);
    pushCore(DEAL_CORE.closedAt, core.closed_at);
    pushCore(DEAL_CORE.openedAt, core.opened_at);
  }
  if (assignedBitrixUserId) pushCore(map.assignedById, assignedBitrixUserId);
  for (const c of customs) {
    pairs.push({ id: c.sourceFieldId, label: c.label, value: c.value });
  }

  const fields: Record<string, unknown> = {};
  const skippedFields: string[] = [];
  for (const p of pairs) {
    const meta = metas.get(p.id);
    if (!meta) {
      skippedFields.push(p.label);
      continue;
    }
    try {
      fields[p.id] = toBitrixValue(meta, p.value);
    } catch (e) {
      if (e instanceof WriteBackFatal) {
        skippedFields.push(p.label);
        continue;
      }
      throw e;
    }
  }

  const res = await client.call<number>(`crm.${entity}.add`, { fields });
  if (res.result == null) {
    throw new Error(`Bitrix crm.${entity}.add não retornou um ID.`);
  }
  return { sourceId: String(res.result), skippedFields };
}
