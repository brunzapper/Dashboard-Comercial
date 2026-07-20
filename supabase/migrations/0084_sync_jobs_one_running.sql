-- Versão: 1.0 | Data: 20/07/2026
-- Guarda de concorrência dos jobs de sync (auditoria 20/07/2026): createJob
-- (lib/sync/bitrix/runner.ts) fazia find-then-insert — dois ticks/ações
-- sobrepostos podiam criar DOIS jobs 'running' (dois drivers avançando as
-- mesmas páginas em paralelo). Índice único parcial garante no banco "no
-- máximo 1 job running"; o app trata o 23505 reusando o job vencedor.
-- Idempotente. Não toca as RPCs de widgets (invariante 1 não acionada).
-- APLICAR ANTES do deploy do código que trata o 23505 (inofensivo se depois:
-- a corrida só volta a ser possível até aplicar).

-- Se houver mais de um job 'running' hoje (estado que o bug permitia), encerra
-- os mais antigos antes de criar o índice — senão o CREATE INDEX falha.
update public.sync_jobs
set status = 'error',
    finished_at = now(),
    error = coalesce(error, 'encerrado pela 0084: havia mais de um job running'
    )
where status = 'running'
  and id not in (
    select id from public.sync_jobs
    where status = 'running'
    order by started_at desc nulls last
    limit 1
  );

create unique index if not exists uq_sync_jobs_one_running
  on public.sync_jobs (status)
  where status = 'running';
