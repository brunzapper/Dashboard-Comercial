// Versão: 1.0 | Data: 11/10/2026
// VOCABULÁRIO ÚNICO DAS ENTIDADES DO BITRIX (0155).
//
// Até a 0154 o sync só conhecia duas entidades — lead e negócio — e cada
// módulo carregava a sua própria tabela `"deal" | "lead"` (OWNER_TYPE_ID do
// espelho, método de update do write-back, caminho do link, ENTITY_TYPE da
// timeline). Os Processos Inteligentes (Smart Process Automation, `crm.item.*`)
// trazem uma TERCEIRA família, aberta — uma por processo criado no portal —,
// e com ela a tabela fixa deixa de caber. Este módulo é o dono único das
// traduções; consumidor novo NUNCA monta `crm.deal.update`/`OWNER_TYPE_ID: 2`
// à mão.
//
// IDENTIDADE (o ponto delicado): `uq_records_source (source_system, source_id)`
// só distingue registros pelo par. O ID de um item de processo inteligente
// recomeça em 1 em CADA processo — gravá-lo cru faria o item 5 de um processo
// sobrescrever o lead/negócio 5. Por isso o `source_id` de item SPA é
// PREFIXADO pelo tipo (`"<entityTypeId>:<id>"`) e o ID cru só existe na
// fronteira com o Bitrix (`nativeIdOf`/`sourceIdOf`). Lead e negócio seguem
// com o ID cru, byte-idêntico ao que já está gravado.
//
// Módulo PURO (client-safe): a tela de Bases e o formulário de tarefa usam os
// rótulos sem ida ao servidor.

/** Entidade do CRM: os dois clássicos ou um processo inteligente. */
export type BitrixEntity = "lead" | "deal" | `dynamic_${number}`;

const DYNAMIC_RE = /^dynamic_([1-9][0-9]*)$/;

/** Os OWNER_TYPE_ID fixos do Bitrix. Processo inteligente usa o próprio entityTypeId. */
const CLASSIC_TYPE_ID: Record<"lead" | "deal", number> = { lead: 1, deal: 2 };

/** Valida e normaliza um valor vindo do banco/form. null = não é entidade. */
export function parseBitrixEntity(raw: unknown): BitrixEntity | null {
  if (raw === "lead" || raw === "deal") return raw;
  if (typeof raw !== "string") return null;
  const m = DYNAMIC_RE.exec(raw.trim());
  return m ? (`dynamic_${Number(m[1])}` as BitrixEntity) : null;
}

/** A entidade de um processo inteligente pelo entityTypeId. */
export function dynamicEntity(entityTypeId: number): BitrixEntity {
  return `dynamic_${Math.trunc(entityTypeId)}` as BitrixEntity;
}

/** entityTypeId de um processo inteligente; null para lead/negócio. */
export function spaTypeIdOf(entity: BitrixEntity): number | null {
  const m = DYNAMIC_RE.exec(entity);
  return m ? Number(m[1]) : null;
}

export function isDynamicEntity(entity: BitrixEntity): boolean {
  return spaTypeIdOf(entity) != null;
}

/** OWNER_TYPE_ID do `crm.activity.*` (e de `crm.item.*`: entityTypeId). */
export function ownerTypeIdOf(entity: BitrixEntity): number {
  const spa = spaTypeIdOf(entity);
  return spa ?? CLASSIC_TYPE_ID[entity as "lead" | "deal"];
}

/**
 * Inverso de `ownerTypeIdOf`, restrito às entidades CONHECIDAS — um
 * OWNER_TYPE_ID de contato/empresa/fatura não pode virar dono de nada aqui.
 */
export function entityOfOwnerTypeId(
  typeId: unknown,
  known: Iterable<BitrixEntity>
): BitrixEntity | null {
  const n = Number(typeId);
  if (!Number.isFinite(n)) return null;
  for (const e of known) if (ownerTypeIdOf(e) === n) return e;
  return null;
}

/** ENTITY_TYPE da timeline (`crm.timeline.comment.*`). */
export function timelineEntityType(entity: BitrixEntity): string {
  // O Bitrix aceita "lead"/"deal" e, para processo inteligente,
  // "dynamic_<entityTypeId>" — a mesma grafia da nossa entidade.
  return entity;
}

/** Caminho do cartão no portal (sem a origem). */
export function detailsPath(entity: BitrixEntity, nativeId: string): string {
  const spa = spaTypeIdOf(entity);
  if (spa != null) return `/crm/type/${spa}/details/${nativeId}/`;
  return `/crm/${entity}/details/${nativeId}/`;
}

/** `records.source_id` de um item de processo inteligente. */
export function spaSourceId(entityTypeId: number, nativeId: string | number): string {
  return `${Math.trunc(entityTypeId)}:${String(nativeId)}`;
}

/**
 * ID nativo do Bitrix a partir do `records.source_id`. Lead/negócio: o próprio
 * valor. Processo inteligente: tira o prefixo — e devolve null se o prefixo não
 * for o do tipo esperado (um source_id de outro processo nunca vira OWNER_ID).
 */
export function nativeIdOf(entity: BitrixEntity, sourceId: string): string | null {
  const spa = spaTypeIdOf(entity);
  if (spa == null) return sourceId;
  const prefix = `${spa}:`;
  if (!sourceId.startsWith(prefix)) return null;
  const rest = sourceId.slice(prefix.length);
  return rest === "" ? null : rest;
}

/** Inverso de `nativeIdOf`: o ID vindo do Bitrix → `records.source_id`. */
export function sourceIdOf(entity: BitrixEntity, nativeId: string | number): string {
  const spa = spaTypeIdOf(entity);
  return spa == null ? String(nativeId) : spaSourceId(spa, nativeId);
}

/** Rótulo curto para a UI ("Lead", "Negócio", "Processo #1036"). */
export function bitrixEntityLabel(entity: BitrixEntity, spaTitle?: string | null): string {
  if (entity === "lead") return "Lead";
  if (entity === "deal") return "Negócio";
  return spaTitle?.trim() || `Processo #${spaTypeIdOf(entity)}`;
}
