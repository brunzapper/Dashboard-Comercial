-- Versão: 1.0 | Data: 11/07/2026
-- Agenda o "tick" de sincronização do Bitrix a cada minuto, direto do Supabase.
-- O tick (/api/sync/tick) roda no servidor da Vercel e, dentro de um orçamento
-- de ~45s (< teto de 60s do plano Hobby): (1) drena a fila de write-back,
-- (2) avança o job de sync ativo (manual OU automático) de onde parou e
-- (3) cria um novo reconcile incremental quando o último automático foi há ≥ 1h.
-- Assim o sync horário sai "de graça" do próprio tick, e nada trava a navegação.
--
-- pg_net.http_post é fire-and-forget: o banco só DISPARA a requisição; não espera
-- os 45s. Como cada tick termina em < 60s e o intervalo é de 60s, não há
-- sobreposição.
--
-- Aplicar UMA vez no SQL editor do Supabase (como as demais migrações). Trocar
-- os dois valores abaixo pelo domínio de produção e pelo SYNC_SECRET reais, OU
-- guardá-los no Vault e ler com vault.decrypted_secrets (recomendado).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------------
-- Opção A (recomendada): segredos no Supabase Vault.
--   select vault.create_secret('https://SEU-DOMINIO.vercel.app', 'app_base_url');
--   select vault.create_secret('SEU_SYNC_SECRET', 'sync_secret');
-- Depois agende lendo do Vault:
-- ------------------------------------------------------------------
select cron.schedule(
  'bitrix-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'app_base_url') || '/api/sync/tick',
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
--   'bitrix-tick',
--   '* * * * *',
--   $$
--   select net.http_post(
--     url     := 'https://SEU-DOMINIO.vercel.app/api/sync/tick',
--     headers := jsonb_build_object('Content-Type','application/json','x-sync-secret','SEU_SYNC_SECRET'),
--     body    := '{}'::jsonb
--   );
--   $$
-- );

-- Verificação:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Para remover: select cron.unschedule('bitrix-tick');
