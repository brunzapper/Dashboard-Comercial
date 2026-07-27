-- Versão: 1.0 | Data: 27/07/2026
-- Agenda o "tick" das AUTOMAÇÕES do kanban a cada minuto, direto do Supabase
-- (mesmo padrão do pg-cron-tick.sql / pg-cron-webhooks.sql). O tick
-- (/api/kanban-automations/tick) roda no servidor da Vercel dentro de um
-- orçamento de ~45s: enumera os quadros com regra habilitada (SELECT indexado
-- — ocioso custa só isso) e avalia/move em round-robin pelos mais antigos.
--
-- Pré-requisito: os segredos do Vault já criados pelo pg-cron-tick.sql
--   select vault.create_secret('https://SEU-DOMINIO.vercel.app', 'app_base_url');
--   select vault.create_secret('SEU_SYNC_SECRET', 'sync_secret');
-- Aplicar UMA vez no SQL editor do Supabase.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'kanban-automations-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/kanban-automations/tick',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verificação:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Para remover: select cron.unschedule('kanban-automations-tick');
