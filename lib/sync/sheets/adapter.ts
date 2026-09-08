// Versão: 1.4 | Data: 03/08/2026
// Sync da planilha "Estudo de Fechamentos" (aba Site) → records. Fonte PUSH
// (o Apps Script empurra a cada hora via /api/sync/sheets) — por isso não
// implementa o contrato SyncAdapter (backfill/reconcile) de lib/sync/adapter;
// expõe apenas `syncEstudoFechamentosRows`, chamada pela rota a cada request.
//
// Upsert idempotente por chave natural hash(nome normalizado + created_at).
// Reaproveita o conflito por campo (isProtected/valuesDiffer) e a resolução
// de responsáveis em lote de lib/sync/shared — o MESMO princípio do sync do
// Bitrix (lib/sync/bitrix/sync.ts) e do ingest (lib/import/ingest.ts).
// v1.1 (09/07/2026): Fase 7 — materializa campos calculados (computeFormulaFields)
//   em custom_fields, igual ao sync do Bitrix.
// v1.2 (09/07/2026): Fase 8 — resultado por entidade (venda_site) + amostras de
//   erro (recordOutcome/recordError).
// v1.3 (26/07/2026): source_created_at ancorado em Brasília
//   (anchorNaiveToBrasilia) — o "yyyy-MM-dd" naive entrava como meia-noite UTC
//   e o dia recuava no read side (invariante 11); legado corrigido por
//   supabase/apply/backfill-naive-tz.sql.
// v1.4 (03/08/2026): lote em vez de por-linha (forma do ingestRows) — a versão
//   anterior fazia 5–6 idas ao banco POR LINHA (incl. a tabela responsibles
//   inteira e um ilike de lead por linha) e TODA linha existente sofria UPDATE
//   a cada push (custom_fields/last_synced_at incondicionais), estourando o
//   teto de 60s da Vercel com a planilha inteira reenviada por hora. Agora:
//   lookups em lote (responsáveis, operações, existentes, leads por e-mail),
//   insert em lote com fallback por linha, UPDATE só quando algo mudou (sem
//   bump de last_synced_at em linha inalterada — semântica do ingest) e audit
//   em lote único. Devolve também touchedRecordIds p/ a cauda incremental da
//   rota (lib/sync/post-ingest.ts).
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDateContext,
  computeFormulaFields,
  loadCustomDateKeys,
  loadFormulaDefs,
} from "@/lib/records/formulas";
import { anchorNaiveToBrasilia } from "@/lib/date/normalize";
import {
  emptyResult,
  isProtected,
  leadTimeDays,
  normalizeName,
  recordError,
  recordOutcome,
  resolveResponsiblesByName,
  valuesDiffer,
  type ExistingRecord,
  type SyncResult,
} from "@/lib/sync/shared";

export interface SheetSiteRow {
  name: string;
  email: string | null;
  created_at: string; // yyyy-MM-dd
  consultor: string | null;
  products: string | null;
  mrr: number | null;
  plan: string | null;
  seats: number | null;
  contract: number | null;
  etapa_crm: string | null;
  canal: string | null;
  campanha: string | null;
  // Fallback calculado no Apps Script via "Inbound Zapper" / Leads Base —
  // usado só quando o app não encontra um lead relacionado por e-mail.
  lead_created_at: string | null;
  lead_time_days: number | null;
}

export interface SheetSyncOutcome {
  result: SyncResult;
  // Ids inseridos/atualizados NESTE push — a rota os passa à cauda
  // incremental (auto-match + recalc direcionado).
  touchedRecordIds: string[];
}

const CORE_SYNC_FIELDS = ["stage", "value", "mrr", "sale_type", "channel"] as const;

// Lookups por URL (in/ilikeAnyOf com hash de 64 chars ou e-mails) em chunks
// curtos — mesma razão do LOOKUP_BATCH do ingest; escritas (corpo do POST)
// aceitam lotes maiores.
const LOOKUP_BATCH = 100;
const WRITE_BATCH = 500;

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sourceIdFor(name: string, createdAt: string): string {
  const key = `${normalizeName(name)}|${createdAt.trim()}`;
  return createHash("sha256").update(key).digest("hex");
}

function normalizeEmail(v: string | null): string | null {
  const s = strOrNull(v);
  return s ? s.toLowerCase() : null;
}

// Escapa os curingas do LIKE (%/_) p/ o ilikeAnyOf casar o e-mail LITERAL.
function escapeLikePattern(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// Leads relacionados por e-mail, em LOTE (case-insensitive; o mais recente por
// source_created_at vence, NULL = menor — a versão por linha deixava o NULL
// vencer por acidente do DESC do Postgres). O índice idx_records_lead_email
// (0013) é sobre lower(custom_fields->>'email') e o PostgREST não expressa
// lower(col) — o ilikeAnyOf não o usa, mas UMA varredura por chunk substitui a
// varredura POR LINHA da versão anterior; um RPC dedicado fica como otimização
// futura se o volume de leads crescer.
async function resolveRelatedLeadsByEmail(
  db: SupabaseClient,
  emails: (string | null)[]
): Promise<Map<string, { id: string; created: string | null }>> {
  const byEmail = new Map<string, { id: string; created: string | null }>();
  const unique = [
    ...new Set(emails.map(normalizeEmail).filter((e): e is string => e !== null)),
  ];
  if (unique.length === 0) return byEmail;
  const wanted = new Set(unique);
  const at = (v: string | null) => (v ? Date.parse(v) : Number.NEGATIVE_INFINITY);
  for (let i = 0; i < unique.length; i += LOOKUP_BATCH) {
    const slice = unique.slice(i, i + LOOKUP_BATCH);
    const { data } = await db
      .from("records")
      .select("id, source_created_at, email:custom_fields->>email")
      .eq("record_type", "lead")
      .ilikeAnyOf("custom_fields->>email", slice.map(escapeLikePattern));
    for (const r of data ?? []) {
      const rec = r as { id: string; source_created_at: string | null; email: string | null };
      // Pós-filtro por igualdade exata (case-insensitive): ILIKE trata %/_
      // como curinga — mesmo escapados, garante que só o e-mail EXATO vincula.
      const email = normalizeEmail(rec.email);
      if (!email || !wanted.has(email)) continue;
      const created = rec.source_created_at ?? null;
      const prev = byEmail.get(email);
      if (!prev || at(created) > at(prev.created)) {
        byEmail.set(email, { id: rec.id, created });
      }
    }
  }
  return byEmail;
}

export async function syncEstudoFechamentosRows(
  db: SupabaseClient,
  rows: SheetSiteRow[]
): Promise<SheetSyncOutcome> {
  const result = emptyResult();
  const touched: string[] = [];

  // 1) Dedup do payload pela chave natural (primeira ocorrência vence;
  //    duplicata na planilha conta como skipped — convenção do ingest).
  const byId = new Map<string, SheetSiteRow>();
  for (const row of rows) {
    if (!row.name || !row.created_at) {
      recordOutcome(result, "venda_site", "skipped");
      continue;
    }
    const sourceId = sourceIdFor(row.name, row.created_at);
    if (byId.has(sourceId)) {
      recordOutcome(result, "venda_site", "skipped");
      continue;
    }
    byId.set(sourceId, row);
  }
  if (byId.size === 0) return { result, touchedRecordIds: touched };
  const batch = [...byId.entries()];

  const [formulaDefs, customDateKeys] = await Promise.all([
    loadFormulaDefs(db),
    loadCustomDateKeys(db),
  ]);

  // 2) Responsáveis (uma leitura da tabela + um insert por nome novo) e
  //    operação primária dos referenciados, em lote.
  const names = [
    ...new Set(
      batch
        .map(([, r]) => strOrNull(r.consultor))
        .filter((n): n is string => n !== null && n !== "-")
    ),
  ];
  const { byName: responsibleByName } = await resolveResponsiblesByName(db, names);
  const responsibleIdOf = (row: SheetSiteRow): string | null => {
    const name = strOrNull(row.consultor);
    if (!name || name === "-") return null;
    return responsibleByName.get(normalizeName(name)) ?? null;
  };

  const respIds = [
    ...new Set(batch.map(([, r]) => responsibleIdOf(r)).filter((id): id is string => id !== null)),
  ];
  const operationByResponsible = new Map<string, string>();
  for (let i = 0; i < respIds.length; i += LOOKUP_BATCH) {
    const { data } = await db
      .from("responsible_operations")
      .select("responsible_id, operation_id")
      .eq("priority", 1)
      .in("responsible_id", respIds.slice(i, i + LOOKUP_BATCH));
    for (const r of data ?? []) {
      const rec = r as { responsible_id: string; operation_id: string };
      if (!operationByResponsible.has(rec.responsible_id)) {
        operationByResponsible.set(rec.responsible_id, rec.operation_id);
      }
    }
  }

  // 3) Existentes do lote (chave natural sob uq_records_source), em chunks.
  const existingById = new Map<string, ExistingRecord>();
  const existingCols =
    "id, source_id, title, currency, closed, field_modified_at, last_synced_at, " +
    "custom_fields, responsible_id, operation_id, related_lead_id, lead_time_days, " +
    CORE_SYNC_FIELDS.join(", ");
  const allIds = batch.map(([id]) => id);
  for (let i = 0; i < allIds.length; i += LOOKUP_BATCH) {
    const { data, error } = await db
      .from("records")
      .select(existingCols)
      .eq("source_system", "sheet_site")
      .in("source_id", allIds.slice(i, i + LOOKUP_BATCH));
    if (error) {
      recordError(result, "venda_site", `select existentes: ${error.message}`);
      return { result, touchedRecordIds: touched };
    }
    for (const r of data ?? []) {
      const rec = r as unknown as ExistingRecord & { source_id: string };
      existingById.set(rec.source_id, rec);
    }
  }

  // 4) Leads relacionados por e-mail, em lote.
  const leadByEmail = await resolveRelatedLeadsByEmail(
    db,
    batch.map(([, r]) => r.email)
  );

  // 5) Monta inserts e updates em memória (nenhuma ida ao banco neste laço).
  const now = new Date().toISOString();
  const inserts: { sourceId: string; payload: Record<string, unknown> }[] = [];
  const pendingUpdates: {
    id: string;
    sourceId: string;
    updates: Record<string, unknown>;
  }[] = [];
  const audits: {
    record_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[] = [];

  for (const [sourceId, row] of batch) {
    const existing = existingById.get(sourceId) ?? null;
    const responsibleId = responsibleIdOf(row);
    const operationId = responsibleId
      ? (operationByResponsible.get(responsibleId) ?? null)
      : null;
    const email = normalizeEmail(row.email);
    const relatedLead = email ? (leadByEmail.get(email) ?? null) : null;

    // Datas próprias do registro (venda do site): a data da venda é a
    // `created_at` da planilha (source_created_at); não há fechamento/abertura.
    const ownDates = {
      closed_at: null as string | null,
      opened_at: null as string | null,
      source_created_at: row.created_at,
    };

    // Lead time: prioriza o lead relacionado encontrado no app; sem match,
    // usa o valor já calculado pelo Apps Script (via Leads Base).
    const computedLeadTime = relatedLead
      ? leadTimeDays(row.created_at, relatedLead.created)
      : row.lead_time_days;

    const custom_fields: Record<string, unknown> = {
      products: row.products,
      seats: row.seats,
      campanha: row.campanha,
      email: row.email,
    };
    if (!relatedLead && row.lead_created_at) {
      custom_fields.lead_created_at_planilha = row.lead_created_at;
    }

    if (!existing) {
      if (formulaDefs.length > 0) {
        Object.assign(
          custom_fields,
          computeFormulaFields(
            {
              value: numOrNull(row.contract),
              mrr: numOrNull(row.mrr),
              lead_time_days: computedLeadTime,
              // Colunas textuais (condicionais SE/E/OU nas fórmulas).
              title: row.name,
              record_type: "venda_site",
              source_system: "sheet_site",
              stage: row.etapa_crm,
              sale_type: row.plan,
              channel: row.canal,
            },
            custom_fields,
            formulaDefs,
            undefined,
            buildDateContext(ownDates, custom_fields, customDateKeys)
          )
        );
      }
      inserts.push({
        sourceId,
        payload: {
          record_type: "venda_site",
          source_system: "sheet_site",
          source_id: sourceId,
          owner_user_id: null,
          responsible_id: responsibleId,
          operation_id: operationId,
          related_lead_id: relatedLead?.id ?? null,
          lead_time_days: computedLeadTime,
          title: row.name,
          stage: row.etapa_crm,
          value: row.contract,
          mrr: row.mrr,
          sale_type: row.plan,
          channel: row.canal,
          // Coluna timestamptz: o "yyyy-MM-dd" da planilha é dia de BRASÍLIA —
          // sem âncora o Postgres assumiria UTC e o dia recuaria no read side.
          source_created_at: anchorNaiveToBrasilia(row.created_at),
          custom_fields,
          field_modified_at: {},
          last_synced_at: now,
        },
      });
      continue;
    }

    const mapped: Record<string, unknown> = {
      stage: row.etapa_crm,
      value: row.contract,
      mrr: row.mrr,
      sale_type: row.plan,
      channel: row.canal,
    };

    const updates: Record<string, unknown> = {};
    let changed = false;
    let customChanged = false;

    for (const f of CORE_SYNC_FIELDS) {
      if (isProtected(f, existing)) continue;
      if (valuesDiffer(existing[f], mapped[f])) {
        audits.push({ record_id: existing.id, field: f, old_value: existing[f], new_value: mapped[f] });
        updates[f] = mapped[f];
        changed = true;
      }
    }

    const mergedCustom: Record<string, unknown> = { ...(existing.custom_fields ?? {}) };
    for (const [key, val] of Object.entries(custom_fields)) {
      if (isProtected(key, existing)) continue;
      if (valuesDiffer(mergedCustom[key], val)) {
        audits.push({ record_id: existing.id, field: key, old_value: mergedCustom[key] ?? null, new_value: val ?? null });
        mergedCustom[key] = val;
        customChanged = true;
      }
    }

    if (!isProtected("responsible_id", existing) && responsibleId) {
      if (valuesDiffer(existing.responsible_id, responsibleId)) {
        updates.responsible_id = responsibleId;
        changed = true;
      }
      if (!isProtected("operation_id", existing) && !existing.operation_id && operationId) {
        updates.operation_id = operationId;
        changed = true;
      }
    }

    // related_lead/lead_time só entram quando o valor efetivamente MUDA — a
    // versão por linha os gravava sempre que resolvíveis (churn de UPDATE).
    if (!isProtected("related_lead_id", existing) && relatedLead) {
      if (valuesDiffer(existing.related_lead_id, relatedLead.id)) {
        updates.related_lead_id = relatedLead.id;
        changed = true;
      }
      if (valuesDiffer(existing.lead_time_days, computedLeadTime)) {
        updates.lead_time_days = computedLeadTime;
        changed = true;
      }
    } else if (!isProtected("related_lead_id", existing) && !existing.related_lead_id) {
      if (valuesDiffer(existing.lead_time_days, computedLeadTime)) {
        updates.lead_time_days = computedLeadTime;
        changed = true;
      }
    }

    // Campos calculados: sempre recomputados a partir dos valores efetivos;
    // saída divergente do valor armazenado conta como mudança (comparação por
    // String, a mesma do recalcRows) — preserva o reparo de drift de fórmula
    // que o recalc global por push fazia.
    if (formulaDefs.length > 0) {
      const eff = (col: string) => (col in updates ? updates[col] : existing[col]);
      const calc = computeFormulaFields(
        {
          value: numOrNull(eff("value")),
          mrr: numOrNull(eff("mrr")),
          lead_time_days: numOrNull(
            "lead_time_days" in updates ? updates.lead_time_days : existing.lead_time_days
          ),
          // Valores efetivos das colunas textuais (condicionais SE/E/OU).
          title: existing.title,
          record_type: "venda_site",
          source_system: "sheet_site",
          stage: eff("stage"),
          sale_type: eff("sale_type"),
          channel: eff("channel"),
          currency: existing.currency,
          closed: existing.closed,
        },
        mergedCustom,
        formulaDefs,
        undefined,
        buildDateContext(ownDates, mergedCustom, customDateKeys)
      );
      for (const [k, v] of Object.entries(calc)) {
        if (String(mergedCustom[k] ?? "") !== String(v ?? "")) {
          mergedCustom[k] = v;
          customChanged = true;
        }
      }
    }

    if (!changed && !customChanged) {
      // Nada mudou: sem UPDATE e sem bump de last_synced_at (semântica do
      // ingest) — o push horário em regime estável não gera churn de escrita
      // e `last_synced_at >= since` vira um filtro incremental preciso.
      recordOutcome(result, "venda_site", "skipped");
      continue;
    }
    if (customChanged) updates.custom_fields = mergedCustom;
    updates.last_synced_at = now;
    pendingUpdates.push({ id: existing.id, sourceId, updates });
  }

  // 6) Inserts em lote (fallback por linha isola a linha ruim — padrão ingest).
  for (let i = 0; i < inserts.length; i += WRITE_BATCH) {
    const chunk = inserts.slice(i, i + WRITE_BATCH);
    const { data, error } = await db
      .from("records")
      .insert(chunk.map((c) => c.payload))
      .select("id");
    if (!error) {
      for (const r of data ?? []) touched.push((r as { id: string }).id);
      for (let k = 0; k < chunk.length; k += 1) {
        recordOutcome(result, "venda_site", "inserted");
      }
      continue;
    }
    for (const c of chunk) {
      const { data: one, error: e } = await db
        .from("records")
        .insert(c.payload)
        .select("id")
        .maybeSingle();
      if (e) {
        recordError(result, "venda_site", `insert ${c.sourceId}: ${e.message}`);
        continue;
      }
      if (one?.id) touched.push(one.id as string);
      recordOutcome(result, "venda_site", "inserted");
    }
  }

  // 7) Updates pontuais (valores distintos por linha; em regime estável ≈ 0).
  const updatedIds = new Set<string>();
  for (const u of pendingUpdates) {
    const { error } = await db.from("records").update(u.updates).eq("id", u.id);
    if (error) {
      recordError(result, "venda_site", `update ${u.sourceId}: ${error.message}`);
      continue;
    }
    touched.push(u.id);
    updatedIds.add(u.id);
    recordOutcome(result, "venda_site", "updated");
  }

  // 8) Auditoria em lote único, só dos updates que gravaram (como antes:
  //    campos mapeados realmente alterados; saída de fórmula não é auditada).
  const auditRows = audits.filter((a) => updatedIds.has(a.record_id));
  for (let i = 0; i < auditRows.length; i += WRITE_BATCH) {
    await db.from("audit_log").insert(
      auditRows
        .slice(i, i + WRITE_BATCH)
        .map((a) => ({ ...a, user_id: null, origin: "sync_sheet" as const }))
    );
  }

  return { result, touchedRecordIds: touched };
}
