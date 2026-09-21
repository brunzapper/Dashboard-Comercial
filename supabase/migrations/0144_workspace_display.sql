-- Workspace: preferências atômicas, histórico pessoal de abertura e alteração
-- de widgets refletida no dashboard. Nenhuma mudança nas RPCs de consulta.
create or replace function public.patch_user_ui_prefs(p_patch jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sessão expirada'; end if;
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'Preferências inválidas'; end if;
  insert into public.user_settings(user_id, settings)
  values (auth.uid(), jsonb_build_object('uiPrefs', p_patch))
  on conflict (user_id) do update set settings = jsonb_set(
    user_settings.settings, '{uiPrefs}',
    (case when jsonb_typeof(user_settings.settings->'uiPrefs') = 'object'
      then user_settings.settings->'uiPrefs' else '{}'::jsonb end) || p_patch
  );
end;
$$;
revoke all on function public.patch_user_ui_prefs(jsonb) from public, anon;
grant execute on function public.patch_user_ui_prefs(jsonb) to authenticated;

create table public.workspace_visits (
  user_id uuid not null references auth.users(id) on delete cascade,
  path text not null check (path ~ '^/(dashboards|kanbans|kanbans/w)/[0-9a-f-]{36}$'),
  last_opened_at timestamptz not null default now(),
  primary key (user_id, path)
);
alter table public.workspace_visits enable row level security;
create policy workspace_visits_own on public.workspace_visits
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.workspace_visits to authenticated;

-- Alterar/excluir um widget também é alterar seu dashboard. SECURITY DEFINER
-- permite o carimbo após uma escrita de widget já autorizada pela RLS.
create or replace function public.touch_widget_dashboard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    update public.dashboards set updated_at = now() where id = OLD.dashboard_id;
  else
    update public.dashboards set updated_at = now() where id = NEW.dashboard_id;
    if TG_OP = 'UPDATE' and OLD.dashboard_id is distinct from NEW.dashboard_id then
      update public.dashboards set updated_at = now() where id = OLD.dashboard_id;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.touch_widget_dashboard() from public, anon, authenticated;
create trigger trg_widgets_touch_dashboard
  after insert or update or delete on public.widgets
  for each row execute function public.touch_widget_dashboard();
