// Versão: 1.0 | Data: 11/07/2026
// Núcleo server-side do sync incremental e retomável do Bitrix (extraído de
// app/(app)/registros/sync-actions.ts para ser chamável tanto pela Server Action
// guardada por admin quanto pelo tick agendado /api/sync/tick). Toda a lógica de
// passos (preparar → 1 página por vez → cursor em sync_jobs) vive aqui, SEM auth;
// quem chama garante a autorização (ensureAdmin na action, SYNC_SECRET no tick).
//
// O estado completo fica em sync_jobs, então qualquer chamador retoma de onde o
// anterior parou — é isso que permite o navegador NÃO precisar dirigir o loop.
// v1.1 (19/07/2026): fuso da fonte (0079) — JobContext.timezones (opcional)
//   persiste o fuso por entidade e chega ao mapDeal/mapLead de cada página.
import type { SupabaseClient } from "@supabase/supabase-js";

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

export type SyncKind = "reconcile" | "backfill";
export type SyncTrigger = "manual" | "auto";

// Job "preso" (chamador morreu no meio) é retomável por qualquer tick, mas se
// ninguém o retomar por muito tempo, o takeover o marca como erro para liberar
// espaço a um novo job.
const STALE_JOB_MS = 10 * 60 * 1000;
// Pausa curta entre passos ao dirigir server-side (o client já pausa entre
// páginas internamente; isto só suaviza rajadas).
const STEP_PAUSE_MS = 250;

// Uma fase = um método + filtro do Bitrix; percorrida página a página (`start`).
interface PhasePlan {
  label: string;
  entity: "lead" | "negocio";
  method: "crm.lead.list" | "crm.deal.list";
  filter: Record<string, unknown>;
}

// Contexto do Bitrix persistido na linha do job (evita re-bater em crm.*.fields).
// `timezones` é OPCIONAL: job criado antes do deploy da 0079 retoma com um
// contexto serializado sem o campo — degrada p/ passthrough em vez de quebrar
// (o reconcile seguinte normaliza).
interface JobContext {
  lookups: SerializedLookups;
  dealMapping: CustomMapEntry[];
  leadMapping: CustomMapEntry[];
  formulaDefs: FormulaFieldDef[];
  customDateKeys: string[];
  timezones?: { lead: string | null; negocio: string | null };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
// para retomar/observar).
export function snapshot(job: JobRow): StepProgress {
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

/** Último job em andamento (para observar/retomar). Snapshot ou null. */
export async function getRunningJob(db: SupabaseClient): Promise<StepProgress | null> {
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

/** Snapshot de um job específico (qualquer status) — para observar o progresso. */
export async function getJob(
  db: SupabaseClient,
  jobId: string
): Promise<StepProgress | null> {
  const { data } = await db
    .from("sync_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return null;
  return snapshot(data as JobRow);
}

/** id do job em andamento (se houver) — usado para guardar concorrência. */
async function findRunningJobId(db: SupabaseClient): Promise<string | null> {
  const { data } = await db
    .from("sync_jobs")
    .select("id")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Quando o último reconcile automático foi CRIADO (ms desde a época), ou null. */
export async function lastAutoReconcileAt(db: SupabaseClient): Promise<number | null> {
  const { data } = await db
    .from("sync_jobs")
    .select("created_at")
    .eq("trigger", "auto")
    .eq("kind", "reconcile")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ts = data?.created_at as string | undefined;
  return ts ? new Date(ts).getTime() : null;
}

/**
 * Marca como 'error' jobs 'running' cujo updated_at é antigo demais (chamador
 * morreu no meio). Libera espaço para a guarda de concorrência. Retorna quantos.
 */
export async function takeoverStale(db: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_JOB_MS).toISOString();
  const { data } = await db
    .from("sync_jobs")
    .update({
      status: "error",
      error: "Job expirado (sem progresso por muito tempo) — refaça a sincronização.",
      finished_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("updated_at", cutoff)
    .select("id");
  return (data ?? []).length;
}

/**
 * Cria a linha do job (sem chamar o Bitrix — o plano é montado no 1º passo).
 * Guarda de concorrência: se já houver um job 'running', devolve o existente em
 * vez de criar um segundo (evita dois drivers processando páginas em paralelo).
 */
export async function createJob(
  db: SupabaseClient,
  kind: SyncKind,
  days: number,
  trigger: SyncTrigger,
  createdBy: string | null
): Promise<{ jobId: string; reused: boolean }> {
  const running = await findRunningJobId(db);
  if (running) return { jobId: running, reused: true };

  const d =
    Number.isFinite(days) && days > 0
      ? Math.floor(days)
      : kind === "backfill"
        ? 365
        : 3;

  const { data, error } = await db
    .from("sync_jobs")
    .insert({
      kind,
      trigger,
      params: { days: d, since: sinceFromDays(d) },
      status: "running",
      created_by: createdBy,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    // v20/07/2026 (0084): índice único parcial garante 1 job 'running' — uma
    // corrida com outro tick cai em 23505; reusa o job vencedor em vez de
    // falhar (o find-then-insert acima não é atômico).
    if (error?.code === "23505") {
      const winner = await findRunningJobId(db);
      if (winner) return { jobId: winner, reused: true };
    }
    throw new Error(error?.message ?? "Falha ao criar o job de sync.");
  }
  return { jobId: data.id as string, reused: false };
}

/** Avança o job em UM passo (preparar OU 1 página). Nunca estoura sem tratar. */
export async function stepJob(db: SupabaseClient, jobId: string): Promise<StepProgress> {
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
        customDateKeys: ctx.customDateKeys,
        timezones: ctx.timezones,
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
    const tz = context.timezones?.[phase.entity] ?? null;
    const mapped: MappedRecord[] = [];
    for (const raw of items) {
      mapped.push(
        phase.entity === "negocio"
          ? await mapDeal(raw, lookups, mapping, tz)
          : await mapLead(raw, lookups, mapping, tz)
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
    await upsertPage(db, mapped, maps, relIndex, context.formulaDefs, totals, phase.entity, context.customDateKeys);

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

/**
 * Dirige o job no servidor: avança passo a passo até terminar (done/error) OU o
 * relógio passar do `deadline` (ms epoch). Deixa o job 'running' se o tempo
 * acabar — o próximo tick continua de onde parou. Retorna o último progresso.
 */
export async function driveJob(
  db: SupabaseClient,
  jobId: string,
  deadline: number
): Promise<StepProgress> {
  let p = await stepJob(db, jobId);
  while (!p.done && Date.now() < deadline) {
    await sleep(STEP_PAUSE_MS);
    p = await stepJob(db, jobId);
  }
  return p;
}
