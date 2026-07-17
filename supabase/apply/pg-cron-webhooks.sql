-- Versão: 1.0 | Data: 17/07/2026
-- Agenda o "tick" dos WEBHOOKS DE SAÍDA a cada minuto, direto do Supabase
-- (mesmo padrão de pg-cron-tick.sql). O tick (/api/webhooks/tick) roda na
-- Vercel, protegido por SYNC_SECRET, e: drena as entregas vencidas do outbox
-- (webhook_deliveries pending + endpoint ativo) com retry/backoff exponencial
-- e assinatura HMAC, e aplica a retenção (entregas 30/90d, log de entrada 30d)
-- dentro de um orçamento de ~45s. Tick sem nada vencido custa um único SELECT
-- indexado — rodar a cada minuto é barato.
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
  'webhooks-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/webhooks/tick',
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
--   'webhooks-tick',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://SEU-DOMINIO.vercel.app/api/webhooks/tick',
--     headers := jsonb_build_object('Content-Type','application/json','x-sync-secret','SEU_SYNC_SECRET'),
--     body    := '{}'::jsonb
--   );
--   $$
-- );

-- Verificação:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Para remover: select cron.unschedule('webhooks-tick');
