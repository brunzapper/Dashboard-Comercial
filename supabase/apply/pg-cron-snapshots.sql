-- Versão: 1.0 | Data: 15/07/2026
-- Agenda o "tick" dos SNAPSHOTS a cada 5 minutos, direto do Supabase (mesmo
-- padrão de pg-cron-tick.sql). O tick (/api/snapshots/tick) roda na Vercel,
-- protegido por SYNC_SECRET, e refresca os snapshots agendados vencidos
-- (status ativo, modo != manual, next_refresh_at <= agora) dentro de um
-- orçamento de ~45s. A granularidade efetiva das agendas é, portanto, ~5min —
-- suficiente para os presets (hora/dia/semana).
--
-- pg_net.http_post é fire-and-forget: o banco só dispara a requisição.
--
-- Aplicar UMA vez no SQL editor do Supabase. Pressupõe os segredos já criados
-- no Vault pelo pg-cron-tick.sql ('app_base_url' e 'sync_secret'); senão, use
-- a Opção B com literais.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------------
-- Opção A (recomendada): segredos no Supabase Vault (os MESMOS do sync).
-- ------------------------------------------------------------------
select cron.schedule(
  'snapshots-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/snapshots/tick',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- ------------------------------------------------------------------
-- Opção B (simples): valores embutidos. Descomente e troque os literais.
-- ------------------------------------------------------------------
-- select cron.schedule(
--   'snapshots-tick',
--   '*/5 * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://SEU-DOMINIO.vercel.app/api/snapshots/tick',
--     headers := jsonb_build_object('Content-Type','application/json','x-sync-secret','SEU_SYNC_SECRET'),
--     body    := '{}'::jsonb
--   );
--   $$
-- );

-- Verificação:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Para remover: select cron.unschedule('snapshots-tick');
