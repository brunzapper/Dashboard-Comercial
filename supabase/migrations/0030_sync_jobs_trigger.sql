-- Versão: 1.0 | Data: 11/07/2026
-- Sync automático (horário) + reconciliação não-bloqueante. Distingue jobs
-- criados por um admin ('manual') dos criados pelo tick agendado ('auto'), para
-- (a) só criar um novo reconcile automático quando o último 'auto' foi há ≥ 1h e
-- (b) o painel poder rotular/ignorar jobs automáticos ao oferecer "Retomar".
-- Idempotente.

alter table public.sync_jobs
  add column if not exists trigger text not null default 'manual'
    check (trigger in ('manual', 'auto'));

-- Buscar rapidamente o último reconcile 'auto' (janela horária) e o último por
-- gatilho ao decidir criar um novo job.
create index if not exists idx_sync_jobs_trigger_created
  on public.sync_jobs (trigger, created_at desc);
