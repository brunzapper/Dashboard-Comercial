-- Versão: 1.0 | Data: 23/07/2026
-- HARDENING de banco (achados do database linter do Supabase):
--   1) search_path FIXO nas funções que ainda estavam com search_path mutável
--      (anti schema-hijack — o linter 0011_function_search_path_mutable). Todas
--      já qualificam identificadores com `public.` (ou só usam builtins de
--      pg_catalog), então `set search_path = ''` é seguro e não muda o
--      comportamento — só fecha o vetor de resolução de nome por search_path do
--      chamador. Espelha o padrão das funções SECURITY DEFINER de 0089+.
--   2) REVOKE EXECUTE dos helpers auth_* do papel `anon` (linters 0028/0029):
--      são SECURITY DEFINER e hoje inócuos para anon (retornam vazio/false sem
--      sessão), mas não há caminho anônimo legítimo no app — o viewer público
--      de snapshot usa service_role, nunca anon. Mantemos o grant a
--      `authenticated` (as políticas de RLS dependem dele).
-- Idempotente (alter function / revoke são repetíveis). Aplicar após a 0094.

-- ===================== 1) search_path fixo =====================
alter function public.set_updated_at() set search_path = '';
alter function public.operation_subtree(uuid) set search_path = '';
alter function public.enforce_app_owner_guard() set search_path = '';
alter function public.enforce_org_admin_guard() set search_path = '';
alter function public.enforce_organizations_guard() set search_path = '';
alter function public.records_set_org() set search_path = '';
alter function public.audit_log_set_org() set search_path = '';
alter function public.record_matches_set_org() set search_path = '';
alter function public.entity_custom_values_set_org() set search_path = '';

-- ===================== 2) tirar anon dos helpers auth_* =====================
-- Helpers de RLS/permissão (SECURITY DEFINER). O EXECUTE de `anon` vem do grant
-- DEFAULT ao pseudo-papel PUBLIC (ao criar a função), então revogar só de `anon`
-- não basta. Ordem SEGURA (sem risco de lockout): GRANT explícito a
-- authenticated/service_role PRIMEIRO, depois REVOKE de public e anon. Assim as
-- políticas de RLS (invoker = authenticated) seguem funcionando e `anon` (que
-- não tem uso legítimo — sem políticas `to anon`) perde o acesso.
do $$
declare
  fn text;
  fns text[] := array[
    'public.auth_org_ids()',
    'public.auth_org_member_ids()',
    'public.auth_is_org_admin(uuid)',
    'public.auth_is_owner()',
    'public.auth_can_grant_admin(uuid)',
    'public.auth_roles()',
    'public.auth_has_role(text)',
    'public.auth_has_permission(text)',
    'public.auth_responsible_ids()',
    'public.auth_denied_source_keys()',
    'public.auth_denied_record_types()',
    'public.auth_board_visible(uuid)',
    'public.auth_board_editable(uuid)',
    'public.auth_board_manageable(uuid)',
    'public.auth_board_access_level(uuid)'
  ];
begin
  foreach fn in array fns loop
    execute format('grant execute on function %s to authenticated, service_role', fn);
    execute format('revoke execute on function %s from public, anon', fn);
  end loop;
end $$;
