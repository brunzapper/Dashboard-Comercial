// Versão: 1.1 | Data: 11/10/2026
// v1.1 (11/10/2026): entidades de PROCESSO INTELIGENTE (`dynamic_<id>`, 0155)
//   entram pelos mesmos helpers de ./entities (OWNER_TYPE_ID e o `source_id`
//   prefixado do item SPA). E o cursor passou a lembrar QUAIS tipos de dono ele
//   já varreu (`typeIds`): Base que liga o espelho DEPOIS (o lead, um processo
//   recém-aprovado) reinicia a varredura da fase 1 — sem isso o cursor já
//   estaria no incremental e as pendentes antigas dela nunca entrariam.
//   Reprocessar os tipos antigos é idempotente (a tarefa conhecida só concilia).
// v1.0 (11/10/2026): DESCOBERTA das atividades do Bitrix em TODOS os registros.
//
// Por que existe. A conciliação por dono (`activity-inbound.ts`) só lê quem JÁ
// tem algo aqui — tarefa espelhada aberta ou Tree ativo. Um negócio cuja
// atividade nasceu lá (automação do Bitrix) e que nunca teve tarefa aqui nunca
// era lido, e o filtro "Tem tarefa" voltava vazio para ele. Este módulo é a
// porta de entrada desses registros: varre `crm.activity.list` por entidade
// (negócio/lead das Bases que espelham), sem lista de donos, e importa.
//
// COMO, em três fases persistidas em `sync_config` (`bitrix_activity_discovery`,
// por org — o portal é um só e o cursor sobrevive entre ticks):
//   1. `pending`  — todas as PENDENTES (COMPLETED=N), de qualquer idade, por ID
//                   crescente (`>ID` retoma onde o tick anterior parou);
//   2. `done`     — as CONCLUÍDAS com LAST_UPDATED nos últimos
//                   `IMPORT_DONE_LOOKBACK_DAYS` (entram somente leitura);
//   3. `incremental` — daí em diante só o que MUDOU (`>=LAST_UPDATED` desde o
//                   início da fase 1, depois desde o último visto). Concluir lá
//                   mexe no LAST_UPDATED da atividade, então a conclusão chega
//                   por aqui mesmo em dono que a conciliação não alcançou.
// A EXCLUSÃO não é detectável aqui (a apagada some sem emitir nada): ela segue
// com a conciliação por dono, que relê a lista COMPLETA de quem tem tarefa
// aberta espelhada — e todo registro importado aqui com pendente passa a ser
// dono dela automaticamente (`activity_inbound_owners`).
//
// Regras REUSADAS do módulo irmão, nunca copiadas: `shouldImportActivity`
// (pendente sempre; concluída só na janela), `createTaskFromActivity`
// (somente leitura quando concluída) e `syncKnownTaskState` (conclusão de lá).
// Service role com a org do PRÓPRIO registro. Best-effort: falha do portal não
// derruba o tick, e o cursor só avança pelo que foi processado.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MirrorOwnerEntity } from "@/lib/tasks/mirror-config";

import {
  ACTIVITY_SELECT,
  createTaskFromActivity,
  IMPORT_DONE_LOOKBACK_DAYS,
  shouldImportActivity,
  syncKnownTaskState,
  type BitrixActivity,
} from "./activity-inbound";
import { BitrixClient } from "./client";
import { ownerTypeIdOf, parseBitrixEntity, sourceIdOf } from "./entities";
import type { BitrixCallable } from "./task-mirror";

export const DISCOVERY_CONFIG_KEY = "bitrix_activity_discovery";

/** Teto de páginas (50 itens cada) por chamada — o resto fica p/ o próximo tick. */
const MAX_PAGES_PER_RUN = 10;

export type DiscoveryPhase = "pending" | "done" | "incremental";

export interface DiscoveryState {
  phase: DiscoveryPhase;
  /** Fases 1 e 2: último ID processado (retomada por `>ID`). */
  lastId?: string;
  /** Início da fase 1 — base da janela das concluídas e do incremental. */
  startedAt?: string;
  /** Fase 3: maior LAST_UPDATED já processado (filtro `>=`, inclusivo). */
  since?: string;
  /** v1.1: OWNER_TYPE_IDs que esta varredura cobre (ausente = legado). */
  typeIds?: number[];
}

/**
 * v1.1: o cursor serve para os tipos de dono atuais? Tipo NOVO ⇒ recomeça a
 * fase 1 (PURO — o teste pina). Estado legado sem `typeIds` cobria negócio e
 * lead que estivessem ligados; recomeçar uma vez é seguro e idempotente.
 */
export function reconcileDiscoveryTypes(
  state: DiscoveryState,
  typeIds: number[],
  nowIso: string
): DiscoveryState {
  const covered = new Set(state.typeIds ?? []);
  const sorted = [...new Set(typeIds)].sort((a, b) => a - b);
  if (state.typeIds && sorted.every((t) => covered.has(t))) {
    return { ...state, typeIds: sorted };
  }
  if (!state.typeIds && !state.startedAt) {
    return { ...state, typeIds: sorted };
  }
  return { phase: "pending", startedAt: nowIso, typeIds: sorted };
}

export interface DiscoveryResult {
  seen: number;
  created: number;
  completed: number;
  reopened: number;
  phase: DiscoveryPhase;
}

/** Estado lido do `sync_config`; inválido/ausente = começa da fase 1. */
export function parseDiscoveryState(raw: unknown): DiscoveryState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const phase =
    o.phase === "done" || o.phase === "incremental" ? o.phase : "pending";
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const typeIds = Array.isArray(o.typeIds)
    ? o.typeIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : undefined;
  return {
    phase,
    lastId: str(o.lastId),
    startedAt: str(o.startedAt),
    since: str(o.since),
    ...(typeIds ? { typeIds } : {}),
  };
}

/** O filtro do Bitrix de uma fase (PURO — o teste pina as três formas). */
export function discoveryFilter(
  state: DiscoveryState,
  ownerTypeIds: number[],
  nowMs: number = Date.now()
): { filter: Record<string, unknown>; order: Record<string, string> } {
  const base: Record<string, unknown> = { "@OWNER_TYPE_ID": ownerTypeIds };
  if (state.phase === "pending") {
    return {
      filter: { ...base, COMPLETED: "N", ...(state.lastId ? { ">ID": state.lastId } : {}) },
      order: { ID: "ASC" },
    };
  }
  if (state.phase === "done") {
    const anchor = Date.parse(state.startedAt ?? "");
    const from = new Date(
      (Number.isFinite(anchor) ? anchor : nowMs) -
        IMPORT_DONE_LOOKBACK_DAYS * 86_400_000
    ).toISOString();
    return {
      filter: {
        ...base,
        COMPLETED: "Y",
        ">=LAST_UPDATED": from,
        ...(state.lastId ? { ">ID": state.lastId } : {}),
      },
      order: { ID: "ASC" },
    };
  }
  return {
    filter: {
      ...base,
      ">=LAST_UPDATED": state.since ?? state.startedAt ?? new Date(nowMs).toISOString(),
    },
    order: { LAST_UPDATED: "ASC", ID: "ASC" },
  };
}

interface RecordRef {
  recordId: string;
  orgId: string;
}

/**
 * Uma rodada. Lê no máximo `MAX_PAGES_PER_RUN` páginas dentro do `deadline`,
 * processa cada atividade e grava o cursor. Fase concluída numa rodada passa à
 * próxima já na rodada seguinte.
 */
export async function discoverBitrixActivities(
  db: SupabaseClient,
  deadline: number,
  client?: BitrixCallable
): Promise<DiscoveryResult | null> {
  // As Bases que espelham: entidade do CRM → record_types dela, e a org.
  const { data: sources } = await db
    .from("data_sources")
    .select("record_type, bitrix_activity_owner, organization_id")
    .not("bitrix_activity_owner", "is", null);
  const typesByEntity = new Map<MirrorOwnerEntity, string[]>();
  let orgId: string | null = null;
  for (const s of sources ?? []) {
    const e = parseBitrixEntity(s.bitrix_activity_owner);
    if (!e) continue;
    typesByEntity.set(e, [...(typesByEntity.get(e) ?? []), s.record_type as string]);
    orgId = orgId ?? ((s.organization_id as string | null) ?? null);
  }
  if (typesByEntity.size === 0 || !orgId) return null;
  const entityByTypeId = new Map<number, MirrorOwnerEntity>(
    [...typesByEntity.keys()].map((e) => [ownerTypeIdOf(e), e])
  );

  const { data: cfg } = await db
    .from("sync_config")
    .select("value")
    .eq("key", DISCOVERY_CONFIG_KEY)
    .eq("organization_id", orgId)
    .maybeSingle();
  const nowIso = new Date().toISOString();
  let state = reconcileDiscoveryTypes(
    parseDiscoveryState(cfg?.value),
    [...entityByTypeId.keys()],
    nowIso
  );
  if (!state.startedAt) state = { ...state, startedAt: nowIso };

  const api: BitrixCallable = client ?? new BitrixClient();
  const res: DiscoveryResult = {
    seen: 0,
    created: 0,
    completed: 0,
    reopened: 0,
    phase: state.phase,
  };

  let start = 0;
  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    if (Date.now() >= deadline) break;
    const { filter, order } = discoveryFilter(state, [...entityByTypeId.keys()]);
    const out = (await api.call<BitrixActivity[]>("crm.activity.list", {
      filter,
      select: ACTIVITY_SELECT,
      order,
      start: state.phase === "incremental" ? start : 0,
    })) as { result: BitrixActivity[]; next?: number };
    const items = out.result ?? [];
    res.seen += items.length;

    const whole = await processPage(db, items, entityByTypeId, typesByEntity, res, deadline);
    // Página interrompida pelo orçamento: o cursor NÃO anda (a rodada seguinte
    // relê a página inteira — reprocessar é idempotente, pular não seria).
    if (!whole) break;

    // Avança o cursor só pelo que foi PROCESSADO.
    if (state.phase === "incremental") {
      const maxUpdated = items
        .map((a) => String(a.LAST_UPDATED ?? ""))
        .filter(Boolean)
        .sort()
        .pop();
      if (maxUpdated) state = { ...state, since: maxUpdated };
      if (typeof out.next !== "number") break;
      start = out.next;
      continue;
    }
    const lastId = items.length > 0 ? String(items[items.length - 1].ID) : undefined;
    if (lastId) state = { ...state, lastId };
    if (typeof out.next !== "number") {
      // Fim da fase: pendentes → concluídas recentes → incremental.
      state =
        state.phase === "pending"
          ? { phase: "done", startedAt: state.startedAt, typeIds: state.typeIds }
          : {
              phase: "incremental",
              startedAt: state.startedAt,
              since: state.startedAt,
              typeIds: state.typeIds,
            };
      break;
    }
  }

  await db.from("sync_config").upsert(
    { key: DISCOVERY_CONFIG_KEY, value: state, organization_id: orgId },
    { onConflict: "organization_id,key" }
  );
  res.phase = state.phase;
  return res;
}

/**
 * Uma página: casa cada atividade com o registro e a tarefa daqui. Devolve
 * `false` quando o orçamento cortou a página no meio.
 */
async function processPage(
  db: SupabaseClient,
  items: BitrixActivity[],
  entityByTypeId: Map<number, MirrorOwnerEntity>,
  typesByEntity: Map<MirrorOwnerEntity, string[]>,
  res: DiscoveryResult,
  deadline: number
): Promise<boolean> {
  if (items.length === 0) return true;

  // Registros donos (por entidade: source_id + record_types dela), numa leitura.
  const recordByKey = new Map<string, RecordRef>();
  for (const [entity, types] of typesByEntity) {
    const typeId = ownerTypeIdOf(entity);
    // v1.1: o OWNER_ID é nativo; o source_id do item SPA leva o prefixo.
    const ownerIds = [
      ...new Set(
        items
          .filter((a) => Number(a.OWNER_TYPE_ID) === typeId)
          .map((a) => String(a.OWNER_ID ?? ""))
          .filter(Boolean)
          .map((id) => sourceIdOf(entity, id))
      ),
    ];
    if (ownerIds.length === 0) continue;
    const { data: recs } = await db
      .from("records")
      .select("id, organization_id, source_id")
      .in("record_type", types)
      .in("source_id", ownerIds)
      .is("deleted_at", null);
    for (const r of recs ?? []) {
      recordByKey.set(`${typeId}|${String(r.source_id)}`, {
        recordId: r.id as string,
        orgId: r.organization_id as string,
      });
    }
  }

  // Tarefas já conhecidas (por id da atividade), numa leitura.
  const { data: known } = await db
    .from("tasks")
    .select("id, completed_at, created_by, bitrix_activity_id")
    .in(
      "bitrix_activity_id",
      items.map((a) => String(a.ID))
    );
  const taskByActivity = new Map(
    (known ?? []).map((t) => [String(t.bitrix_activity_id), t])
  );

  for (const activity of items) {
    if (Date.now() >= deadline) return false;
    const typeId = Number(activity.OWNER_TYPE_ID);
    if (!entityByTypeId.has(typeId)) continue;
    const entity = entityByTypeId.get(typeId)!;
    const owner = recordByKey.get(
      `${typeId}|${sourceIdOf(entity, String(activity.OWNER_ID ?? ""))}`
    );
    const task = taskByActivity.get(String(activity.ID));
    if (task) {
      const moved = await syncKnownTaskState(db, task, activity, owner?.orgId ?? null);
      if (moved === "completed") res.completed += 1;
      else if (moved === "reopened") res.reopened += 1;
      continue;
    }
    if (!owner) continue; // registro não sincronizado aqui (ou na lixeira)
    if (!shouldImportActivity(activity)) continue;
    if (await createTaskFromActivity(db, owner, activity)) res.created += 1;
  }
  return true;
}
