-- Versão: 1.0 | Data: 09/07/2026
-- Sync incremental e retomável (Bitrix). Cada job é dividido em fases conhecidas
-- ANTES de rodar (plan); o navegador avança 1 página (≤50) por requisição,
-- gravando o cursor aqui — nenhuma requisição estoura o timeout do plano free.
-- Escrita SÓ via service role (o adapter de sync bypassa RLS); admins podem ler
-- para acompanhar/retomar. Idempotente.

create table if not exists public.sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('reconcile', 'backfill')),
  params          jsonb not null default '{}'::jsonb,   -- { days, since }
  status          text not null default 'running'
                    check (status in ('running', 'done', 'error', 'canceled')),
  -- Fases planejadas na criação (leads → deals-Vendas → deals-Enterprise ...).
  plan            jsonb not null default '[]'::jsonb,   -- PhasePlan[]
  phase_index     int   not null default 0,             -- ponteiro em plan[]
  bitrix_start    int   not null default 0,             -- offset de paginação na fase atual
  phase_total     int,                                   -- resp.total da fase (null até a 1ª página)
  phase_totals    jsonb not null default '[]'::jsonb,    -- total conhecido por fase (barra de progresso)
  processed_total int   not null default 0,
  -- Contexto do Bitrix (maps/enum/mapping) persistido 1x no passo "preparar",
  -- para os passos de trabalho NÃO re-baterem em crm.*.fields a cada página.
  context         jsonb,                                 -- null até o passo "preparar" preencher
  -- SyncResult acumulado (lib/sync/shared.ts).
  totals          jsonb not null default
                    '{"inserted":0,"updated":0,"skipped":0,"errors":0,"byEntity":{},"errorSamples":[]}'::jsonb,
  error           text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index if not exists idx_sync_jobs_status
  on public.sync_jobs (status, created_at desc);

drop trigger if exists trg_sync_jobs_updated_at on public.sync_jobs;
create trigger trg_sync_jobs_updated_at
  before update on public.sync_jobs
  for each row execute function public.set_updated_at();

-- ===================== RLS =====================
alter table public.sync_jobs enable row level security;

-- Admins leem (acompanhar/detectar job em andamento p/ retomar). Escrita só pelo
-- service role (createServiceClient bypassa RLS) — sem policy de insert/update.
drop policy if exists sync_jobs_select on public.sync_jobs;
create policy sync_jobs_select on public.sync_jobs for select to authenticated
  using (public.auth_has_role('admin'));
