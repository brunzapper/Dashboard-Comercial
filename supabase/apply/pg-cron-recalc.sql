-- Versão: 1.0 | Data: 13/07/2026
-- Agenda o recalc DIÁRIO dos campos calculados (/api/sync/recalc-daily), direto
-- do Supabase. Reatualiza as fórmulas que usam o operando "Data atual" (hoje em
-- Brasília): como os campos calculados são materializados em records.custom_fields,
-- um valor tipo `today − closed_at` congelaria — este job refresca uma vez ao dia.
--
-- Horário: 05:00 UTC ≈ 02:00 BRT (logo após a virada do dia em Brasília).
-- pg_net.http_post é fire-and-forget; o banco só DISPARA a requisição.
--
-- Aplicar UMA vez no SQL editor do Supabase (como as demais migrações/agendas).
-- Usa os mesmos segredos do tick (app_base_url + sync_secret no Vault).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------------
-- Opção A (recomendada): segredos no Supabase Vault (mesmos do tick).
--   select vault.create_secret('https://SEU-DOMINIO.vercel.app', 'app_base_url');
--   select vault.create_secret('SEU_SYNC_SECRET', 'sync_secret');
-- ------------------------------------------------------------------
select cron.schedule(
  'recalc-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/sync/recalc-daily',
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
--   'recalc-daily',
--   '0 5 * * *',
--   $$
--   select net.http_post(
--     url     := 'https://SEU-DOMINIO.vercel.app/api/sync/recalc-daily',
--     headers := jsonb_build_object('Content-Type','application/json','x-sync-secret','SEU_SYNC_SECRET'),
--     body    := '{}'::jsonb
--   );
--   $$
-- );

-- Verificação:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Para remover: select cron.unschedule('recalc-daily');
