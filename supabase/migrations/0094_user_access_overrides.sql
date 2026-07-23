-- Versão: 1.0 | Data: 23/07/2026
-- ACESSOS CUSTOMIZADOS POR USUÁRIO (Configurações → Acessos): overrides
-- individuais que CONCEDEM além do nível ou REVOGAM o que o nível daria —
-- o override vence o papel. Recursos:
--   * resource_type 'settings_area' + slug da aba (operacoes/metas/fontes/…):
--     'allow' concede a ABA a quem o papel não daria; 'deny' esconde de quem
--     o papel daria. (Escrita dentro da área continua sujeita ao papel — a
--     RLS de goals/operations/etc. segue exigindo admin.)
--   * resource_type 'source' + key da base (data_sources/sub_sources):
--     'deny' esconde a base do usuário — some dos pickers (data_sources_select
--     nega ⇒ loadSources herda) E dos DADOS (records_select nega o
--     record_type; sub negada some por si; pai negada leva as subs junto).
--     'allow' é aceito mas hoje é no-op (bases não têm gate por papel).
-- Acesso por PESSOA a dashboards/kanbans já tem tabela própria (board_access,
-- 0088) — a tela de Acessos reusa. Idempotente.

create table if not exists public.user_access_overrides (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  resource_type   text not null check (resource_type in ('source', 'settings_area')),
  resource_key    text not null,
  effect          text not null check (effect in ('allow', 'deny')),
  granted_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id, resource_type, resource_key)
);

create index if not exists idx_user_access_overrides_user
  on public.user_access_overrides (user_id);

alter table public.user_access_overrides enable row level security;

drop policy if exists user_access_overrides_select on public.user_access_overrides;
create policy user_access_overrides_select on public.user_access_overrides
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      organization_id in (select public.auth_org_ids())
      and (select public.auth_has_role('admin'))
    )
  );

drop policy if exists user_access_overrides_write on public.user_access_overrides;
create policy user_access_overrides_write on public.user_access_overrides
  for all to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  )
  with check (
    organization_id in (select public.auth_org_ids())
    and (select public.auth_has_role('admin'))
  );

-- ===================== Helpers (SECURITY DEFINER) =====================
-- Keys de base NEGADAS ao usuário logado (pai ou sub).
create or replace function public.auth_denied_source_keys()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.resource_key
  from public.user_access_overrides o
  where o.user_id = (select auth.uid())
    and o.resource_type = 'source'
    and o.effect = 'deny';
$$;

-- record_types cujas FONTES-RAIZ foram negadas (backstop de DADOS em records;
-- sub negada não entra aqui — o recorte dela é a pai, que segue visível).
create or replace function public.auth_denied_record_types()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.record_type
  from public.user_access_overrides o
  join public.data_sources ds on ds.key = o.resource_key
  where o.user_id = (select auth.uid())
    and o.resource_type = 'source'
    and o.effect = 'deny';
$$;

grant execute on function public.auth_denied_source_keys() to authenticated;
grant execute on function public.auth_denied_record_types() to authenticated;

-- ===================== data_sources / sub_sources: deny =====================
drop policy if exists data_sources_select on public.data_sources;
create policy data_sources_select on public.data_sources
  for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and key not in (select public.auth_denied_source_keys())
  );

drop policy if exists sub_sources_select on public.sub_sources;
create policy sub_sources_select on public.sub_sources
  for select to authenticated
  using (
    key not in (select public.auth_denied_source_keys())
    and exists (
      select 1 from public.data_sources ds
      where ds.key = sub_sources.parent_key
    )
  );

-- ===================== records: backstop de dados =====================
drop policy if exists records_select on public.records;
create policy records_select on public.records for select to authenticated
  using (
    organization_id in (select public.auth_org_ids())
    and record_type not in (select public.auth_denied_record_types())
    and (
      (select public.auth_has_permission('view_all_records'))
      or responsible_id in (select public.auth_responsible_ids())
    )
  );
