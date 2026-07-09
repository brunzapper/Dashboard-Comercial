-- Versão: 1.0 | Data: 09/07/2026
-- Fase 7 (bloco único, idempotente): colunas dinâmicas do Bitrix + campos
-- calculados. Equivale à migração 0017_dynamic_columns_and_formulas.sql.
-- Cole no SQL Editor do Supabase e execute.

alter table public.field_definitions
  add column if not exists source_system text,
  add column if not exists source_field_id text,
  add column if not exists show_in_builder boolean not null default true,
  add column if not exists formula jsonb;

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

create unique index if not exists field_definitions_source_uniq
  on public.field_definitions (source_system, source_field_id)
  where source_field_id is not null;
