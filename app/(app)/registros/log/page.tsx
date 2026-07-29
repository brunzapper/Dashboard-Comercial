// Versão: 2.1 | Data: 27/07/2026
// Registros → Log. Duas seções:
//   1) Sincronizações (sync_jobs): reconciliações (manuais/automáticas) e
//      backfills — visível a qualquer autenticado (gestor/vendedor inclusos).
//   2) Write-back (fila do Bitrix): o que foi/está sendo enviado de volta ao CRM
//      e o que falhou — mostra título/valores de registros, então só aparece para
//      quem tem view_all_records (admin + gestor).
// v2.1 (27/07/2026): página movida de /configuracoes/log para /registros/log.
//   Guard vira requireSettingsArea("log") (gate {} = mesmo público de antes),
//   para o deny de Acessos seguir barrando a page fora do hub de Configurações.
import Link from "next/link";

import { requireSettingsArea } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  WritebackLog,
  type WritebackLogRow,
} from "@/components/configuracoes/writeback-log";
import {
  SyncJobsLog,
  type SyncJobLogRow,
} from "@/components/configuracoes/sync-jobs-log";
import type { SyncResult } from "@/lib/sync/shared";

// Título da aba (template do layout completa "— {appName}").
export const metadata = { title: "Log de sincronização" };

export default async function LogPage() {
  const session = await requireSettingsArea("log");
  const canSeeWriteback = session.permissions.includes("view_all_records");
  const supabase = await createClient();

  const { data: jobsData } = await supabase
    .from("sync_jobs")
    .select("id, kind, trigger, status, params, totals, processed_total, error, created_at, finished_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const jobs: SyncJobLogRow[] = (jobsData ?? []).map((j) => {
    const totals = (j.totals as SyncResult | null) ?? null;
    const params = (j.params as { days?: number } | null) ?? null;
    return {
      id: j.id as string,
      kind: j.kind as SyncJobLogRow["kind"],
      trigger: (j.trigger as SyncJobLogRow["trigger"]) ?? "manual",
      status: j.status as SyncJobLogRow["status"],
      days: params?.days ?? null,
      inserted: totals?.inserted ?? 0,
      updated: totals?.updated ?? 0,
      processedTotal: (j.processed_total as number) ?? 0,
      error: (j.error as string) ?? null,
      createdAt: j.created_at as string,
      finishedAt: (j.finished_at as string) ?? null,
    };
  });

  let writebackRows: WritebackLogRow[] = [];
  if (canSeeWriteback) {
    const { data } = await supabase
      .from("bitrix_writeback_queue")
      .select(
        "id, entity, source_id, field_key, label, new_value, status, attempts, last_error, created_at, processed_at, records(title)"
      )
      .order("created_at", { ascending: false })
      .limit(200);

    writebackRows = (data ?? []).map((r) => ({
      id: r.id as string,
      entity: r.entity as WritebackLogRow["entity"],
      sourceId: r.source_id as string,
      fieldKey: r.field_key as string,
      label: (r.label as string) ?? null,
      recordTitle: (r.records as { title?: string } | null)?.title ?? null,
      newValue: r.new_value ?? null,
      status: r.status as WritebackLogRow["status"],
      attempts: (r.attempts as number) ?? 0,
      lastError: (r.last_error as string) ?? null,
      createdAt: r.created_at as string,
      processedAt: (r.processed_at as string) ?? null,
    }));
  }

  return (
    <div className="flex flex-col gap-8">
      {/* pr-8: afasta o botão do sino fixo (TaskBell, topo-direito) */}
      <div className="flex items-start justify-between gap-4 pr-8">
        <div>
          <h1 className="text-2xl font-semibold">Log</h1>
          <p className="text-muted-foreground text-sm">
            Sincronizações com o Bitrix e fila de write-back.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/registros">Voltar a Registros</Link>
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sincronizações</h2>
          <p className="text-muted-foreground text-sm">
            Reconciliações (manuais e automáticas) e backfills executados contra o
            Bitrix, com status e contagem de registros novos/atualizados.
          </p>
        </div>
        <SyncJobsLog rows={jobs} />
      </div>

      {canSeeWriteback ? (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">Write-back (envio ao Bitrix)</h2>
            <p className="text-muted-foreground text-sm">
              Alterações de campos marcados para &quot;sincronizar de volta&quot; ao
              Bitrix. Itens com erro podem ser reenfileirados para nova tentativa.
            </p>
          </div>
          <WritebackLog rows={writebackRows} />
        </div>
      ) : null}
    </div>
  );
}
