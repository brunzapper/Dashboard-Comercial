-- Versão: 1.0 | Data: 16/07/2026
-- Criação manual COM espelho no Bitrix: a opção "Criar também no Bitrix" gera a
-- entidade na origem (crm.lead.add/crm.deal.add) e grava a linha local já
-- vinculada — source_system='bitrix', source_id = ID retornado — para o próximo
-- sync ADOTAR a linha (upsert em (source_system,source_id)) sem duplicar.
--
-- A policy records_insert (0061) só permitia, fora do admin, linhas MANUAIS
-- (source_system='manual', source_id nulo). Esta migração acrescenta um ramo
-- para a linha vinculada ao Bitrix, com as MESMAS garantias da criação manual
-- (edit_record_values, fonte com manual_entry, não-mock, visibilidade por
-- responsável). O app cria a entidade no Bitrix ANTES do insert, então o
-- source_id é sempre um ID real recém-criado. DELETE segue admin-only.
-- Idempotente.

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated
  with check (
    public.auth_has_role('admin')
    or (
      -- Ramo 1: registro puramente MANUAL (0061).
      public.auth_has_permission('edit_record_values')
      and source_system = 'manual'
      and source_id is null
      and not is_mock
      and exists (
        select 1 from public.data_sources ds
        where ds.record_type = records.record_type
          and ds.manual_entry
      )
      and (
        public.auth_has_permission('view_all_records')
        or responsible_id in (select public.auth_responsible_ids())
      )
    )
    or (
      -- Ramo 2: registro criado no app E espelhado no Bitrix (0065). A entidade
      -- já existe na origem (source_id não nulo); mesmas garantias do ramo 1.
      public.auth_has_permission('edit_record_values')
      and source_system = 'bitrix'
      and source_id is not null
      and not is_mock
      and exists (
        select 1 from public.data_sources ds
        where ds.record_type = records.record_type
          and ds.manual_entry
      )
      and (
        public.auth_has_permission('view_all_records')
        or responsible_id in (select public.auth_responsible_ids())
      )
    )
  );
