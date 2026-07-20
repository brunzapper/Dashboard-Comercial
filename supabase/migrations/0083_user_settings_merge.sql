-- Versão: 1.0 | Data: 20/07/2026
-- Merge ATÔMICO de user_settings.settings (auditoria 20/07/2026):
-- markTasksSeen (lib/tasks/actions.ts) e updateUserSettings
-- (app/(app)/dashboards/actions.ts) faziam read-modify-write no app — duas
-- gravações concorrentes (ex.: sidebarPinned × tasksSeenAt) perdiam uma das
-- duas. A função aplica `settings || p_patch` numa única instrução no banco.
-- SECURITY INVOKER de propósito: a RLS de user_settings (0027) já escopa a
-- linha ao próprio usuário; a função só remove a janela de corrida.
-- Idempotente. Não toca as RPCs de widgets (invariante 1 não acionada).
-- APLICAR ANTES do deploy do código que a chama.

create or replace function public.user_settings_merge(p_patch jsonb)
returns void
language sql
as $$
  insert into public.user_settings (user_id, settings)
  values ((select auth.uid()), coalesce(p_patch, '{}'::jsonb))
  on conflict (user_id) do update
    set settings = coalesce(public.user_settings.settings, '{}'::jsonb)
      || coalesce(excluded.settings, '{}'::jsonb);
$$;

revoke all on function public.user_settings_merge(jsonb) from public;
revoke all on function public.user_settings_merge(jsonb) from anon;
grant execute on function public.user_settings_merge(jsonb)
  to authenticated, service_role;
