-- Versão: 1.0 | Data: 04/07/2026
-- Funções auxiliares de RLS (SECURITY DEFINER). Rodam como owner para poder
-- ler user_roles/role_permissions sem recursão de RLS. search_path vazio +
-- identificadores totalmente qualificados por segurança.
-- Idempotente (create or replace).

create or replace function public.auth_roles()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(ur.role_key), array[]::text[])
  from public.user_roles ur
  where ur.user_id = (select auth.uid());
$$;

create or replace function public.auth_has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role_key = p_role
  );
$$;

create or replace function public.auth_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_key = ur.role_key
    where ur.user_id = (select auth.uid())
      and rp.permission_key = p_permission
  );
$$;

grant execute on function public.auth_roles() to authenticated, anon;
grant execute on function public.auth_has_role(text) to authenticated, anon;
grant execute on function public.auth_has_permission(text) to authenticated, anon;
