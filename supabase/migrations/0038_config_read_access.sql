-- Versão: 1.0 | Data: 12/07/2026
-- Configurações simplificada para gestor/vendedor: eles passam a alcançar a aba
-- "Log". Duas mudanças de leitura (a escrita de ambas segue só via service role):
--   1) sync_jobs: leitura liberada a TODO autenticado (antes só admin), para a
--      seção "Sincronizações" do Log (reconciliações manuais/automáticas e
--      backfills). Não expõe dados de registros — só status/contagens do sync.
--   2) bitrix_writeback_queue: leitura passa de admin para quem tem
--      view_all_records (admin + gestor). O write-back mostra título/valores de
--      registros, então o vendedor (que só vê os próprios registros) NÃO o vê.
-- Idempotente (drop policy if exists antes de recriar).

-- ===================== sync_jobs: leitura para todos os autenticados ===========
drop policy if exists sync_jobs_select on public.sync_jobs;
create policy sync_jobs_select on public.sync_jobs for select to authenticated
  using (true);

-- ===================== bitrix_writeback_queue: leitura = view_all_records =======
drop policy if exists writeback_select on public.bitrix_writeback_queue;
create policy writeback_select on public.bitrix_writeback_queue for select to authenticated
  using (public.auth_has_permission('view_all_records'));
