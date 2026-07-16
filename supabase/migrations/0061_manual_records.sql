-- Versão: 1.0 | Data: 16/07/2026
-- Criação MANUAL de registros (fontes que não vêm de Sync).
--   - data_sources.manual_entry: a fonte aceita registros criados à mão no app.
--     Default true para fontes novas; os 3 builtins (alimentados por Sync)
--     nascem desligados — o admin pode religar na tela de Fontes se quiser.
--   - records_insert: além do admin (comportamento histórico da 0009), quem tem
--     edit_record_values passa a poder INSERIR registros MANUAIS
--     (source_system='manual', source_id nulo, nunca mock) em fontes com
--     manual_entry ligado; sem view_all_records (vendedor), o registro precisa
--     nascer atribuído a um responsável vinculado ao próprio usuário
--     (auth_responsible_ids, 0037) — mesma regra da visibilidade/edição.
-- DELETE permanece admin-only (0009). Import CSV/Sync usam service role e não
-- passam por esta policy. Idempotente.

-- ============ data_sources.manual_entry ============
alter table public.data_sources
  add column if not exists manual_entry boolean not null default true;

-- Builtins são alimentados por Sync (Bitrix/planilha): criação manual desligada.
-- Guarda de re-run: só desliga se nunca foi mexido depois (coluna recém-criada
-- vale true para todos; re-runs não religam nem desligam edições do admin).
update public.data_sources
set manual_entry = false
where builtin
  and manual_entry
  and not exists (
    select 1 from public.records r
    where r.record_type = data_sources.record_type
      and r.source_system = 'manual'
      and r.source_id is null
  );

-- ============ records_insert: admin OU criação manual permitida ============
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (
    public.auth_has_role('admin')
    or (
      public.auth_has_permission('edit_record_values')
      and source_system = 'manual'
      and source_id is null
      and not is_mock
      and exists (
        select 1
        from public.data_sources ds
        where ds.record_type = records.record_type
          and ds.manual_entry
      )
      and (
        public.auth_has_permission('view_all_records')
        or responsible_id in (select public.auth_responsible_ids())
      )
    )
  );
