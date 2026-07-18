-- Versão: 1.0 | Data: 18/07/2026
-- Fonte (SOURCE_ID) e Implementação (UF_CRM_1778094396888) passam a campos
-- curados do sync (chaves `fonte` e `implementacao` em custom_fields).
-- Reconcilia as linhas descobertas ocultas (`bitrix_source_id` e
-- `bitrix_uf_crm_1778094396888`) ANTES do próximo catálogo: sem isso, o upsert
-- (onConflict field_key) violaria o índice único field_definitions_source_uniq
-- (source_system, source_field_id) da 0017 ao inserir as chaves curadas.
-- Idempotente; em instalação nova todos os comandos são no-op.
-- Rodar ANTES do deploy do código correspondente (bitrix-field-map v1.3).

-- ---------------------------------------------------------------------------
-- Fonte: renomeia a linha descoberta para a chave curada `fonte` (se ela ainda
-- não existir) e a torna visível; se `fonte` já existir, apenas remove a
-- descoberta e liga a fonte de dados na existente.
update public.field_definitions
set field_key = 'fonte',
    label = 'Fonte',
    data_type = 'selecao',
    show_in_builder = true,
    applies_to = array['lead', 'negocio']
where field_key = 'bitrix_source_id'
  and not exists (
    select 1 from public.field_definitions where field_key = 'fonte'
  );

delete from public.field_definitions where field_key = 'bitrix_source_id';

update public.field_definitions
set source_system = 'bitrix',
    source_field_id = 'SOURCE_ID',
    is_local = false
where field_key = 'fonte'
  and (source_system is distinct from 'bitrix'
       or source_field_id is distinct from 'SOURCE_ID'
       or is_local is distinct from false);

-- Valores antigos da chave oculta são códigos crus (ex.: "CALL") — não migram;
-- o Backfill grava os nomes resolvidos sob `fonte`.
update public.records
set custom_fields = custom_fields - 'bitrix_source_id'
where custom_fields ? 'bitrix_source_id';

-- ---------------------------------------------------------------------------
-- Implementação: remove a linha descoberta e liga o campo preset (antes local)
-- ao Bitrix. is_local=false = o sync passa a alimentá-lo (Bitrix vence).
delete from public.field_definitions
where field_key = 'bitrix_uf_crm_1778094396888';

update public.field_definitions
set source_system = 'bitrix',
    source_field_id = 'UF_CRM_1778094396888',
    is_local = false,
    applies_to = array['negocio'],
    label = 'Implementação',
    data_type = 'moeda'
where field_key = 'implementacao'
  and (source_system is distinct from 'bitrix'
       or source_field_id is distinct from 'UF_CRM_1778094396888'
       or is_local is distinct from false);

-- Copia os valores já sincronizados sob a chave oculta (números parseados) para
-- efeito imediato, e limpa a proteção de edição manual (field_modified_at) para
-- que o Bitrix vença já no próximo sync.
update public.records
set custom_fields = jsonb_set(
      custom_fields,
      '{implementacao}',
      coalesce(custom_fields->'bitrix_uf_crm_1778094396888', 'null'::jsonb),
      true
    ) - 'bitrix_uf_crm_1778094396888',
    field_modified_at = field_modified_at - 'implementacao'
where record_type = 'negocio'
  and custom_fields ? 'bitrix_uf_crm_1778094396888';

update public.records
set field_modified_at = field_modified_at - 'implementacao'
where field_modified_at ? 'implementacao';
