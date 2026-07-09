-- Versão: 1.0 | Data: 09/07/2026
-- Colunas dinâmicas do Bitrix + campos calculados (Fase 7).
--   field_definitions ganha:
--     source_system  -> origem do campo ('bitrix' quando descoberto no sync;
--                       null/'app' quando criado na tela de Campos)
--     source_field_id-> id do campo na fonte (UF_CRM_* ou nome padrão do Bitrix)
--     show_in_builder-> se o campo aparece como coluna selecionável nos
--                       seletores (dropdowns do construtor de dashboards E
--                       colunas da tabela de Registros). Campos descobertos do
--                       Bitrix nascem DESLIGADOS; um admin habilita na config.
--     formula        -> definição do campo calculado (tokens; ver
--                       lib/records/formulas.ts). Só para data_type='calculado'.
--   data_type passa a aceitar 'booleano' (campos Y/N do Bitrix) e 'calculado'.
-- Idempotente. RLS herda as policies de 0009 (field_definitions_*).

alter table public.field_definitions
  add column if not exists source_system text,
  add column if not exists source_field_id text,
  add column if not exists show_in_builder boolean not null default true,
  add column if not exists formula jsonb;

-- Estende o CHECK de data_type (drop + recreate — nome do constraint gerado
-- automaticamente pode variar, então derrubamos por busca e recriamos nomeado).
do $$
declare
  v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'public.field_definitions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%data_type%';
  if v_con is not null then
    execute format('alter table public.field_definitions drop constraint %I', v_con);
  end if;
end $$;

alter table public.field_definitions
  add constraint field_definitions_data_type_check
  check (data_type in ('texto', 'numero', 'data', 'selecao', 'moeda', 'booleano', 'calculado'));

-- Um campo por (fonte, id-na-fonte): permite upsert idempotente na descoberta.
create unique index if not exists field_definitions_source_uniq
  on public.field_definitions (source_system, source_field_id)
  where source_field_id is not null;
