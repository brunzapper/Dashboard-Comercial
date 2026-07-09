-- ============================================================================
-- Versão: 1.0 | Data: 09/07/2026
-- BLOCO ÚNICO — FASE 9 — colar no SQL Editor do Supabase APÓS a Fase 8b.
-- Sync incremental e retomável (migração 0023: tabela sync_jobs). Idempotente.
-- ============================================================================

create table if not exists public.sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('reconcile', 'backfill')),
  params          jsonb not null default '{}'::jsonb,
  status          text not null default 'running'
                    check (status in ('running', 'done', 'error', 'canceled')),
  plan            jsonb not null default '[]'::jsonb,
  phase_index     int   not null default 0,
  bitrix_start    int   not null default 0,
  phase_total     int,
  phase_totals    jsonb not null default '[]'::jsonb,
  processed_total int   not null default 0,
  context         jsonb,
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

alter table public.sync_jobs enable row level security;

drop policy if exists sync_jobs_select on public.sync_jobs;
create policy sync_jobs_select on public.sync_jobs for select to authenticated
  using (public.auth_has_role('admin'));
