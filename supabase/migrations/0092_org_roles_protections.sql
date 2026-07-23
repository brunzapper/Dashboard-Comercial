-- Versão: 1.0 | Data: 23/07/2026
-- MULTI-ORGANIZAÇÃO (papéis): confina a gestão de papéis à PRÓPRIA org e
-- reserva a concessão/remoção do papel `admin` ("Administrador comum") ao
-- Administrador de Organização (organization_members.is_org_admin, 0089).
--   * user_roles_select: o próprio usuário, ou quem gere usuários — mas SÓ de
--     usuários que compartilham org (auth_org_member_ids).
--   * user_roles_write: manage_users_roles + alvo na mesma org; linhas com
--     role_key = 'admin' exigem também auth_can_grant_admin (caller é
--     org_admin de uma org que contém o alvo).
-- As actions da tela de Usuários espelham estas regras (mensagens amigáveis);
-- a RLS é a barreira definitiva. Idempotente.

create or replace function public.auth_can_grant_admin(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members target
      on target.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.is_org_admin
      and target.user_id = p_target
  );
$$;

grant execute on function public.auth_can_grant_admin(uuid) to authenticated;

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select public.auth_has_permission('manage_users_roles'))
      and user_id in (select public.auth_org_member_ids())
    )
  );

drop policy if exists user_roles_write on public.user_roles;
create policy user_roles_write on public.user_roles for all to authenticated
  using (
    (select public.auth_has_permission('manage_users_roles'))
    and user_id in (select public.auth_org_member_ids())
    and (role_key <> 'admin' or public.auth_can_grant_admin(user_id))
  )
  with check (
    (select public.auth_has_permission('manage_users_roles'))
    and user_id in (select public.auth_org_member_ids())
    and (role_key <> 'admin' or public.auth_can_grant_admin(user_id))
  );
