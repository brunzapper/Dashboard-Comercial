-- Versão: 1.0 | Data: 23/07/2026
-- MULTI-ORGANIZAÇÃO (fundação): organizations (empresa/tenant; carrega também
-- o branding editável name/app_name exibido no sidebar), organization_members
-- (vínculo usuário↔org com a flag is_org_admin — "Administrador de
-- Organização") e app_owner (o "Owner" do sistema: 1 linha, hoje
-- bruno.2bpl@gmail.com).
--
-- PROTEÇÕES ("a menos que criado pelo banco"):
--   * Um ÚNICO org_admin por org (índice único parcial) — segundo admin só
--     removendo o índice via SQL.
--   * org_admin não pode ser excluído/demovido (trigger), NEM via service
--     role — o desbloqueio é o GUC transaction-local
--     `app.allow_protected_change = 'on'`, setável só por quem roda SQL
--     direto (SQL Editor / funções dedicadas como delete_organization).
--     A exclusão da CONTA (auth.users) do org_admin também falha: o cascade
--     da membership dispara o mesmo trigger.
--   * app_owner é imutável por qualquer caminho de app (trigger idem) e a FK
--     para auth.users NÃO cascateia — excluir a conta do owner falha na FK.
--
-- Helpers SECURITY DEFINER p/ RLS (padrão 0037/0068, sempre chamados como
-- `(select ...)`): auth_org_ids / auth_is_org_admin / auth_org_member_ids /
-- auth_is_owner.
--
-- Seeds: org Zapper em uuid FIXO (referenciado pelo default das colunas
-- organization_id na 0090), TODOS os usuários atuais como membros, e o owner
-- (bruno.2bpl@gmail.com) como org_admin da Zapper + app_owner.
-- Aplicar 0089→0090→0091 na MESMA janela, imediatamente antes do deploy do
-- código correspondente (invariante 6). Idempotente.

-- ===================== Tabelas =====================
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  app_name text not null default 'Dashboard Comercial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  is_org_admin boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists idx_org_members_user
  on public.organization_members (user_id);

-- Um único Administrador de Organização por org.
create unique index if not exists organization_members_single_admin
  on public.organization_members (organization_id) where is_org_admin;

-- FK SEM cascade de propósito: excluir a conta do owner falha na FK.
create table if not exists public.app_owner (
  user_id uuid primary key references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.app_owner enable row level security;

-- ===================== Seeds (antes dos triggers de proteção) =====================
-- GUC transaction-local: também permite re-rodar este arquivo depois que os
-- triggers já existem (idempotência).
select set_config('app.allow_protected_change', 'on', true);

insert into public.organizations (id, name, app_name)
values ('00000000-0000-4000-a000-000000000001', 'Zapper', 'Dashboard Comercial')
on conflict (id) do nothing;

-- Todos os usuários atuais são membros da Zapper.
insert into public.organization_members (organization_id, user_id)
select '00000000-0000-4000-a000-000000000001', u.id
from auth.users u
on conflict do nothing;

-- Owner + org_admin da Zapper: bruno.2bpl@gmail.com (só se ainda não houver
-- outro org_admin — o índice parcial garante unicidade de qualquer forma).
update public.organization_members om
set is_org_admin = true
where om.organization_id = '00000000-0000-4000-a000-000000000001'
  and om.user_id = (
    select id from auth.users where lower(email) = 'bruno.2bpl@gmail.com'
  )
  and not om.is_org_admin
  and not exists (
    select 1 from public.organization_members x
    where x.organization_id = om.organization_id and x.is_org_admin
  );

insert into public.app_owner (user_id)
select id from auth.users where lower(email) = 'bruno.2bpl@gmail.com'
on conflict do nothing;

-- ===================== Triggers de proteção =====================
create or replace function public.enforce_app_owner_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_protected_change', true), '') <> 'on' then
    raise exception
      'app_owner é protegido: altere apenas via SQL direto com set_config(''app.allow_protected_change'',''on'',true)';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_app_owner_guard on public.app_owner;
create trigger trg_app_owner_guard
  before insert or update or delete on public.app_owner
  for each row execute function public.enforce_app_owner_guard();

-- org_admin: bloqueia DELETE da membership e demote/re-apontamento da flag.
-- INSERT segue livre (o console do Owner cria o admin da org nova; o índice
-- único parcial impede um segundo).
create or replace function public.enforce_org_admin_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_protected_change', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.is_org_admin then
      raise exception
        'O Administrador de Organização não pode ser removido da organização (proteção de banco)';
    end if;
    return old;
  end if;
  -- UPDATE: não deixa demover nem transferir a linha do org_admin.
  if old.is_org_admin
     and (not new.is_org_admin
          or new.user_id <> old.user_id
          or new.organization_id <> old.organization_id) then
    raise exception
      'O Administrador de Organização não pode ser demovido (proteção de banco)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_org_admin_guard on public.organization_members;
create trigger trg_org_admin_guard
  before update or delete on public.organization_members
  for each row execute function public.enforce_org_admin_guard();

-- organizations: DELETE só com o GUC ligado (via delete_organization, 0093).
create or replace function public.enforce_organizations_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_protected_change', true), '') <> 'on' then
    raise exception
      'Organizações só podem ser excluídas via delete_organization (proteção de banco)';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_organizations_guard on public.organizations;
create trigger trg_organizations_guard
  before delete on public.organizations
  for each row execute function public.enforce_organizations_guard();

-- ===================== Helpers de RLS (SECURITY DEFINER) =====================
-- Orgs do usuário logado (a base do isolamento: toda policy org-scoped usa
-- `organization_id in (select public.auth_org_ids())` — InitPlan, 0068).
create or replace function public.auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select om.organization_id
  from public.organization_members om
  where om.user_id = (select auth.uid());
$$;

create or replace function public.auth_is_org_admin(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = p_org
      and om.user_id = (select auth.uid())
      and om.is_org_admin
  );
$$;

-- Usuários que compartilham ao menos uma org com o usuário logado (gestão de
-- papéis/usuários fica confinada à própria org — 0092).
create or replace function public.auth_org_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m2.user_id
  from public.organization_members m1
  join public.organization_members m2
    on m2.organization_id = m1.organization_id
  where m1.user_id = (select auth.uid());
$$;

create or replace function public.auth_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_owner o
    where o.user_id = (select auth.uid())
  );
$$;

grant execute on function public.auth_org_ids() to authenticated;
grant execute on function public.auth_is_org_admin(uuid) to authenticated;
grant execute on function public.auth_org_member_ids() to authenticated;
grant execute on function public.auth_is_owner() to authenticated;

-- ===================== RLS =====================
-- organizations: membro lê a própria org (branding no sidebar); owner lê
-- todas (console); update (name/app_name) só org_admin; insert/delete SEM
-- policy — service role (console do Owner) apenas.
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
  using (
    id in (select public.auth_org_ids())
    or (select public.auth_is_owner())
  );

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update to authenticated
  using ((select public.auth_is_org_admin(id)))
  with check ((select public.auth_is_org_admin(id)));

-- organization_members: usuário vê as próprias memberships; org_admin vê as
-- da org dele; owner vê todas. Escrita SEM policy (service role apenas — as
-- actions de usuários/console gravam via service role; triggers protegem o
-- org_admin mesmo assim).
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.auth_is_org_admin(organization_id))
    or (select public.auth_is_owner())
  );

-- app_owner: cada um vê apenas se ELE é o owner (o helper auth_is_owner é a
-- via normal; a linha em si não expõe nada além do uuid).
drop policy if exists app_owner_select on public.app_owner;
create policy app_owner_select on public.app_owner for select to authenticated
  using (user_id = (select auth.uid()));
