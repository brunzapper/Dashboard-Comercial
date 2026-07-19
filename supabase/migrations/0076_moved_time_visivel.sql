-- Versão: 1.0 | Data: 19/07/2026
-- MOVED_TIME ("Data da mudança de etapa") visível como campo descoberto.
-- O código (bitrix-field-map v1.4) tirou MOVED_TIME de DEAL_CORE/LEAD_CORE para
-- ele ser descoberto pelo catálogo como `bitrix_moved_time`, mas o sync sozinho
-- não conserta o banco em dois estados possíveis: (a) a linha já existe com
-- show_in_builder=false — o upsert do catálogo preserva o toggle e o default
-- visível só vale no INSERT; (b) existe linha com (bitrix, MOVED_TIME) sob OUTRA
-- field_key — o INSERT da chave nova violaria o índice único
-- field_definitions_source_uniq (0017) e derrubaria o upsert inteiro do catálogo
-- (ver manual §4.6; precedente: 0075, fonte/implementacao).
-- Esta migração reconcilia a linha diretamente — efeito IMEDIATO na UI, sem
-- precisar rodar um sync (padrão da 0022). Idempotente; em instalação nova o
-- insert cria a linha e os updates/deletes são no-op.
-- Os VALORES (records.custom_fields.bitrix_moved_time) só populam com um
-- Backfill/Reconciliar rodando o código v1.4+ deployado.

-- a) Se (bitrix, MOVED_TIME) existe sob outra chave e `bitrix_moved_time` está
--    livre, renomeia para a chave canônica (preserva a linha e seus toggles;
--    label/visibilidade são normalizados no passo c).
update public.field_definitions
set field_key = 'bitrix_moved_time'
where source_system = 'bitrix'
  and source_field_id = 'MOVED_TIME'
  and field_key <> 'bitrix_moved_time'
  and not exists (
    select 1 from public.field_definitions where field_key = 'bitrix_moved_time'
  );

-- b) Remove duplicata remanescente sob outra chave (só existe se o rename acima
--    não coube porque `bitrix_moved_time` já existia).
delete from public.field_definitions
where source_system = 'bitrix'
  and source_field_id = 'MOVED_TIME'
  and field_key <> 'bitrix_moved_time';

-- c) Garante a linha canônica VISÍVEL (insert em banco novo; normalização da
--    existente nos demais). Após a) e b) não há outra linha com
--    (bitrix, MOVED_TIME), então o insert não viola o índice único da 0017.
insert into public.field_definitions
  (field_key, label, data_type, options, source_system, source_field_id,
   applies_to, show_in_builder, is_local)
values
  ('bitrix_moved_time', 'Data da mudança de etapa', 'data', '[]'::jsonb,
   'bitrix', 'MOVED_TIME', array['negocio', 'lead'], true, false)
on conflict (field_key) do update
  set label = excluded.label,
      data_type = excluded.data_type,
      source_system = excluded.source_system,
      source_field_id = excluded.source_field_id,
      applies_to = excluded.applies_to,
      show_in_builder = true,
      is_local = false;
