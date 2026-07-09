// Versão: 1.0 | Data: 09/07/2026
// Sync incremental e retomável (Fase 9). O navegador dirige o loop: cada chamada
// de stepSyncJob processa UMA página do Bitrix (≤50) + upsert em lote e grava o
// cursor em sync_jobs — nenhuma requisição estoura o timeout do plano gratuito.
// Guardado por admin; usa o service role (via createServiceClient), então NÃO
// expõe o SYNC_SECRET ao browser. As Server Actions são despachadas em série
// pelo cliente (o loop aguarda cada passo), o que casa com este desenho.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { DEAL_PIPELINES } from "@/lib/config/bitrix-field-map";
import type { FormulaFieldDef } from "@/lib/records/formulas";
import { BitrixClient } from "@/lib/sync/bitrix/client";
import { BitrixLookups, type SerializedLookups } from "@/lib/sync/bitrix/lookups";
import { mapDeal, mapLead, type MappedRecord } from "@/lib/sync/bitrix/mapper";
import type { CustomMapEntry } from "@/lib/sync/bitrix/catalog";
import {
  buildSyncContext,
  ensureResponsibles,
  enterpriseCategoryId,
  loadPreloadedMaps,
  loadRelatedLeadIndex,
  sinceFromDays,
  upsertPage,
} from "@/lib/sync/bitrix/sync";
import type { SyncResult } from "@/lib/sync/shared";

type SyncKind = "reconcile" | "backfill";

// Uma fase = um método + filtro do Bitrix; percorrida página a página (`start`).
interface PhasePlan {
  label: string;
  entity: "lead" | "negocio";
  method: "crm.lead.list" | "crm.deal.list";
  filter: Record<string, unknown>;
}

// Contexto do Bitrix persistido na linha do job (evita re-bater em crm.*.fields).
interface JobContext {
  lookups: SerializedLookups;
  dealMapping: CustomMapEntry[];
  leadMapping: CustomMapEntry[];
  formulaDefs: FormulaFieldDef[];
}

interface JobRow {
  id: string;
  kind: SyncKind;
  params: { days?: number; since?: string } | null;
  status: "running" | "done" | "error" | "canceled";
  plan: PhasePlan[] | null;
  phase_index: number;
  bitrix_start: number;
  phase_total: number | null;
  processed_total: number;
  context: JobContext | null;
  totals: SyncResult;
  error: string | null;
}

export interface StepProgress {
  jobId: string;
  kind: SyncKind;
  phaseIndex: number;
  phaseCount: number;
  phaseLabel: string;
  phaseTotal: number | null;
  processedInPhase: number;
  processedTotal: number;
  done: boolean;
  status: "running" | "done" | "error";
  totals: SyncResult;
  error?: string;
}

async function ensureAdmin(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores podem sincronizar.";
  return null;
}

function buildReconcilePlan(entId: string | null, since: string): PhasePlan[] {
  const plan: PhasePlan[] = [
    { label: "Leads", entity: "lead", method: "crm.lead.list", filter: { ">=DATE_MODIFY": since } },
    {
      label: "Deals — Vendas",
      entity: "negocio",
      method: "crm.deal.list",
      filter: { CATEGORY_ID: DEAL_PIPELINES.vendasCategoryId, ">=DATE_MODIFY": since },
    },
  ];
  if (entId) {
    plan.push({
      label: "Deals — Enterprise",
      entity: "negocio",
      method: "crm.deal.list",
      filter: { CATEGORY_ID: entId, ">=DATE_MODIFY": since },
    });
  }
  return plan;
}

function buildBackfillPlan(entId: string | null, since: string): PhasePlan[] {
  const cats: { id: string; label: string }[] = [
    { id: DEAL_PIPELINES.vendasCategoryId, label: "Vendas" },
  ];
  if (entId) cats.push({ id: entId, label: "Enterprise" });

  const plan: PhasePlan[] = [
    { label: "Leads", entity: "lead", method: "crm.lead.list", filter: {} },
  ];
  for (const c of cats) {
    plan.push({
      label: `Deals — ${c.label} (abertos)`,
      entity: "negocio",
      method: "crm.deal.list",
      filter: { CATEGORY_ID: c.id, CLOSED: "N" },
    });
    plan.push({
      label: `Deals — ${c.label} (fechados)`,
      entity: "negocio",
      method: "crm.deal.list",
      filter: { CATEGORY_ID: c.id, CLOSED: "Y", ">=DATE_MODIFY": since },
    });
  }
  return plan;
}

// Converte uma linha do job num snapshot de progresso (para estados terminais e
// para retomar ao reabrir a página).
function snapshot(job: JobRow): StepProgress {
  const plan = job.plan ?? [];
  const phase = plan[job.phase_index];
  const label = !job.context
    ? "Preparando"
    : job.status === "error"
      ? "Erro"
      : phase?.label ?? "Concluindo";
  const status: StepProgress["status"] =
    job.status === "done" ? "done" : job.status === "running" ? "running" : "error";
  return {
    jobId: job.id,
    kind: job.kind,
    phaseIndex: job.phase_index,
    phaseCount: plan.length,
    phaseLabel: label,
    phaseTotal: job.phase_total,
    processedInPhase: job.bitrix_start,
    processedTotal: job.processed_total,
    done: job.status !== "running",
    status,
    totals: job.totals,
    error: job.error ?? undefined,
  };
}

/** Cria a linha do job (sem chamar o Bitrix). O plano é montado no 1º passo. */
export async function startSyncJob(
  kind: SyncKind,
  days: number
): Promise<{ jobId: string }> {
  const err = await ensureAdmin();
  if (err) throw new Error(err);
  const session = await getSessionInfo();

  const d =
    Number.isFinite(days) && days > 0
      ? Math.floor(days)
      : kind === "backfill"
        ? 365
        : 3;

  const db = createServiceClient();
  const { data, error } = await db
    .from("sync_jobs")
    .insert({
      kind,
      params: { days: d, since: sinceFromDays(d) },
      status: "running",
      created_by: session?.user.id ?? null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Falha ao criar o job de sync.");
  return { jobId: data.id as string };
}

/** Avança o job em UM passo (preparar OU 1 página). Nunca estoura sem tratar. */
export async function stepSyncJob(jobId: string): Promise<StepProgress> {
  const err = await ensureAdmin();
  if (err) throw new Error(err);
  const db = createServiceClient();

  const { data: jobData } = await db
    .from("sync_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (!jobData) throw new Error("Job de sync não encontrado.");
  const job = jobData as JobRow;

  // Estado terminal: devolve o snapshot como está.
  if (job.status !== "running") return snapshot(job);

  const totals = job.totals;

  try {
    const client = new BitrixClient();

    // ---- Passo "preparar": cataloga campos, monta o plano e o contexto. ----
    if (!job.context) {
      const lookups = new BitrixLookups(client, db);
      await lookups.preload();
      const ctx = await buildSyncContext(db, lookups);
      const entId = enterpriseCategoryId(lookups);
      const since = job.params?.since ?? sinceFromDays(job.params?.days ?? 3);
      const plan =
        job.kind === "backfill"
          ? buildBackfillPlan(entId, since)
          : buildReconcilePlan(entId, since);
      const context: JobContext = {
        lookups: lookups.serializeContext(),
        dealMapping: ctx.dealMapping,
        leadMapping: ctx.leadMapping,
        formulaDefs: ctx.formulaDefs,
      };
      await db
        .from("sync_jobs")
        .update({ context, plan, phase_index: 0, bitrix_start: 0 })
        .eq("id", jobId);
      return {
        jobId,
        kind: job.kind,
        phaseIndex: 0,
        phaseCount: plan.length,
        phaseLabel: "Preparando",
        phaseTotal: null,
        processedInPhase: 0,
        processedTotal: job.processed_total,
        done: false,
        status: "running",
        totals,
      };
    }

    // ---- Passo "trabalho": 1 página da fase atual. ----
    const context = job.context;
    const plan = job.plan ?? [];
    const phaseIndex = job.phase_index;

    if (phaseIndex >= plan.length) {
      await db
        .from("sync_jobs")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", jobId);
      return { ...snapshot({ ...job, status: "done" }), done: true, status: "done" };
    }

    const phase = plan[phaseIndex];
    const start = job.bitrix_start;
    const lookups = BitrixLookups.hydrate(client, db, context.lookups);

    const resp = await client.call<Record<string, unknown>[]>(phase.method, {
      filter: phase.filter,
      select: ["*", "UF_*"],
      order: { ID: "ASC" },
      start,
    });
    const items = resp.result ?? [];
    const phaseTotal = typeof resp.total === "number" ? resp.total : job.phase_total;

    // Mapeia a página.
    const mapping = phase.entity === "negocio" ? context.dealMapping : context.leadMapping;
    const mapped: MappedRecord[] = [];
    for (const raw of items) {
      mapped.push(
        phase.entity === "negocio"
          ? await mapDeal(raw, lookups, mapping)
          : await mapLead(raw, lookups, mapping)
      );
    }

    // Pré-carrega mapas, garante responsáveis e monta o índice de leads.
    const maps = await loadPreloadedMaps(db);
    const missing = new Set<string>();
    for (const m of mapped) {
      if (m._assignedById && !maps.responsibleByBitrix.has(m._assignedById)) {
        missing.add(m._assignedById);
      }
    }
    await ensureResponsibles(db, lookups, maps, missing);
    const relIndex = await loadRelatedLeadIndex(db, mapped);

    // Grava a página em lote (muta `totals`).
    await upsertPage(db, mapped, maps, relIndex, context.formulaDefs, totals, phase.entity);

    // Avança o cursor.
    const processedInPhase = start + items.length;
    const next = typeof resp.next === "number" ? resp.next : null;
    let newPhaseIndex = phaseIndex;
    let newStart = start;
    let phaseTotalToStore: number | null = phaseTotal;
    if (next !== null) {
      newStart = next;
    } else {
      newPhaseIndex = phaseIndex + 1;
      newStart = 0;
      phaseTotalToStore = null;
    }
    const done = newPhaseIndex >= plan.length;
    const processedTotal = job.processed_total + items.length;

    await db
      .from("sync_jobs")
      .update({
        totals,
        phase_index: newPhaseIndex,
        bitrix_start: newStart,
        phase_total: phaseTotalToStore,
        processed_total: processedTotal,
        status: done ? "done" : "running",
        finished_at: done ? new Date().toISOString() : null,
      })
      .eq("id", jobId);

    return {
      jobId,
      kind: job.kind,
      phaseIndex,
      phaseCount: plan.length,
      phaseLabel: phase.label,
      phaseTotal,
      processedInPhase,
      processedTotal,
      done,
      status: done ? "done" : "running",
      totals,
    };
  } catch (e) {
    const msg = (e as Error).message;
    await db
      .from("sync_jobs")
      .update({ status: "error", error: msg, finished_at: new Date().toISOString() })
      .eq("id", jobId);
    return {
      jobId,
      kind: job.kind,
      phaseIndex: job.phase_index,
      phaseCount: (job.plan ?? []).length,
      phaseLabel: "Erro",
      phaseTotal: null,
      processedInPhase: 0,
      processedTotal: job.processed_total,
      done: true,
      status: "error",
      totals,
      error: msg,
    };
  }
}

/** Último job em andamento (para retomar ao reabrir a página). */
export async function getActiveSyncJob(): Promise<StepProgress | null> {
  const err = await ensureAdmin();
  if (err) return null;
  const db = createServiceClient();
  const { data } = await db
    .from("sync_jobs")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return snapshot(data as JobRow);
}
