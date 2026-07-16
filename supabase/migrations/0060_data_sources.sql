-- Versão: 1.0 | Data: 16/07/2026
-- Fontes DINÂMICAS: catálogo `data_sources` substitui o conjunto fixo de
-- fontes (lib/sources.ts). Cada fonte segue mapeando 1:1 num record_type de
-- `records`; para fontes NOVAS a convenção é key === record_type (mapeamento
-- identidade — os 3 builtins mantêm o mapeamento histórico).
--   - records.record_type: CHECK fixo -> FK para data_sources(record_type)
--     (on delete restrict: apagar fonte exige apagar os registros antes).
--   - records.source_system: CHECK fixo -> regex (habilita 'csv' para o import
--     em massa e valores futuros, ex. 'api', sem nova migração).
-- NÃO toca em run_widget_query: record_type entra na RPC como DADO de filtro
-- (v_allowed_cols + _widget_wrap_record_types aceitam qualquer valor), então a
-- regra de espelhamento com run_widget_query_snapshot não é acionada.
-- RLS: leitura p/ autenticados; escrita = manage_field_definitions (mesmo
-- gate das definições de campo). Sem policy anon (regra do projeto).
-- Idempotente.

-- ============ Catálogo de fontes ============
create table if not exists public.data_sources (
  key text primary key
    constraint data_sources_key_check check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  record_type text not null unique,
  label text not null,
  short_label text,
  default_period_field text not null default 'source_created_at'
    constraint data_sources_period_field_check check (default_period_field in (
      'closed_at', 'opened_at', 'source_created_at', 'source_modified_at',
      'created_at', 'updated_at'
    )),
  builtin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Seed dos 3 builtins (labels/period fields históricos de lib/sources.ts).
insert into public.data_sources
  (key, record_type, label, short_label, default_period_field, builtin)
values
  ('leads',  'lead',       'Leads do Bitrix',       'Leads',  'source_created_at', true),
  ('deals',  'negocio',    'Deals do Bitrix',       'Deals',  'closed_at',         true),
  ('estudo', 'venda_site', 'Estudo de Fechamentos', 'Estudo', 'source_created_at', true)
on conflict (key) do nothing;

-- Migra rótulos curtos personalizados do legado (sync_config 'source_labels')
-- para o catálogo — o catálogo passa a ser o canônico dos nomes curtos por
-- fonte (sync_config segue guardando só o rótulo "geral"). Guarda: só copia
-- enquanto o short_label ainda está no valor semeado (re-runs não sobrescrevem
-- edições feitas depois na tela de Fontes).
update public.data_sources ds
set short_label = trim(sc.value ->> ds.key)
from public.sync_config sc
where sc.key = 'source_labels'
  and ds.builtin
  and ds.short_label in ('Leads', 'Deals', 'Estudo')
  and coalesce(trim(sc.value ->> ds.key), '') <> ''
  and length(trim(sc.value ->> ds.key)) <= 40;

-- ============ RLS ============
alter table public.data_sources enable row level security;

drop policy if exists data_sources_select on public.data_sources;
create policy data_sources_select on public.data_sources
  for select to authenticated using (true);

drop policy if exists data_sources_write on public.data_sources;
create policy data_sources_write on public.data_sources
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

-- ============ records.record_type: CHECK -> FK ============
-- Derruba o(s) CHECK(s) de record_type por busca (nome gerado pode variar —
-- padrão de 0017) e cria a FK nomeada, se ainda não existir.
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.records'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%record_type%'
  loop
    execute format('alter table public.records drop constraint %I', v_con);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.records'::regclass
      and conname = 'records_record_type_fkey'
  ) then
    alter table public.records
      add constraint records_record_type_fkey
      foreign key (record_type)
      references public.data_sources (record_type)
      on delete restrict;
  end if;
end $$;

-- ============ records.source_system: CHECK fixo -> regex ============
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.records'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source_system%'
  loop
    execute format('alter table public.records drop constraint %I', v_con);
  end loop;
end $$;

alter table public.records
  add constraint records_source_system_check
  check (source_system ~ '^[a-z][a-z0-9_]{1,39}$');

-- ============ audit_log.origin: aceita 'import_csv' ============
-- O import de CSV audita atualizações (linhas re-importadas) via service role;
-- a policy de INSERT p/ autenticados (0009) segue exigindo origin='app'.
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.audit_log'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%origin%'
  loop
    execute format('alter table public.audit_log drop constraint %I', v_con);
  end loop;
end $$;

alter table public.audit_log
  add constraint audit_log_origin_check
  check (origin in ('app', 'sync_bitrix', 'sync_sheet', 'import_csv'));
