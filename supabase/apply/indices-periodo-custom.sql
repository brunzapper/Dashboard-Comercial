-- Versão: 1.0 | Data: 26/07/2026
-- ÍNDICES DE PERÍODO PARA CAMPOS CUSTOM (complemento da migração 0103): cria
-- um índice de expressão parcial para CADA campo custom de data configurado
-- como default_period_field em data_sources ou sub_sources ('custom:<key>',
-- 0082) — o filtro de período dessas fontes compara o texto ISO de
-- `custom_fields->>key` e sem índice é seq scan da fonte inteira.
--
-- Rode no SQL Editor SEMPRE que configurar um campo custom como campo de
-- período de uma fonte/sub-fonte nova (Configurações → Bases). Idempotente:
-- `if not exists` + nome determinístico por (record_type, key). A 0103 já
-- cobre as duas chaves fixas de "Data Reunião" (lead/negócio).
--
-- Sub-fontes compartilham o record_type da PAI (0078) — o índice parcial é
-- por record_type da pai e serve pai e sub.

do $$
declare
  r record;
  v_key text;
  v_name text;
begin
  for r in
    select ds.record_type, ds.default_period_field
    from public.data_sources ds
    where ds.default_period_field like 'custom:%'
    union
    select pds.record_type, ss.default_period_field
    from public.sub_sources ss
    join public.data_sources pds on pds.key = ss.parent_key
    where ss.default_period_field like 'custom:%'
  loop
    v_key := substr(r.default_period_field, 8);
    -- Nome determinístico e curto (limite de 63 bytes do Postgres).
    v_name := 'idx_records_' || r.record_type || '_' || left(md5(v_key), 8);
    execute format(
      'create index if not exists %I on public.records ((custom_fields->>%L)) where record_type = %L',
      v_name, v_key, r.record_type
    );
    raise notice 'índice % (record_type=%, campo custom %)', v_name, r.record_type, v_key;
  end loop;
end $$;
