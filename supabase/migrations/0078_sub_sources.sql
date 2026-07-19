-- Versão: 1.0 | Data: 19/07/2026
-- SUB-FONTES: uma fonte tratada como fonte em todo o app, mas cujas linhas são
-- as da fonte PAI filtradas por um predicado (ex.: "Leads do Bitrix, só etapa
-- Clientes Lite"), com campo de data próprio. Modeladas numa tabela SEPARADA
-- (`sub_sources`) para preservar `data_sources` 1:1 com `record_type` — a sub
-- compartilha o `record_type` da pai, então NÃO pode virar linha de
-- `data_sources` (quebraria `data_sources.record_type unique` e a FK de
-- `records.record_type`). O loader (lib/config/sources.ts) une os dois catálogos
-- num único SourceDef[] (sub: recordType = record_type da pai, parentKey, filter).
--
-- NÃO toca em run_widget_query / run_widget_query_snapshot: sub-fonte se resolve
-- inteiramente no ENGINE (perna por source-key: filtro da fonte via
-- _widget_wrap_record_types + @period/coalesce com um ref por record_type). Logo
-- a invariante de espelhamento das RPCs (arquitetura.md §5.1) NÃO é acionada.
--
-- Também acrescenta `field_correspondence_members.source_key`: hoje o membro é
-- único por (correspondence_id, record_type) — o que impede um campo unificado
-- de mapear DUAS datas para `lead` (ex.: Leads→Data Reunião e a sub
-- Leads/Clientes Lite→Data da mudança de etapa). A identidade do membro passa a
-- ser a SOURCE-KEY (pai ou sub), permitindo N membros por record_type (um por
-- source-key). `record_type` continua (derivável; usado no agrupamento do
-- coalesce e por código legado).
--
-- RLS: leitura p/ autenticados; escrita = manage_field_definitions (mesmo gate
-- de data_sources / definições de campo). Sem policy anon (regra do projeto).
-- Idempotente.

-- ============ Catálogo de sub-fontes ============
create table if not exists public.sub_sources (
  key text primary key
    constraint sub_sources_key_check check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  parent_key text not null
    references public.data_sources (key) on delete cascade,
  label text not null,
  short_label text,
  default_period_field text not null default 'source_created_at'
    constraint sub_sources_period_field_check check (default_period_field in (
      'closed_at', 'opened_at', 'source_created_at', 'source_modified_at',
      'created_at', 'updated_at'
    )),
  -- WidgetFilter[] (mesmo shape dos filtros de widget): o predicado que recorta
  -- as linhas da pai. Resolvido no engine (record_types:[rt da pai] + wrapper).
  filter jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sub_sources_parent
  on public.sub_sources (parent_key);

-- ============ RLS ============
alter table public.sub_sources enable row level security;

drop policy if exists sub_sources_select on public.sub_sources;
create policy sub_sources_select on public.sub_sources
  for select to authenticated using (true);

drop policy if exists sub_sources_write on public.sub_sources;
create policy sub_sources_write on public.sub_sources
  for all to authenticated
  using (public.auth_has_permission('manage_field_definitions'))
  with check (public.auth_has_permission('manage_field_definitions'));

-- ============ field_correspondence_members.source_key ============
alter table public.field_correspondence_members
  add column if not exists source_key text;

-- Backfill: a source-key da fonte cujo record_type = o do membro (data_sources é
-- 1:1 com record_type). Membros existentes viram membros da própria PAI.
update public.field_correspondence_members m
set source_key = ds.key
from public.data_sources ds
where m.source_key is null
  and ds.record_type = m.record_type;

-- Após o backfill não deve restar null (FK de record_type garante a pai). Torna
-- obrigatório para a nova unicidade valer (NULLs seriam tratados como distintos).
do $$
begin
  if not exists (
    select 1 from public.field_correspondence_members where source_key is null
  ) then
    alter table public.field_correspondence_members
      alter column source_key set not null;
  end if;
end $$;

-- Troca a unicidade: (correspondence_id, record_type) -> (correspondence_id,
-- source_key). Derruba QUALQUER unique constraint sobre (…, record_type) da
-- tabela (nome gerado pode variar — padrão de 0060) e cria a nova, se ainda não
-- existir.
do $$
declare
  v_con text;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.field_correspondence_members'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%record_type%'
  loop
    execute format(
      'alter table public.field_correspondence_members drop constraint %I',
      v_con
    );
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.field_correspondence_members'::regclass
      and conname = 'field_correspondence_members_correspondence_id_source_key_key'
  ) then
    alter table public.field_correspondence_members
      add constraint field_correspondence_members_correspondence_id_source_key_key
      unique (correspondence_id, source_key);
  end if;
end $$;
